const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        key(index) { return Array.from(values.keys())[index] || null; },
        get length() { return values.size; }
    };
}

function loadSharedSync(storage = createStorage()) {
    const listeners = {};
    const window = {
        location: { href: 'http://127.0.0.1/index.html', protocol: 'http:' },
        history: { state: null, replaceState() {} },
        addEventListener(name, listener) { listeners[name] = listener; },
        localStorage: storage
    };
    const document = {
        visibilityState: 'visible',
        addEventListener() {}
    };
    const context = {
        window,
        document,
        localStorage: storage,
        URL,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        JSON,
        Proxy,
        Promise
    };
    vm.runInNewContext(fs.readFileSync('shared-sync.js', 'utf8'), context, {
        filename: 'shared-sync.js'
    });
    return window.SharedSync;
}

function createFakeDatabase(initialRemote) {
    let remote = JSON.parse(JSON.stringify(initialRemote));
    let valueListener = null;
    const snapshot = () => ({ val: () => JSON.parse(JSON.stringify(remote)) });
    return {
        ref() {
            return {
                on(event, listener) {
                    if (event === 'value') valueListener = listener;
                },
                transaction(update, complete) {
                    remote = update(JSON.parse(JSON.stringify(remote)));
                    complete(null, true, snapshot());
                }
            };
        },
        emit() {
            valueListener(snapshot());
        },
        value() {
            return JSON.parse(JSON.stringify(remote));
        }
    };
}

function inventory(delivery, updatedAt) {
    return {
        '2026-8': {
            film: {
                carryover: 0,
                days: {
                    19: { delivery, _syncUpdatedAt: updatedAt }
                }
            }
        }
    };
}

function testMergeRules() {
    const sync = loadSharedSync();

    const cleared = sync.mergeThreeWay(
        inventory(12, 100),
        inventory(0, 200),
        inventory(12, 100)
    );
    assert.strictEqual(cleared['2026-8'].film.days[19].delivery, 0);

    const remoteNewer = sync.mergeThreeWay(
        inventory(12, 100),
        inventory(0, 200),
        inventory(7, 300)
    );
    assert.strictEqual(remoteNewer['2026-8'].film.days[19].delivery, 7);

    const localNewer = sync.mergeThreeWay(
        inventory(12, 100),
        inventory(0, 400),
        inventory(7, 300)
    );
    assert.strictEqual(localNewer['2026-8'].film.days[19].delivery, 0);

    const records = sync.mergeThreeWay(
        [{ id: 'a', count: 12, _syncUpdatedAt: 100 }],
        [{ id: 'a', count: 0, _syncUpdatedAt: 400 }],
        [{ id: 'a', count: 7, _syncUpdatedAt: 300 }]
    );
    assert.strictEqual(records[0].count, 0);

    const staleTabBase = {
        day: { delivery: 12, production: 0, _syncUpdatedAt: 100 }
    };
    const staleTabLocal = {
        day: { delivery: 12, production: 1, _syncUpdatedAt: 300 }
    };
    const currentRemote = {
        day: { delivery: 0, production: 0, _syncUpdatedAt: 200 }
    };
    const unrelatedEdit = sync.mergeThreeWay(staleTabBase, staleTabLocal, currentRemote);
    assert.strictEqual(unrelatedEdit.day.delivery, 0);
    assert.strictEqual(unrelatedEdit.day.production, 1);

    const blankNote = sync.mergeThreeWay(
        { '2026-08-19': 'old note' },
        { '2026-08-19': '' },
        { '2026-08-19': 'old note' }
    );
    assert.strictEqual(blankNote['2026-08-19'], '');
}

function testEditBeforeInitialRemote() {
    const storage = createStorage();
    const sync = loadSharedSync(storage);
    const database = createFakeDatabase(inventory(12, 100));
    let local = inventory(12, 100);
    const pathSync = sync.createPathSync({
        database,
        path: 'inventory',
        emptyValue: {},
        pendingStorageKey: 'pending',
        serverSnapshotStorageKey: 'snapshot',
        getLocal: () => local,
        setLocal: value => { local = value; }
    });

    local = inventory(0, 200);
    pathSync.save(local);
    database.emit();
    assert.strictEqual(database.value()['2026-8'].film.days[19].delivery, 0);
}

function testStalePendingDoesNotDiscardNewEdit() {
    const stalePayload = JSON.stringify({
        base: inventory(12, 50),
        local: inventory(99, 60),
        savedAt: new Date().toISOString(),
        buildNumber: 2026082142,
        trusted: true
    });
    const storage = createStorage({ pending: stalePayload });
    const sync = loadSharedSync(storage);
    const database = createFakeDatabase(inventory(12, 100));
    let local = inventory(12, 100);
    const pathSync = sync.createPathSync({
        database,
        path: 'inventory',
        emptyValue: {},
        pendingStorageKey: 'pending',
        serverSnapshotStorageKey: 'snapshot',
        getLocal: () => local,
        setLocal: value => { local = value; }
    });

    local = inventory(0, 200);
    pathSync.save(local);
    database.emit();
    assert.strictEqual(database.value()['2026-8'].film.days[19].delivery, 0);
    assert.ok(storage.getItem('pending_stale_backup'));
}

testMergeRules();
testEditBeforeInitialRemote();
testStalePendingDoesNotDiscardNewEdit();
console.log('shared-sync regression tests passed');
