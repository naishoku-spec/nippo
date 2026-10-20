(function (global) {
    'use strict';

    const BUILD_ID = '20261020-stale-write-guard-v55';
    const BUILD_NUMBER = 2026102055;
    const VERSION_PATH = new URL('app-version.json', document.currentScript?.src || document.baseURI || global.location.href).toString();
    const VERSION_CHECK_INTERVAL_MS = 30000;
    const LATEST_BUILD_KEY = 'nippo_latest_app_build_number';
    const PENDING_TRUST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const FIRST_GUARDED_DRAFT_BUILD = 2026102054;

    function clearRefreshMarker() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has('_app_refresh')) return;
            url.searchParams.delete('_app_refresh');
            window.history.replaceState(window.history.state, '', url.toString());
        } catch (error) {
            console.warn('Refresh marker cleanup skipped:', error);
        }
    }

    function reloadCurrentPageFresh() {
        const url = new URL(window.location.href);
        url.searchParams.set('_app_refresh', `${BUILD_NUMBER}-${Date.now()}`);
        window.location.replace(url.toString());
    }

    clearRefreshMarker();

    // Release focused number fields before the browser applies its native wheel step.
    if (typeof global.matchMedia === 'function' &&
        global.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches) {
        document.addEventListener('wheel', event => {
            const focusedInput = document.activeElement;
            if (event.target === focusedInput && focusedInput?.matches?.('input[type="number"]')) {
                focusedInput.blur();
            }
        }, { capture: true, passive: true });
    }

    function isDigitOnlyInput(target) {
        if (!(target instanceof global.HTMLInputElement) || target.type !== 'number') return false;
        if (target.closest('[data-progress-entry], .progress-entry, .task-progress-entry')) return false;

        const fieldDescription = [
            target.id,
            target.name,
            target.className,
            target.dataset.field,
            target.dataset.type
        ].join(' ');
        return !/(?:progress|進捗)/i.test(fieldDescription);
    }

    function configureDigitOnlyInput(input) {
        input.inputMode = 'numeric';
        input.step = '1';
        if (!input.hasAttribute('min')) input.min = '0';
    }

    document.addEventListener('focusin', event => {
        if (isDigitOnlyInput(event.target)) configureDigitOnlyInput(event.target);
    }, true);

    document.addEventListener('keydown', event => {
        if (!isDigitOnlyInput(event.target)) return;
        configureDigitOnlyInput(event.target);
        if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key.length === 1 && !/^[0-9]$/.test(event.key)) event.preventDefault();
    }, true);

    document.addEventListener('beforeinput', event => {
        if (!isDigitOnlyInput(event.target) || !event.inputType.startsWith('insert')) return;
        configureDigitOnlyInput(event.target);
        let insertedText = event.data;
        if (insertedText == null && event.dataTransfer) {
            insertedText = event.dataTransfer.getData('text/plain');
        }
        if (insertedText != null && /[^0-9]/.test(insertedText)) event.preventDefault();
    }, true);

    document.addEventListener('paste', event => {
        if (!isDigitOnlyInput(event.target)) return;
        const pastedText = event.clipboardData?.getData('text/plain');
        if (pastedText != null && /[^0-9]/.test(pastedText)) event.preventDefault();
    }, true);

    document.addEventListener('drop', event => {
        if (!isDigitOnlyInput(event.target)) return;
        const droppedText = event.dataTransfer?.getData('text/plain');
        if (droppedText != null && /[^0-9]/.test(droppedText)) event.preventDefault();
    }, true);

    let versionIsStale = false;
    let versionCheckInFlight = false;
    let versionCheckTimer = null;
    let versionGuardStarted = false;
    const pathSyncFlushers = new Set();
    let pathSyncLifecycleBound = false;
    const pausedWrites = new Map();
    let refreshInFlight = false;

    const WRITE_METHODS = new Set(['set', 'update', 'remove', 'setWithPriority', 'transaction']);
    const REFERENCE_CHAIN_METHODS = new Set([
        'child', 'orderByChild', 'orderByKey', 'orderByValue',
        'limitToFirst', 'limitToLast', 'startAt', 'endAt', 'equalTo'
    ]);

    function flushRegisteredPathSyncs() {
        pathSyncFlushers.forEach(flush => {
            try {
                flush();
            } catch (error) {
                console.warn('Pending data sync flush skipped:', error);
            }
        });
    }

    function registerPathSyncFlusher(flush) {
        if (typeof flush !== 'function') return;
        pathSyncFlushers.add(flush);
        if (pathSyncLifecycleBound) return;

        pathSyncLifecycleBound = true;
        const flushBeforeSuspend = () => flushRegisteredPathSyncs();
        window.addEventListener('pagehide', flushBeforeSuspend);
        window.addEventListener('freeze', flushBeforeSuspend);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushBeforeSuspend();
        });
        window.addEventListener('online', flushBeforeSuspend);
        window.addEventListener('pageshow', flushBeforeSuspend);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function cloneValue(value) {
        if (value === undefined) return undefined;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function preserveCorruptLocalValue(key, rawValue) {
        const recoveryKey = key + '_corrupt_backup';
        try {
            if (!localStorage.getItem(recoveryKey)) {
                localStorage.setItem(recoveryKey, JSON.stringify({
                    sourceKey: key,
                    savedAt: new Date().toISOString(),
                    rawValue
                }));
            }
            return recoveryKey;
        } catch (error) {
            console.warn('Corrupt local value could not be preserved:', key, error);
            return '';
        }
    }

    // Read JSON without allowing one damaged local entry to stop the whole app.
    // The original string is retained under a separate key for manual recovery.
    function readLocalJson(key, fallback) {
        let rawValue;
        try {
            rawValue = localStorage.getItem(key);
        } catch (error) {
            console.warn('Local value could not be read:', key, error);
            return { value: cloneValue(fallback), valid: false, found: false, recoveryKey: '' };
        }

        if (rawValue === null || rawValue === '') {
            return { value: cloneValue(fallback), valid: true, found: false, recoveryKey: '' };
        }

        try {
            return { value: JSON.parse(rawValue), valid: true, found: true, recoveryKey: '' };
        } catch (error) {
            const recoveryKey = preserveCorruptLocalValue(key, rawValue);
            console.error('Invalid local JSON was ignored safely:', key, error);
            return { value: cloneValue(fallback), valid: false, found: true, recoveryKey };
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

    function getSyncUpdatedAt(value) {
        if (!isPlainObject(value)) return 0;
        const updatedAt = Number(value._syncUpdatedAt);
        return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
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
                // A stale page may send an older array without this item.
                // Preserve the acknowledged local item unless this page
                // explicitly removed it (handled by !hasLocal above).
                result.push(hasRemote ? cloneValue(remoteValue) : cloneValue(localValue));
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

    function mergeInitialArrays(local, remote) {
        const toMap = list => {
            const map = new Map();
            for (const item of list) {
                const key = collectionKey(item);
                if (!key || map.has(key)) return null;
                map.set(key, item);
            }
            return map;
        };

        const localMap = toMap(local);
        const remoteMap = toMap(remote);
        if (!localMap || !remoteMap) return cloneValue(remote);

        const result = [];
        for (const [key, remoteValue] of remoteMap) {
            result.push(localMap.has(key)
                ? mergeInitialValue(localMap.get(key), remoteValue)
                : cloneValue(remoteValue));
        }
        for (const [key, localValue] of localMap) {
            if (!remoteMap.has(key)) result.push(cloneValue(localValue));
        }
        return result;
    }

    // During the first sync, remote conflicts win while local-only values survive.
    function mergeInitialValue(local, remote) {
        if (remote === undefined) return cloneValue(local);
        if (local === undefined) return cloneValue(remote);

        if (Array.isArray(local) || Array.isArray(remote)) {
            if (!Array.isArray(local) || !Array.isArray(remote)) return cloneValue(remote);
            return mergeInitialArrays(local, remote);
        }

        if (isPlainObject(local) || isPlainObject(remote)) {
            if (!isPlainObject(local) || !isPlainObject(remote)) return cloneValue(remote);
            const result = cloneValue(remote) || {};
            for (const key of Object.keys(local)) {
                result[key] = Object.prototype.hasOwnProperty.call(remote, key)
                    ? mergeInitialValue(local[key], remote[key])
                    : cloneValue(local[key]);
            }
            return result;
        }

        return cloneValue(remote);
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
            const localUpdatedAt = getSyncUpdatedAt(local);
            const remoteUpdatedAt = getSyncUpdatedAt(remote);
            const keys = new Set([
                ...Object.keys(isPlainObject(base) ? base : {}),
                ...Object.keys(isPlainObject(local) ? local : {}),
                ...Object.keys(isPlainObject(remote) ? remote : {})
            ]);

            for (const key of keys) {
                const baseHas = isPlainObject(base) && Object.prototype.hasOwnProperty.call(base, key);
                const localHas = isPlainObject(local) && Object.prototype.hasOwnProperty.call(local, key);
                const remoteHas = isPlainObject(remote) && Object.prototype.hasOwnProperty.call(remote, key);

                if (key === '_syncUpdatedAt') {
                    const updatedAt = Math.max(
                        getSyncUpdatedAt(base),
                        localUpdatedAt,
                        remoteUpdatedAt
                    );
                    if (updatedAt > 0) result[key] = updatedAt;
                    continue;
                }

                if (!localHas && !remoteHas) continue;

                const localChanged = localHas !== baseHas
                    || (localHas && baseHas && !valuesEqual(local[key], base[key]));
                const remoteChanged = remoteHas !== baseHas
                    || (remoteHas && baseHas && !valuesEqual(remote[key], base[key]));
                const localValue = localHas ? local[key] : undefined;
                const remoteValue = remoteHas ? remote[key] : undefined;
                const canResolveByTimestamp = localHas && remoteHas
                    && localChanged && remoteChanged
                    && !valuesEqual(localValue, remoteValue)
                    && !isPlainObject(localValue)
                    && !isPlainObject(remoteValue)
                    && localUpdatedAt !== remoteUpdatedAt
                    && (localUpdatedAt > 0 || remoteUpdatedAt > 0);

                if (canResolveByTimestamp) {
                    result[key] = cloneValue(localUpdatedAt > remoteUpdatedAt ? localValue : remoteValue);
                    continue;
                }

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
                    // Keep a local field when a stale remote snapshot omits it.
                    // An explicit local deletion has already returned above.
                    result[key] = cloneValue(local[key]);
                    continue;
                }

                result[key] = mergeThreeWay(base[key], local[key], remote[key]);
            }
            return result;
        }

        return cloneValue(local);
    }

    // Reapply only this draft's changes after the user explicitly requests a
    // refresh. Untouched fields always come from the freshly read server value.
    function reapplyDraft(base, local, remote) {
        if (valuesEqual(base, local)) return cloneValue(remote);
        if (valuesEqual(base, remote) || valuesEqual(local, remote)) return cloneValue(local);
        if (Array.isArray(local) && Array.isArray(remote)) {
            const lists = [Array.isArray(base) ? base : [], local, remote];
            const maps = lists.map(list => {
                const map = new Map();
                for (const item of list) {
                    const key = collectionKey(item);
                    if (!key || map.has(key)) return null;
                    map.set(key, item);
                }
                return map;
            });
            if (maps.every(Boolean)) {
                const [before, draft, latest] = maps;
                const result = [];
                for (const key of new Set([...latest.keys(), ...draft.keys()])) {
                    if (!draft.has(key) && before.has(key)) continue;
                    const value = reapplyDraft(before.get(key), draft.get(key), latest.get(key));
                    if (value !== undefined) result.push(value);
                }
                return result;
            }
            return cloneValue(local);
        }
        if (isPlainObject(local) && isPlainObject(remote)) {
            const result = cloneValue(remote);
            for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local)])) {
                const value = reapplyDraft(base?.[key], local[key], remote[key]);
                if (value === undefined) delete result[key];
                else result[key] = value;
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

    function showSyncRefreshRequired(key, refresh) {
        pausedWrites.set(key, refresh);
        if (!document.body || document.getElementById('sync-refresh-lock')) return;
        injectVersionStyles();
        const overlay = document.createElement('div');
        overlay.id = 'sync-refresh-lock';
        overlay.className = 'app-update-lock';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'sync-refresh-title');
        overlay.innerHTML = [
            '<div class="app-update-lock__dialog">',
            '<h2 id="sync-refresh-title">最新データを読み込んでください</h2>',
            '<p id="sync-refresh-message">他の端末の更新が反映されていないため、保存を保留しています。入力内容を保持して最新データを読み込みます。</p>',
            '<button type="button" id="sync-refresh-retry">最新データを読み込む</button>',
            '</div>'
        ].join('');
        overlay.querySelector('#sync-refresh-retry').addEventListener('click', refreshPausedWrites);
        document.body.appendChild(overlay);
        setTimeout(() => overlay.querySelector('#sync-refresh-retry')?.focus(), 0);
    }

    async function refreshPausedWrites() {
        if (refreshInFlight || !canWrite()) return false;
        refreshInFlight = true;
        document.activeElement?.blur?.();
        const button = document.getElementById('sync-refresh-retry');
        const message = document.getElementById('sync-refresh-message');
        if (button) button.disabled = true;
        try {
            // Refresh every paused path before any of their writes can resume.
            const requests = Array.from(pausedWrites.entries());
            const resumes = await Promise.all(requests.map(([, refresh]) => refresh()));
            for (let index = 0; index < requests.length; index++) {
                const [key, refresh] = requests[index];
                if (pausedWrites.get(key) !== refresh) continue;
                pausedWrites.delete(key);
                try {
                    resumes[index]();
                } catch (error) {
                    if (!pausedWrites.has(key)) pausedWrites.set(key, refresh);
                    throw error;
                }
            }
            if (pausedWrites.size === 0) document.getElementById('sync-refresh-lock')?.remove();
            return pausedWrites.size === 0;
        } catch (error) {
            console.warn('Latest data could not be loaded; the draft is still pending:', error);
            if (message) message.textContent = '最新データを読み込めませんでした。入力内容と保存の保留は維持しています。通信状態を確認して、もう一度お試しください。';
            return false;
        } finally {
            refreshInFlight = false;
            if (button) button.disabled = false;
        }
    }

    async function readLatest(database, path) {
        if (global.navigator?.onLine === false) throw new Error('offline');
        const reference = database.ref(path);
        let timeout;
        try {
            return await Promise.race([
                typeof reference.get === 'function' ? reference.get() : reference.once('value'),
                new Promise((resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('sync-refresh-timeout')), 10000);
                })
            ]);
        } finally {
            clearTimeout(timeout);
        }
    }

    // The comparison also runs when Firebase retries against a newer server
    // value. A separate read followed by an unconditional write is not enough.
    function compareAndSave(database, path, baseline, normalize, update, complete) {
        let stale = false;
        database.ref(path).transaction(currentValue => {
            stale = !valuesEqual(normalize(currentValue), baseline);
            if (stale || !canWrite()) return;
            return update(normalize(currentValue));
        }, (error, committed, snapshot) => {
            complete(error, committed, snapshot, stale && !committed);
        }, false);
    }

    function restoreSafely(database, path, backupValue) {
        const key = {};
        return new Promise((resolve, reject) => {
            const save = baseline => {
                compareAndSave(database, path, baseline, cloneValue,
                    current => mergeRestoreValue(current, backupValue),
                    (error, committed, snapshot, stale) => {
                        if (error) return reject(error);
                        if (stale) {
                            showSyncRefreshRequired(key, async () => {
                                const latest = await readLatest(database, path);
                                return () => save(cloneValue(latest.val()));
                            });
                        } else {
                            resolve({ committed, snapshot });
                        }
                    });
            };
            readLatest(database, path).then(snapshot => save(cloneValue(snapshot.val())), reject);
        });
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
            reloadCurrentPageFresh();
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

    function normalizeDayMaps(value) {
        if (Array.isArray(value)) return value.map(normalizeDayMaps);
        if (!isPlainObject(value)) return value;
        const result = {};
        for (const [key, child] of Object.entries(value)) {
            // Realtime Database may return numeric day keys as a sparse array.
            // Keep these as maps so independent dates can be rebased separately.
            result[key] = key === 'days' && Array.isArray(child)
                ? Object.fromEntries(Object.entries(child)
                    .filter(([, day]) => day !== null && day !== undefined)
                    .map(([day, data]) => [day, normalizeDayMaps(data)]))
                : normalizeDayMaps(child);
        }
        return result;
    }

    function loadPending(key) {
        if (!key) return null;
        try {
            const stored = localStorage.getItem(key);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'base')
                || !Object.prototype.hasOwnProperty.call(parsed, 'local')) return null;
            const savedAtTime = Date.parse(parsed.savedAt || '');
            const age = Date.now() - savedAtTime;
            const pendingBuildNumber = Number(parsed.buildNumber) || 0;
            const compatibleBuild = pendingBuildNumber === BUILD_NUMBER
                || (pendingBuildNumber >= FIRST_GUARDED_DRAFT_BUILD && pendingBuildNumber < BUILD_NUMBER);
            const trusted = parsed.trusted === true
                && compatibleBuild
                && Number.isFinite(savedAtTime)
                && age >= -5 * 60 * 1000
                && age <= PENDING_TRUST_WINDOW_MS;
            return {
                base: cloneValue(parsed.base),
                local: cloneValue(parsed.local),
                savedAt: parsed.savedAt || '',
                buildNumber: pendingBuildNumber,
                requiresRefresh: parsed.requiresRefresh === true || pendingBuildNumber !== BUILD_NUMBER,
                draftBase: cloneValue(parsed.draftBase),
                _trusted: trusted,
                _raw: stored
            };
        } catch (error) {
            console.warn('Pending sync load skipped:', error);
            return null;
        }
    }

    function persistPending(key, pending) {
        if (!key) return false;
        try {
            if (pending) {
                const payload = {
                    base: cloneValue(pending.base),
                    local: cloneValue(pending.local),
                    savedAt: pending.savedAt || new Date().toISOString(),
                    buildNumber: BUILD_NUMBER,
                    requiresRefresh: pending.requiresRefresh === true,
                    draftBase: cloneValue(pending.draftBase),
                    trusted: pending._trusted !== false
                };
                localStorage.setItem(key, JSON.stringify(payload));
            } else {
                localStorage.removeItem(key);
            }
            return true;
        } catch (error) {
            console.warn('Pending sync persistence skipped:', error);
            return false;
        }
    }

    function preserveStalePending(key, rawValue) {
        if (!key || !rawValue) return true;
        const recoveryPrefix = key + '_stale_backup';
        try {
            let recoveryKey = recoveryPrefix;
            let suffix = 0;
            let existing;
            while ((existing = localStorage.getItem(recoveryKey))) {
                try {
                    if (JSON.parse(existing).rawValue === rawValue) return true;
                } catch (error) {
                    // Preserve the unreadable recovery copy too.
                }
                recoveryKey = recoveryPrefix + '_' + (++suffix);
            }
            localStorage.setItem(recoveryKey, JSON.stringify({
                sourceKey: key,
                savedAt: new Date().toISOString(),
                rawValue
            }));
            return true;
        } catch (error) {
            console.warn('Stale pending data could not be preserved:', key, error);
            return false;
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
            : value => normalizeDayMaps(value === null || value === undefined ? cloneValue(emptyValue) : cloneValue(value));
        const merge = typeof options.merge === 'function' ? options.merge : mergeThreeWay;
        const rebase = typeof options.rebase === 'function' ? options.rebase : reapplyDraft;
        const mergeInitial = options.mergeInitial === true;
        // Guarded drafts from compatible builds require an explicit refresh.
        // Older, untrusted queues remain recovery copies and are never replayed.
        const protectFromStalePending = options.protectFromStalePending !== false;
        const pendingKey = options.pendingStorageKey || '';
        const serverSnapshotKey = options.serverSnapshotStorageKey || '';
        const storedServerSnapshot = loadSnapshot(serverSnapshotKey);
        let pending = loadPending(pendingKey);
        if (pending) {
            pending.base = normalize(pending.base);
            pending.local = normalize(pending.local);
            if (pending.draftBase !== undefined) pending.draftBase = normalize(pending.draftBase);
        }
        const loadedUntrustedPending = Boolean(pending && protectFromStalePending && !pending._trusted);
        let retainUntrustedStoredPending = loadedUntrustedPending
            && !preserveStalePending(pendingKey, pending._raw);
        // Once the old payload has been copied to a recovery key, remove it
        // from the active queue. A new edit made before the first Firebase
        // response must not be attached to, and then discarded with, that old
        // Safari payload.
        if (loadedUntrustedPending && !retainUntrustedStoredPending) pending = null;
        let serverSnapshot = normalize(pending && pending._trusted
            ? pending.base
            : storedServerSnapshot.found ? storedServerSnapshot.value : emptyValue);
        let ready = false;
        let inFlight = false;
        let retryTimer = null;
        let paused = false;
        let deferredRemote;
        let hasDeferredRemote = false;
        let refreshing = false;
        const pauseKey = {};
        const isEditing = () => {
            if (typeof options.isEditing === 'function') return options.isEditing();
            const active = document.activeElement;
            return Boolean(options.viewSelector
                && active?.matches?.('input, textarea, select, [contenteditable="true"]')
                && active.closest(options.viewSelector));
        };

        const getLocal = () => normalize(options.getLocal());
        // This is the exact state the user saw when the page opened. If they
        // edit before Firebase's first value event, it is the only correct
        // three-way merge baseline (especially for clearing an old value).
        const initialLocalBaseline = cloneValue(getLocal());
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
        const persistCurrentPending = () => {
            if (!pending && retainUntrustedStoredPending) return false;
            const persisted = persistPending(pendingKey, pending);
            if (persisted) retainUntrustedStoredPending = false;
            return persisted;
        };

        function capturePendingDraft() {
            // Debounced inputs may have changed the model since save() ran.
            if (pending) pending.local = cloneValue(getLocal());
        }

        function pauseForRefresh() {
            capturePendingDraft();
            paused = true;
            if (pending) {
                pending.requiresRefresh = true;
                persistCurrentPending();
            }
            showSyncRefreshRequired(pauseKey, async () => {
                refreshing = true;
                let latest;
                try {
                    latest = normalize((await readLatest(database, path)).val());
                } finally {
                    refreshing = false;
                }
                return () => {
                    try {
                        capturePendingDraft();
                        const local = pending ? rebase(pending.draftBase ?? pending.base, pending.local, latest) : latest;
                        serverSnapshot = cloneValue(latest);
                        ready = true;
                        hasDeferredRemote = false;
                        if (pending) {
                            pending.base = cloneValue(latest);
                            pending.local = cloneValue(local);
                            delete pending.draftBase;
                            delete pending.requiresRefresh;
                        }
                        paused = false;
                        setLocal(local, { source: 'refresh', pending: Boolean(pending) });
                        persistSnapshot(serverSnapshotKey, serverSnapshot);
                        persistCurrentPending();
                        notify(getLocal(), { source: 'refresh', force: true, pending: Boolean(pending) });
                        flush();
                    } catch (error) {
                        pauseForRefresh();
                        throw error;
                    }
                };
            });
        }

        function flush() {
            if (!canWrite() || !database || !ready || inFlight || !pending || paused) return;
            if (pending.requiresRefresh || (hasDeferredRemote && !valuesEqual(deferredRemote, pending.base))) {
                pauseForRefresh();
                return;
            }
            const state = {
                base: cloneValue(pending.base),
                local: cloneValue(pending.local)
            };
            inFlight = true;

            compareAndSave(database, path, state.base, normalize,
                remote => merge(state.base, state.local, remote), (error, committed, snapshot, stale) => {
                inFlight = false;
                if (!canWrite()) return;
                if (stale) {
                    pauseForRefresh();
                    return;
                }
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
                capturePendingDraft();
                serverSnapshot = cloneValue(committedValue);
                persistSnapshot(serverSnapshotKey, serverSnapshot);
                const pendingStillMatches = pending && valuesEqual(pending.local, state.local);

                if (pendingStillMatches) {
                    pending = null;
                    setLocal(committedValue, { source: 'sync', committed: true });
                } else if (pending) {
                    pending.local = rebase(state.local, pending.local, committedValue);
                    if (pending.draftBase !== undefined) {
                        pending.draftBase = mergeInitialValue(pending.draftBase, committedValue);
                    }
                    pending.base = cloneValue(committedValue);
                    setLocal(pending.local, { source: 'sync', committed: true, pending: true });
                }
                persistCurrentPending();
                notify(getLocal(), { source: 'sync', committed: true });
                if (hasDeferredRemote) {
                    const deferred = deferredRemote;
                    hasDeferredRemote = false;
                    if (!valuesEqual(deferred, committedValue)) handleRemote(deferred);
                }
                if (pending) flush();
            });
        }

        function save(value, settings = {}) {
            if (!canWrite()) return false;
            const localValue = normalize(value);
            if (!pending || (protectFromStalePending && !pending._trusted)) {
                pending = {
                    base: cloneValue(ready ? serverSnapshot : initialLocalBaseline),
                    local: cloneValue(localValue),
                    _trusted: true
                };
                retainUntrustedStoredPending = false;
            } else {
                pending.local = cloneValue(localValue);
            }
            if (settings.automatic === true) {
                // Generated empty rows are a baseline for subsequent typing,
                // not instructions to clear rows created by another device.
                pending.draftBase = mergeInitialValue(localValue, pending.draftBase ?? pending.base);
            }
            pending.savedAt = new Date().toISOString();
            pending.buildNumber = BUILD_NUMBER;
            pending._trusted = true;
            persistCurrentPending();
            if (paused) return false;
            flush();
            return !paused;
        }

        function handleRemote(rawValue) {
            const remote = normalize(rawValue);
            const local = getLocal();
            // Do not update the model behind a focused input while leaving its
            // DOM value unchanged. A later blur would otherwise save that old value.
            if (refreshing || inFlight || paused || (isEditing() && !valuesEqual(remote, serverSnapshot))) {
                deferredRemote = cloneValue(remote);
                hasDeferredRemote = true;
                if (!ready) {
                    serverSnapshot = cloneValue(initialLocalBaseline);
                    ready = true;
                }
                if (pending && !inFlight && !paused && !refreshing) pauseForRefresh();
                return;
            }

            if (!ready) {
                const previousServer = storedServerSnapshot.found ? cloneValue(storedServerSnapshot.value) : null;
                serverSnapshot = cloneValue(remote);
                if (pending) {
                    if (protectFromStalePending && !pending._trusted) {
                        // The raw pending payload was preserved by
                        // preserveStalePending(). Do not replay unknown old state
                        // into Firebase; use the current server value as truth.
                        pending = null;
                        setLocal(remote, {
                            source: 'initial',
                            quarantinedStalePending: true
                        });
                    } else {
                        if (pending.requiresRefresh || !valuesEqual(normalize(pending.base), remote)) {
                            deferredRemote = cloneValue(remote);
                            hasDeferredRemote = true;
                            ready = true;
                            pauseForRefresh();
                            return;
                        }
                        setLocal(pending.local, { source: 'initial', pending: true });
                    }
                } else if (options.serverWinsInitial !== false && (!isEmptyValue(remote) || previousServer !== null)) {
                    // A plain browser cache is not proof of an unsent edit.
                    // Only an explicit pending draft may be replayed after reload.
                    setLocal(remote, { source: 'initial' });
                } else if (previousServer !== null) {
                    // A cached local collection can be incomplete after a failed
                    // sync. Treat the server snapshot as the baseline and keep
                    // only local-only values, instead of interpreting missing
                    // cached rows as intentional deletions.
                    const merged = mergeInitialValue(local, remote);
                    if (!valuesEqual(merged, remote)) {
                        pending = {
                            base: cloneValue(remote), local: cloneValue(merged),
                            draftBase: cloneValue(merged), _trusted: true
                        };
                        setLocal(merged, { source: 'initial', pending: true });
                    } else {
                        setLocal(remote, { source: 'initial' });
                    }
                } else if (isEmptyValue(remote) && !isEmptyValue(local)) {
                    pending = {
                        base: cloneValue(emptyValue), local: cloneValue(local),
                        draftBase: cloneValue(local), _trusted: true
                    };
                    setLocal(local, { source: 'initial', pending: true });
                } else if (mergeInitial && !isEmptyValue(local) && !isEmptyValue(remote)) {
                    const merged = mergeInitialValue(local, remote);
                    if (!valuesEqual(merged, remote)) {
                        pending = {
                            base: cloneValue(remote), local: cloneValue(merged),
                            draftBase: cloneValue(merged), _trusted: true
                        };
                        setLocal(merged, { source: 'initial', pending: true });
                    } else {
                        setLocal(remote, { source: 'initial' });
                    }
                } else {
                    setLocal(remote, { source: 'initial' });
                }
                ready = true;
                persistSnapshot(serverSnapshotKey, serverSnapshot);
                persistCurrentPending();
                notify(getLocal(), { source: 'initial', pending: Boolean(pending) });
                flush();
                return;
            }

            const previousServer = cloneValue(serverSnapshot);
            if (pending) {
                if (!valuesEqual(normalize(pending.base), remote)) {
                    deferredRemote = cloneValue(remote);
                    hasDeferredRemote = true;
                    pauseForRefresh();
                    return;
                }
                flush();
                return;
            }

            hasDeferredRemote = false;
            deferredRemote = undefined;
            serverSnapshot = cloneValue(remote);
            persistSnapshot(serverSnapshotKey, serverSnapshot);
            const merged = merge(previousServer, local, remote);
            if (!valuesEqual(merged, remote)) {
                pending = { base: cloneValue(previousServer), local: cloneValue(merged), _trusted: true };
                setLocal(merged, { source: 'remote', pending: true });
                persistCurrentPending();
                notify(getLocal(), { source: 'remote', pending: true });
                flush();
                return;
            }

            if (!valuesEqual(local, remote)) {
                setLocal(remote, { source: 'remote' });
                notify(getLocal(), { source: 'remote' });
            }
        }

        if (pending && (!protectFromStalePending || pending._trusted)) {
            setLocal(pending.local, { source: 'pending' });
        }

        registerPathSyncFlusher(flush);

        if (database) {
            database.ref(path).on('value', snapshot => handleRemote(snapshot.val()));
        }

        return {
            save,
            flush,
            isReady: () => ready,
            getServerSnapshot: () => cloneValue(serverSnapshot),
            getPending: () => cloneValue(pending),
            isPaused: () => paused
        };
    }

    global.SharedSync = {
        BUILD_ID,
        BUILD_NUMBER,
        escapeHtml,
        cloneValue,
        readLocalJson,
        valuesEqual,
        mergeThreeWay,
        reapplyDraft,
        mergeInitialValue,
        mergeRestoreValue,
        guardReference,
        guardDatabase,
        canWrite,
        startVersionGuard,
        flushAll: flushRegisteredPathSyncs,
        restoreSafely,
        createPathSync
    };
})(window);
