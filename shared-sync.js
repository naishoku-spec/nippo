(function (global) {
    'use strict';

    const BUILD_ID = '20260803-sync-v7';
    const BUILD_NUMBER = 2026080307;
    const VERSION_PATH = 'app-version.json';
    const VERSION_CHECK_INTERVAL_MS = 30000;
    const LATEST_BUILD_KEY = 'nippo_latest_app_build_number';

    let versionIsStale = false;
    let versionCheckInFlight = false;
    let versionCheckTimer = null;
    let versionGuardStarted = false;

    const WRITE_METHODS = new Set(['set', 'update', 'remove', 'setWithPriority', 'transaction']);
    const REFERENCE_CHAIN_METHODS = new Set([
        'child', 'orderByChild', 'orderByKey', 'orderByValue',
        'limitToFirst', 'limitToLast', 'startAt', 'endAt', 'equalTo'
    ]);

    function cloneValue(value) {
        if (value === undefined) return undefined;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function valuesEqual(left, right) {
        if (Object.is(left, right)) return true;
        if (left === null || right === null || typeof left !== typeof right) return false;
        if (Array.isArray(left) || Array.isArray(right)) {
            if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
            return left.every((value, index) => valuesEqual(value, right[index]));
        }
        if (isPlainObject(left) || isPlainObject(right)) {
            if (!isPlainObject(left) || !isPlainObject(right)) return false;
            const leftKeys = Object.keys(left);
            const rightKeys = Object.keys(right);
            if (leftKeys.length !== rightKeys.length) return false;
            return leftKeys.every(key =>
                Object.prototype.hasOwnProperty.call(right, key) && valuesEqual(left[key], right[key])
            );
        }
        return false;
    }

    function collectionKey(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        if (value._syncKey !== undefined && value._syncKey !== null && value._syncKey !== '') {
            return 'sync:' + String(value._syncKey);
        }
        if (value.id !== undefined && value.id !== null && value.id !== '') {
            return 'id:' + String(value.id);
        }
        if (value.date && value.machine) {
            return 'dm:' + String(value.date) + ':' + String(value.machine);
        }
        if (value.key !== undefined && value.key !== null && value.key !== '') {
            return 'key:' + String(value.key);
        }
        return null;
    }

    function mergeKeyedArrays(base, local, remote) {
        const all = [base, local, remote];
        const maps = all.map(list => {
            const map = new Map();
            for (const item of list) {
                const key = collectionKey(item);
                if (!key || map.has(key)) return null;
                map.set(key, item);
            }
            return map;
        });
        if (maps.some(map => map === null)) return cloneValue(local);

        const [baseMap, localMap, remoteMap] = maps;
        const orderedKeys = [
            ...remoteMap.keys(),
            ...localMap.keys(),
            ...baseMap.keys()
        ];
        const result = [];
        const used = new Set();

        for (const key of orderedKeys) {
            if (used.has(key)) continue;
            used.add(key);

            const hasBase = baseMap.has(key);
            const hasLocal = localMap.has(key);
            const hasRemote = remoteMap.has(key);
            const baseValue = baseMap.get(key);
            const localValue = localMap.get(key);
            const remoteValue = remoteMap.get(key);

            if (!hasLocal) {
                if (hasRemote && (!hasBase || !valuesEqual(remoteValue, baseValue))) {
                    result.push(cloneValue(remoteValue));
                }
                continue;
            }
            if (!hasBase) {
                result.push(hasRemote
                    ? mergeThreeWay(undefined, localValue, remoteValue)
                    : cloneValue(localValue));
                continue;
            }
            if (valuesEqual(localValue, baseValue)) {
                if (hasRemote) result.push(cloneValue(remoteValue));
                continue;
            }
            if (!hasRemote) {
                result.push(cloneValue(localValue));
                continue;
            }
            result.push(mergeThreeWay(baseValue, localValue, remoteValue));
        }
        return result;
    }

    function mergeThreeWay(base, local, remote) {
        if (valuesEqual(local, base)) return cloneValue(remote);
        if (valuesEqual(remote, base)) return cloneValue(local);
        if (valuesEqual(local, remote)) return cloneValue(local);

        if (Array.isArray(base) || Array.isArray(local) || Array.isArray(remote)) {
            if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
                return mergeKeyedArrays(base, local, remote);
            }
            return cloneValue(local);
        }

        if (isPlainObject(base) || isPlainObject(local) || isPlainObject(remote)) {
            const result = {};
            const keys = new Set([
                ...Object.keys(isPlainObject(base) ? base : {}),
                ...Object.keys(isPlainObject(local) ? local : {}),
                ...Object.keys(isPlainObject(remote) ? remote : {})
            ]);

            for (const key of keys) {
                const baseHas = isPlainObject(base) && Object.prototype.hasOwnProperty.call(base, key);
                const localHas = isPlainObject(local) && Object.prototype.hasOwnProperty.call(local, key);
                const remoteHas = isPlainObject(remote) && Object.prototype.hasOwnProperty.call(remote, key);

                if (!localHas && !remoteHas) continue;
                if (!baseHas) {
                    if (localHas && remoteHas) {
                        result[key] = mergeThreeWay(undefined, local[key], remote[key]);
                    } else if (localHas) {
                        result[key] = cloneValue(local[key]);
                    } else {
                        result[key] = cloneValue(remote[key]);
                    }
                    continue;
                }

                if (!localHas) {
                    if (remoteHas && !valuesEqual(remote[key], base[key])) {
                        result[key] = cloneValue(remote[key]);
                    }
                    continue;
                }
                if (!remoteHas) {
                    if (!valuesEqual(local[key], base[key])) {
                        result[key] = cloneValue(local[key]);
                    }
                    continue;
                }

                result[key] = mergeThreeWay(base[key], local[key], remote[key]);
            }
            return result;
        }

        return cloneValue(local);
    }

    function mergeRestoreArrays(current, backup) {
        const toMap = list => {
            const map = new Map();
            for (const item of list) {
                const key = collectionKey(item);
                if (!key || map.has(key)) return null;
                map.set(key, item);
            }
            return map;
        };

        const currentMap = toMap(current);
        const backupMap = toMap(backup);
        if (!currentMap || !backupMap) return cloneValue(current);

        const result = [];
        const orderedKeys = [...currentMap.keys(), ...backupMap.keys()];
        const seen = new Set();
        for (const key of orderedKeys) {
            if (seen.has(key)) continue;
            seen.add(key);
            if (currentMap.has(key) && backupMap.has(key)) {
                result.push(mergeRestoreValue(currentMap.get(key), backupMap.get(key)));
            } else if (currentMap.has(key)) {
                result.push(cloneValue(currentMap.get(key)));
            } else {
                result.push(cloneValue(backupMap.get(key)));
            }
        }
        return result;
    }

    function mergeRestoreValue(current, backup) {
        if (current === undefined || current === null) return cloneValue(backup);
        if (backup === undefined || backup === null) return cloneValue(current);

        if (Array.isArray(current) || Array.isArray(backup)) {
            if (!Array.isArray(current) || !Array.isArray(backup)) return cloneValue(current);
            return mergeRestoreArrays(current, backup);
        }

        if (isPlainObject(current) || isPlainObject(backup)) {
            if (!isPlainObject(current) || !isPlainObject(backup)) return cloneValue(current);
            const result = cloneValue(backup) || {};
            for (const key of Object.keys(current)) {
                if (!Object.prototype.hasOwnProperty.call(backup, key)) {
                    result[key] = cloneValue(current[key]);
                    continue;
                }

                // Preserve an explicit current null instead of resurrecting an older field.
                result[key] = current[key] === null
                    ? null
                    : mergeRestoreValue(current[key], backup[key]);
            }
            return result;
        }

        return cloneValue(current);
    }

    function canWrite() {
        if (!versionIsStale) return true;
        console.warn('Blocked data write because this page is out of date.');
        return false;
    }

    function blockedWriteError() {
        const error = new Error('This page is out of date. Reload before saving data.');
        error.code = 'app-version-stale';
        return error;
    }

    function guardReference(reference) {
        if (!reference) return reference;

        return new Proxy(reference, {
            get(target, property) {
                const value = target[property];

                if (WRITE_METHODS.has(property) && typeof value === 'function') {
                    return (...args) => {
                        if (canWrite()) return value.apply(target, args);

                        const error = blockedWriteError();
                        if (property === 'transaction') {
                            const completion = args[1];
                            if (typeof completion === 'function') {
                                setTimeout(() => completion(error, false, null), 0);
                            }
                            return Promise.resolve({ committed: false, snapshot: null });
                        }
                        return Promise.resolve();
                    };
                }

                if (REFERENCE_CHAIN_METHODS.has(property) && typeof value === 'function') {
                    return (...args) => guardReference(value.apply(target, args));
                }

                if ((property === 'parent' || property === 'root') && value) {
                    return guardReference(value);
                }

                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

    function guardDatabase(rawDatabase) {
        if (!rawDatabase) return rawDatabase;
        return {
            ref(path) {
                return guardReference(rawDatabase.ref(path));
            }
        };
    }

    function injectVersionStyles() {
        if (!document.head || document.getElementById('shared-version-guard-style')) return;
        const style = document.createElement('style');
        style.id = 'shared-version-guard-style';
        style.textContent = [
            '.app-update-lock{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(15,23,42,.72)}',
            '.app-update-lock__dialog{width:min(100%,420px);padding:1.5rem;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#1e293b;text-align:center;box-shadow:0 18px 50px rgba(15,23,42,.28)}',
            '.app-update-lock__icon{display:grid;width:3rem;height:3rem;margin:0 auto .75rem;place-items:center;border-radius:50%;background:#e0e7ff;color:#4338ca;font-size:1.6rem;font-weight:700}',
            '.app-update-lock__dialog h2{margin:0 0 .75rem;font-size:1.2rem}',
            '.app-update-lock__dialog p{margin:0 0 1.25rem;color:#475569;line-height:1.7}',
            '.app-update-lock__dialog button{width:100%;min-height:44px;border:0;border-radius:6px;background:#4f46e5;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function showVersionLock() {
        if (!document.body || document.getElementById('app-update-lock')) return;
        injectVersionStyles();

        const overlay = document.createElement('div');
        overlay.id = 'app-update-lock';
        overlay.className = 'app-update-lock';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = [
            '<div class="app-update-lock__dialog">',
            '<div class="app-update-lock__icon" aria-hidden="true">&#x21bb;</div>',
            '<h2>\u30da\u30fc\u30b8\u3092\u66f4\u65b0\u3057\u3066\u304f\u3060\u3055\u3044</h2>',
            '<p>\u65b0\u3057\u3044\u30da\u30fc\u30b8\u304c\u516c\u958b\u3055\u308c\u307e\u3057\u305f\u3002\u30c7\u30fc\u30bf\u4fdd\u8b77\u306e\u305f\u3081\u3001\u3053\u306e\u30da\u30fc\u30b8\u304b\u3089\u306e\u4fdd\u5b58\u3092\u505c\u6b62\u3057\u3066\u3044\u307e\u3059?</p>',
            '<button type="button" id="app-update-lock-reload">\u518d\u8aad\u307f\u8fbc\u307f</button>',
            '</div>'
        ].join('');

        overlay.querySelector('#app-update-lock-reload').addEventListener('click', () => {
            window.location.reload();
        });
        document.body.appendChild(overlay);
    }

    function markVersionStale() {
        if (versionIsStale) return;
        versionIsStale = true;
        if (versionCheckTimer) {
            clearInterval(versionCheckTimer);
            versionCheckTimer = null;
        }
        showVersionLock();
    }

    function versionUrl() {
        const url = new URL(VERSION_PATH, document.baseURI || window.location.href);
        url.searchParams.set('_check', String(Date.now()));
        return url.toString();
    }

    async function checkVersion() {
        if (versionIsStale || versionCheckInFlight || typeof fetch !== 'function') return;
        if (window.location.protocol === 'file:') return;

        versionCheckInFlight = true;
        try {
            const response = await fetch(versionUrl(), {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache' }
            });
            if (!response.ok) return;
            const metadata = await response.json();
            const latestNumber = Number(metadata?.buildNumber);
            const latestId = typeof metadata?.buildId === 'string' ? metadata.buildId : '';
            const newer = Number.isFinite(latestNumber)
                ? latestNumber > BUILD_NUMBER
                : Boolean(latestId && latestId !== BUILD_ID);
            if (newer) markVersionStale();
        } catch (error) {
            console.warn('App version check skipped:', error);
        } finally {
            versionCheckInFlight = false;
        }
    }

    function startVersionGuard() {
        if (versionGuardStarted) return;
        versionGuardStarted = true;
        try {
            const knownNumber = Number(localStorage.getItem(LATEST_BUILD_KEY));
            if (Number.isFinite(knownNumber) && knownNumber > BUILD_NUMBER) {
                markVersionStale();
            } else if (!Number.isFinite(knownNumber) || knownNumber < BUILD_NUMBER) {
                localStorage.setItem(LATEST_BUILD_KEY, String(BUILD_NUMBER));
            }
        } catch (error) {
            console.warn('App version marker unavailable:', error);
        }

        window.addEventListener('storage', event => {
            const nextNumber = Number(event.key === LATEST_BUILD_KEY ? event.newValue : '');
            if (Number.isFinite(nextNumber) && nextNumber > BUILD_NUMBER) {
                markVersionStale();
            }
        });
        window.addEventListener('focus', checkVersion);
        window.addEventListener('pageshow', checkVersion);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkVersion();
        });

        checkVersion();
        if (!versionIsStale) {
            versionCheckTimer = setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS);
        }
    }

    function isEmptyValue(value) {
        if (Array.isArray(value)) return value.length === 0;
        if (isPlainObject(value)) return Object.keys(value).length === 0;
        return value === null || value === undefined || value === '';
    }

    function loadPending(key) {
        if (!key) return null;
        try {
            const stored = localStorage.getItem(key);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'base')
                || !Object.prototype.hasOwnProperty.call(parsed, 'local')) return null;
            return { base: cloneValue(parsed.base), local: cloneValue(parsed.local) };
        } catch (error) {
            console.warn('Pending sync load skipped:', error);
            return null;
        }
    }

    function persistPending(key, pending) {
        if (!key) return;
        try {
            if (pending) localStorage.setItem(key, JSON.stringify(pending));
            else localStorage.removeItem(key);
        } catch (error) {
            console.warn('Pending sync persistence skipped:', error);
        }
    }

    function loadSnapshot(key) {
        if (!key) return { found: false, value: null };
        try {
            const stored = localStorage.getItem(key);
            if (!stored) return { found: false, value: null };
            return { found: true, value: JSON.parse(stored) };
        } catch (error) {
            console.warn('Server snapshot load skipped:', error);
            return { found: false, value: null };
        }
    }

    function persistSnapshot(key, value) {
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('Server snapshot persistence skipped:', error);
        }
    }

    function createPathSync(options) {
        const database = options.database;
        const path = options.path;
        const emptyValue = cloneValue(options.emptyValue);
        const normalize = typeof options.normalize === 'function'
            ? options.normalize
            : value => value === null || value === undefined ? cloneValue(emptyValue) : cloneValue(value);
        const merge = typeof options.merge === 'function' ? options.merge : mergeThreeWay;
        const mergeInitial = options.mergeInitial === true;
        const pendingKey = options.pendingStorageKey || '';
        const serverSnapshotKey = options.serverSnapshotStorageKey || '';
        const storedServerSnapshot = loadSnapshot(serverSnapshotKey);
        let pending = loadPending(pendingKey);
        let serverSnapshot = pending
            ? cloneValue(pending.base)
            : storedServerSnapshot.found ? cloneValue(storedServerSnapshot.value) : cloneValue(emptyValue);
        let ready = false;
        let inFlight = false;
        let retryTimer = null;

        const getLocal = () => normalize(options.getLocal());
        const setLocal = (value, meta) => {
            if (typeof options.setLocal === 'function') {
                options.setLocal(normalize(value), meta || {});
            }
        };
        const notify = (value, meta) => {
            if (typeof options.onRemote === 'function') {
                options.onRemote(normalize(value), meta || {});
            }
        };

        function flush() {
            if (!canWrite() || !database || !ready || inFlight || !pending) return;
            const state = {
                base: cloneValue(pending.base),
                local: cloneValue(pending.local)
            };
            inFlight = true;

            database.ref(path).transaction(currentValue => {
                const remote = normalize(currentValue);
                return merge(state.base, state.local, remote);
            }, (error, committed, snapshot) => {
                inFlight = false;
                if (!canWrite()) return;
                if (error || !committed || !snapshot) {
                    if (!retryTimer) {
                        retryTimer = setTimeout(() => {
                            retryTimer = null;
                            flush();
                        }, 3000);
                    }
                    return;
                }

                const committedValue = normalize(snapshot.val());
                serverSnapshot = cloneValue(committedValue);
                persistSnapshot(serverSnapshotKey, serverSnapshot);
                const pendingStillMatches = pending && valuesEqual(pending.local, state.local);

                if (pendingStillMatches) {
                    pending = null;
                    setLocal(committedValue, { source: 'sync', committed: true });
                } else if (pending) {
                    pending.base = cloneValue(committedValue);
                    pending.local = merge(pending.base, pending.local, committedValue);
                    setLocal(pending.local, { source: 'sync', committed: true, pending: true });
                }
                persistPending(pendingKey, pending);
                notify(getLocal(), { source: 'sync', committed: true });
                if (pending) flush();
            });
        }

        function save(value) {
            if (!canWrite()) return false;
            const localValue = normalize(value);
            if (!pending) {
                pending = {
                    base: cloneValue(serverSnapshot),
                    local: cloneValue(localValue)
                };
            } else {
                pending.local = cloneValue(localValue);
            }
            persistPending(pendingKey, pending);
            flush();
            return true;
        }

        function handleRemote(rawValue) {
            const remote = normalize(rawValue);
            const local = getLocal();

            if (!ready) {
                const previousServer = storedServerSnapshot.found ? cloneValue(storedServerSnapshot.value) : null;
                serverSnapshot = cloneValue(remote);
                if (pending) {
                    const merged = merge(pending.base, pending.local, remote);
                    pending = { base: cloneValue(remote), local: cloneValue(merged) };
                    setLocal(merged, { source: 'initial', pending: true });
                } else if (previousServer !== null) {
                    const merged = merge(previousServer, local, remote);
                    if (!valuesEqual(merged, remote)) {
                        pending = { base: cloneValue(remote), local: cloneValue(merged) };
                        setLocal(merged, { source: 'initial', pending: true });
                    } else {
                        setLocal(remote, { source: 'initial' });
                    }
                } else if (isEmptyValue(remote) && !isEmptyValue(local)) {
                    pending = { base: cloneValue(emptyValue), local: cloneValue(local) };
                    setLocal(local, { source: 'initial', pending: true });
                } else if (mergeInitial && !isEmptyValue(local) && !isEmptyValue(remote)) {
                    const merged = merge(emptyValue, local, remote);
                    if (!valuesEqual(merged, remote)) {
                        pending = { base: cloneValue(remote), local: cloneValue(merged) };
                        setLocal(merged, { source: 'initial', pending: true });
                    } else {
                        setLocal(remote, { source: 'initial' });
                    }
                } else {
                    setLocal(remote, { source: 'initial' });
                }
                ready = true;
                persistSnapshot(serverSnapshotKey, serverSnapshot);
                persistPending(pendingKey, pending);
                notify(getLocal(), { source: 'initial', pending: Boolean(pending) });
                flush();
                return;
            }

            const previousServer = cloneValue(serverSnapshot);
            serverSnapshot = cloneValue(remote);
            persistSnapshot(serverSnapshotKey, serverSnapshot);
            if (pending) {
                const merged = merge(pending.base, pending.local, remote);
                pending.base = cloneValue(remote);
                pending.local = cloneValue(merged);
                setLocal(merged, { source: 'remote', pending: true });
                persistPending(pendingKey, pending);
                notify(getLocal(), { source: 'remote', pending: true });
                flush();
                return;
            }

            const merged = merge(previousServer, local, remote);
            if (!valuesEqual(merged, remote)) {
                pending = { base: cloneValue(previousServer), local: cloneValue(merged) };
                setLocal(merged, { source: 'remote', pending: true });
                persistPending(pendingKey, pending);
                notify(getLocal(), { source: 'remote', pending: true });
                flush();
                return;
            }

            if (!valuesEqual(local, remote)) {
                setLocal(remote, { source: 'remote' });
                notify(getLocal(), { source: 'remote' });
            }
        }

        if (pending) setLocal(pending.local, { source: 'pending' });

        if (database) {
            database.ref(path).on('value', snapshot => handleRemote(snapshot.val()));
        }

        return {
            save,
            flush,
            isReady: () => ready,
            getServerSnapshot: () => cloneValue(serverSnapshot),
            getPending: () => cloneValue(pending)
        };
    }

    global.SharedSync = {
        BUILD_ID,
        BUILD_NUMBER,
        cloneValue,
        valuesEqual,
        mergeThreeWay,
        mergeRestoreValue,
        guardReference,
        guardDatabase,
        canWrite,
        startVersionGuard,
        createPathSync
    };
})(window);
