'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const source = fs.readFileSync('shared-sync.js', 'utf8');

function storage() {
    const entries = new Map();
    return {
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, String(value)),
        removeItem: key => entries.delete(key)
    };
}

function fixture(saved = storage(), options = {}) {
    const elements = new Map();
    const document = { activeElement: null, visibilityState: 'visible', addEventListener() {} };
    function element() {
        const children = [];
        return {
            id: '', children, textContent: '', disabled: false,
            set innerHTML(html) {
                for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
                    const child = element();
                    child.id = id;
                    children.push(child);
                    elements.set(id, child);
                }
            },
            setAttribute() {},
            querySelector: selector => elements.get(selector.slice(1)),
            addEventListener(type, listener) { this[type] = listener; },
            appendChild(child) { children.push(child); if (child.id) elements.set(child.id, child); },
            focus() { document.activeElement = this; },
            blur() { document.activeElement = null; },
            remove() { elements.delete(this.id); children.forEach(child => child.remove()); }
        };
    }
    document.body = element();
    document.head = element();
    document.createElement = element;
    document.getElementById = id => elements.get(id) || null;
    document.querySelector = selector => selector === 'meta[name="app-build-id"]' && options.pageBuildId
        ? { content: options.pageBuildId } : null;
    const navigations = [];
    const window = {
        location: { href: options.href || 'http://localhost/index.html', protocol: 'http:',
            replace(url) { navigations.push(url); } },
        history: { state: null, replaceState() {} },
        localStorage: saved, navigator: { onLine: true }, addEventListener() {}
    };
    vm.runInNewContext(source, {
        window, document, localStorage: saved, URL, console,
        fetch: options.fetch, setTimeout, clearTimeout,
        setInterval() { return 1; }, clearInterval() {}
    });
    return {
        sync: window.SharedSync, document, saved, elements, navigations,
        paused: () => elements.has('sync-refresh-lock'),
        refresh: () => elements.get('sync-refresh-retry').click()
    };
}

function database(seed) {
    let remote = copy(seed);
    let listener;
    const acknowledgements = [];
    const db = {
        writes: 0, reads: 0, transactions: 0, failReads: false, hold: false, race: null,
        ref() {
            return {
                on(type, callback) { listener = callback; },
                get() {
                    db.reads++;
                    if (db.failReads) return Promise.reject(new Error('test-offline'));
                    return Promise.resolve(snapshot(remote));
                },
                transaction(update, complete, applyLocally) {
                    assert.equal(applyLocally, false, 'intermediate local transaction values must not be broadcast');
                    db.transactions++;
                    let value = update(copy(remote));
                    if (db.race) {
                        remote = copy(db.race);
                        db.race = null;
                        value = update(copy(remote));
                    }
                    const committed = value !== undefined;
                    if (committed) { remote = copy(value); db.writes++; }
                    const result = snapshot(remote);
                    if (db.hold) acknowledgements.push(() => { db.emit(result.val()); complete(null, committed, result); });
                    else { db.emit(result.val()); complete(null, committed, result); }
                }
            };
        },
        value: () => copy(remote),
        replace(value, emit = false) { remote = copy(value); if (emit) db.emit(); },
        emit(value = remote) { if (listener) listener(snapshot(value)); },
        acknowledge() { assert.ok(acknowledgements.length); acknowledgements.shift()(); }
    };
    return db;
}

function snapshot(value) {
    const data = copy(value);
    return { val: () => copy(data) };
}

function client(f, db, seed, options = {}) {
    let local = copy(seed);
    const path = options.path || 'report';
    const sync = f.sync.createPathSync({
        database: db, path, emptyValue: {}, serverWinsInitial: true,
        pendingStorageKey: path + '_pending', serverSnapshotStorageKey: path + '_snapshot',
        getLocal: () => local,
        setLocal: value => { local = copy(value); },
        ...options
    });
    return {
        sync, get: () => copy(local),
        edit(value) { local = copy(value); },
        save(value, settings) { local = copy(value); return sync.save(local, settings); }
    };
}

test('one device can save A then B repeatedly without a stale-data notice', () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    for (let n = 1; n <= 20; n++) {
        c.save({ ...c.get(), A: n });
        c.save({ ...c.get(), B: n + 1 });
    }
    assert.deepEqual(db.value(), { A: 20, B: 21 });
    assert.equal(c.sync.getPending(), null);
    assert.equal(f.paused(), false);
});

test('an app update preserves a debounced input and existing backups without writing server data', async () => {
    const saved = storage();
    saved.setItem('nippo_auto_backup_2026-10-20', '{"records":"existing-backup"}');
    saved.setItem('rollInventoryData', '{"existing":"cache"}');
    const f = fixture(saved, { href: 'http://localhost/index.html?view=stock#inventory',
        fetch: async () => ({ ok: true, json: async () => ({ buildNumber: f.sync.BUILD_NUMBER + 1 }) }) });
    const db = database({ C: 10, G: 0 });
    const c = client(f, db, db.value());
    db.emit();
    c.edit({ C: 10, G: 123 });
    await f.sync.checkVersion();
    assert.equal(f.sync.canWrite(), false);
    assert.equal(db.writes, 0);
    assert.equal(JSON.parse(saved.getItem('report_pending')).local.G, 123);
    assert.equal(JSON.parse(saved.getItem('report_pending')).requiresRefresh, true);
    assert.equal(saved.getItem('nippo_auto_backup_2026-10-20'), '{"records":"existing-backup"}');
    assert.equal(saved.getItem('rollInventoryData'), '{"existing":"cache"}');
    f.elements.get('app-update-lock-reload').click();
    const destination = new URL(f.navigations[0]);
    assert.equal(destination.searchParams.get('view'), 'stock');
    assert.equal(destination.hash, '#inventory');
    assert.ok(destination.searchParams.has('_app_refresh'));
    db.replace({ C: 99, G: 0 });
    const reloaded = fixture(saved);
    const next = client(reloaded, db, db.value());
    db.emit();
    assert.equal(next.sync.isPaused(), true);
    assert.equal(db.writes, 0);
    await reloaded.refresh();
    assert.deepEqual(db.value(), { C: 99, G: 123 });
});

test('change handlers finalize locally before the version lock without sending an old write', async () => {
    const f = fixture(storage(), { fetch: async () => ({ ok: true,
        json: async () => ({ buildNumber: f.sync.BUILD_NUMBER + 1 }) }) });
    const db = database({ A: 0 });
    const c = client(f, db, db.value());
    db.emit();
    f.document.activeElement = { blur() { c.save({ A: 456 }); f.document.activeElement = null; } };
    await f.sync.checkVersion();
    assert.equal(db.transactions, 0);
    assert.equal(JSON.parse(f.saved.getItem('report_pending')).local.A, 456);
});

test('a failed local draft checkpoint prevents page reload and retains the input in memory', async () => {
    const saved = storage();
    const setItem = saved.setItem;
    saved.setItem = (key, value) => {
        if (key === 'report_pending') throw new Error('test-quota');
        setItem(key, value);
    };
    const f = fixture(saved, { fetch: async () => ({ ok: true,
        json: async () => ({ buildNumber: f.sync.BUILD_NUMBER + 1 }) }) });
    const db = database({ A: 0 });
    const c = client(f, db, db.value());
    db.emit();
    c.edit({ A: 789 });
    await f.sync.checkVersion();
    assert.equal(f.sync.reloadCurrentPageFresh(), false);
    assert.equal(f.navigations.length, 0);
    assert.deepEqual(c.get(), { A: 789 });
    assert.equal(db.writes, 0);
    assert.match(f.elements.get('app-update-lock-message').textContent, /再読み込みを止めています/);
});

test('mixed cached HTML and JavaScript versions lock writes even with no metadata response', () => {
    const f = fixture(storage(), { pageBuildId: 'different-html-build' });
    f.sync.startVersionGuard();
    assert.equal(f.sync.canWrite(), false);
    assert.ok(f.elements.has('app-update-lock'));
});

test('a matching release does not create drafts or block normal saves', async () => {
    const f = fixture(storage(), { fetch: async () => ({ ok: true,
        json: async () => ({ buildNumber: f.sync.BUILD_NUMBER, buildId: f.sync.BUILD_ID }) }) });
    const db = database({ A: 5 });
    const c = client(f, db, db.value());
    db.emit();
    await f.sync.checkVersion();
    assert.equal(f.sync.canWrite(), true);
    assert.equal(f.elements.has('app-update-lock'), false);
    assert.equal(c.sync.getPending(), null);
    assert.equal(db.writes, 0);
});

test('a delayed C-F update blocks G before writing and retains G through refresh', async () => {
    const f = fixture();
    const base = { C: 0, D: 0, E: 0, F: 0, G: 0 };
    const db = database(base);
    const c = client(f, db, base);
    db.emit();
    db.replace({ ...base, C: 11, D: 22, E: 33, F: 44 });
    assert.equal(c.save({ ...c.get(), G: 55 }), false);
    assert.equal(db.writes, 0);
    assert.equal(f.paused(), true);
    assert.equal(c.sync.getPending().local.G, 55);
    assert.equal(JSON.parse(f.saved.getItem('report_pending')).requiresRefresh, true);
    c.sync.flush();
    assert.equal(db.transactions, 1, 'a blocked write must not retry silently');
    await f.refresh();
    assert.deepEqual(db.value(), { C: 11, D: 22, E: 33, F: 44, G: 55 });
    assert.deepEqual(c.get(), db.value());
    assert.equal(f.paused(), false);
    assert.equal(c.sync.getPending(), null);
});

test('updates received while editing do not change the model behind the focused field', async () => {
    const f = fixture();
    const base = { C: 0, D: 0, G: 0 };
    const db = database(base);
    let editing = false;
    const c = client(f, db, base, { isEditing: () => editing });
    db.emit();
    editing = true;
    db.replace({ C: 12, D: 34, G: 0 }, true);
    assert.deepEqual(c.get(), base);
    assert.equal(f.paused(), false, 'receiving a change alone must not interrupt typing');
    c.save({ C: 0, D: 0, G: 56 });
    assert.equal(db.transactions, 0, 'known deferred updates are blocked before starting a transaction');
    editing = false;
    await f.refresh();
    assert.deepEqual(db.value(), { C: 12, D: 34, G: 56 });
});

test('server changes during a Firebase transaction retry also abort the write', async () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.race = { A: 123, B: 0 };
    c.save({ A: 0, B: 456 });
    assert.equal(db.writes, 0);
    assert.deepEqual(db.value(), { A: 123, B: 0 });
    assert.equal(f.paused(), true);
    await f.refresh();
    assert.deepEqual(db.value(), { A: 123, B: 456 });
});

test('additional keystrokes during an acknowledgement remain pending without false warnings', () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.hold = true;
    c.save({ A: 1, B: 0 });
    c.save({ A: 12, B: 3 });
    db.acknowledge();
    assert.deepEqual(db.value(), { A: 12, B: 3 });
    db.acknowledge();
    assert.deepEqual(c.get(), { A: 12, B: 3 });
    assert.equal(c.sync.getPending(), null);
    assert.equal(f.paused(), false);
});

test('a paused draft survives a browser reload without being replayed automatically', async () => {
    const saved = storage();
    const f = fixture(saved);
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.replace({ A: 10, B: 0 });
    c.save({ A: 0, B: 20 });
    const reloaded = fixture(saved);
    const next = client(reloaded, db, c.get());
    db.emit();
    assert.equal(next.sync.isPaused(), true);
    assert.equal(db.writes, 0);
    assert.equal(next.get().B, 20);
    await reloaded.refresh();
    assert.deepEqual(db.value(), { A: 10, B: 20 });
});

test('failed refresh retains the draft and blocks writes until a successful retry', async () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.replace({ A: 10, B: 0 });
    c.save({ A: 0, B: 20 });
    db.failReads = true;
    assert.equal(await f.refresh(), false);
    assert.equal(f.paused(), true);
    assert.equal(c.sync.getPending().local.B, 20);
    assert.equal(db.writes, 0);
    db.failReads = false;
    await f.refresh();
    assert.deepEqual(db.value(), { A: 10, B: 20 });
});

test('zero, intentional blanks, deletions and another device additions survive a refresh', async () => {
    const f = fixture();
    const base = { zero: 5, note: 'old', remove: 1, untouched: 12 };
    const db = database(base);
    const c = client(f, db, base);
    db.emit();
    db.replace({ ...base, untouched: 0, added: 99 });
    c.save({ zero: 0, note: '', untouched: 12 });
    await f.refresh();
    assert.deepEqual(db.value(), { zero: 0, note: '', untouched: 0, added: 99 });
});

test('keyed report rows preserve all nine remote counts while keeping a tenth local edit', async () => {
    const f = fixture();
    const base = Array.from('ABCDEFGHIJ', machine => ({ _syncKey: machine, count: 0, notes: '' }));
    const db = database(base);
    const c = client(f, db, base, { emptyValue: [] });
    db.emit();
    db.replace(base.map((row, i) => ({ ...row, count: i < 9 ? i + 1 : 0 })));
    c.save(base.map(row => row._syncKey === 'J' ? { ...row, notes: 'draft', count: 100 } : row));
    await f.refresh();
    assert.deepEqual(db.value().map(row => row.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    assert.equal(db.value()[9].notes, 'draft');
});

test('a second update during refresh is checked again before saving', async () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.replace({ A: 10, B: 0 });
    c.save({ A: 0, B: 20 });
    db.race = { A: 30, B: 0 };
    await f.refresh();
    assert.equal(f.paused(), true);
    assert.equal(db.writes, 0);
    await f.refresh();
    assert.deepEqual(db.value(), { A: 30, B: 20 });
});

test('restore rechecks a server update instead of replacing it with its earlier read', async () => {
    const f = fixture();
    const db = database({ A: 1 });
    db.race = { A: 2 };
    const restored = f.sync.restoreSafely(db, 'report', { A: 0, B: 3 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.writes, 0);
    assert.equal(f.paused(), true);
    await f.refresh();
    assert.equal((await restored).committed, true);
    assert.deepEqual(db.value(), { A: 2, B: 3 });
});

test('stock day arrays preserve another date when a local value is saved after refresh', async () => {
    for (const monthLength of [28, 29, 30, 31]) {
        for (let editedDay = 1; editedDay <= monthLength; editedDay++) {
            const f = fixture();
            const days = [null, ...Array.from({ length: monthLength }, () => ({ arrival: 0, usage: 0 }))];
            const base = { month: { item: { carryover: 30, days } } };
            const db = database(base);
            const c = client(f, db, base);
            db.emit();
            const remoteDay = editedDay === monthLength ? 1 : editedDay + 1;
            const changed = copy(base);
            changed.month.item.days[remoteDay].arrival = 12;
            db.replace(changed);
            const local = c.get();
            local.month.item.days[editedDay].usage = 3;
            c.save(local);
            await f.refresh();
            assert.equal(db.value().month.item.days[remoteDay].arrival, 12);
            assert.equal(db.value().month.item.days[editedDay].usage, 3);
        }
    }
});

test('a remote deletion is not resurrected by an unrelated local edit after refresh', async () => {
    const f = fixture();
    const base = [{ id: 'A', count: 12 }, { id: 'B', count: 0 }];
    const db = database(base);
    const c = client(f, db, base, { emptyValue: [] });
    db.emit();
    db.replace([{ id: 'B', count: 0 }]);
    c.save([{ id: 'A', count: 12 }, { id: 'B', count: 3 }]);
    await f.refresh();
    assert.deepEqual(db.value(), [{ id: 'B', count: 3 }]);
});

test('concurrently generated empty report rows cannot clear another device counts', async () => {
    const f = fixture();
    const db = database([]);
    const c = client(f, db, [], { emptyValue: [] });
    db.emit();
    const defaults = Array.from('ABCDEFGHIJ', machine => ({ _syncKey: machine, count: 0 }));
    db.replace(defaults.map((row, i) => ({ ...row, count: i < 9 ? i + 1 : 0 })));
    c.save(defaults, { automatic: true });
    c.save(defaults.map(row => row._syncKey === 'J' ? { ...row, count: 100 } : row));
    await f.refresh();
    assert.deepEqual(db.value().map(row => row.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
});

test('an ordinary cached collection cannot silently reupload records deleted on another device', () => {
    const f = fixture();
    const cached = [{ id: 'old', count: 123 }, { id: 'keep', count: 4 }];
    f.saved.setItem('report_snapshot', JSON.stringify(cached));
    const db = database([{ id: 'keep', count: 5 }]);
    const c = client(f, db, cached, { emptyValue: [], mergeInitial: true });
    db.emit();
    assert.deepEqual(c.get(), [{ id: 'keep', count: 5 }]);
    assert.equal(db.writes, 0);
    assert.equal(f.paused(), false);
});

test('upgrading preserves a different older pending draft even when a recovery copy already exists', () => {
    const saved = storage();
    saved.setItem('report_pending_stale_backup', JSON.stringify({ rawValue: 'older recovery' }));
    const rawValue = JSON.stringify({
        base: { A: 0 }, local: { A: 123 }, savedAt: new Date().toISOString(),
        buildNumber: 2026101952, trusted: true
    });
    saved.setItem('report_pending', rawValue);
    const f = fixture(saved);
    const db = database({ A: 456 });
    client(f, db, { A: 0 });
    db.emit();
    assert.equal(JSON.parse(saved.getItem('report_pending_stale_backup')).rawValue, 'older recovery');
    assert.equal(JSON.parse(saved.getItem('report_pending_stale_backup_1')).rawValue, rawValue);
    assert.deepEqual(db.value(), { A: 456 });
});

for (const previousBuild of [2026102054, 2026102055]) test(`a guarded ${previousBuild} draft survives an upgrade and requires refresh before replaying its edits`, async () => {
    const saved = storage();
    saved.setItem('report_pending', JSON.stringify({
        base: { A: 0, B: 0 }, local: { A: 0, B: 20 }, savedAt: new Date().toISOString(),
        buildNumber: previousBuild, trusted: true
    }));
    const f = fixture(saved);
    const db = database({ A: 10, B: 0 });
    const c = client(f, db, { A: 0, B: 20 });
    db.emit();
    assert.equal(f.paused(), true);
    assert.equal(db.writes, 0);
    assert.equal(c.sync.getPending().local.B, 20);
    await f.refresh();
    assert.deepEqual(db.value(), { A: 10, B: 20 });
    assert.equal(c.sync.getPending(), null);
});

test('applying a later live update clears an older deferred update before the next edit', () => {
    const f = fixture();
    const base = { A: 0, B: 0 };
    const db = database(base);
    let editing = false;
    const c = client(f, db, base, { isEditing: () => editing });
    db.emit();
    editing = true;
    db.replace({ A: 1, B: 0 }, true);
    editing = false;
    db.replace({ A: 2, B: 0 }, true);
    assert.deepEqual(c.get(), { A: 2, B: 0 });
    assert.equal(c.save({ ...c.get(), B: 3 }), true);
    assert.equal(f.paused(), false);
    assert.deepEqual(db.value(), { A: 2, B: 3 });
});

test('an initial cache upload cannot replace newer counts when the user refreshes a concurrent write', async () => {
    const f = fixture();
    const defaults = Array.from('ABCDEFGHIJ', machine => ({ _syncKey: machine, count: 0 }));
    const db = database([]);
    db.hold = true;
    db.race = defaults.map((row, i) => ({ ...row, count: i < 9 ? i + 1 : 0 }));
    const c = client(f, db, defaults, { emptyValue: [] });
    db.emit();
    c.save(c.get().map(row => row._syncKey === 'J' ? { ...row, count: 100 } : row));
    db.acknowledge();
    assert.equal(db.writes, 0);
    assert.equal(f.paused(), true);
    db.hold = false;
    await f.refresh();
    assert.deepEqual(db.value().map(row => row.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    assert.equal(c.sync.getPending(), null);
});

test('a failed screen refresh keeps every paused path available for a successful retry', async () => {
    const f = fixture();
    let failRender = true;
    const firstDb = database({ A: 0, B: 0 });
    const first = client(f, firstDb, firstDb.value(), {
        path: 'first',
        onRemote(value, meta) {
            if (meta.source === 'refresh' && failRender) {
                failRender = false;
                throw new Error('test-render-failed');
            }
        }
    });
    const secondDb = database({ A: 0, B: 0 });
    const second = client(f, secondDb, secondDb.value(), { path: 'second' });
    firstDb.emit();
    secondDb.emit();
    firstDb.replace({ A: 10, B: 0 });
    secondDb.replace({ A: 30, B: 0 });
    first.save({ A: 0, B: 20 });
    second.save({ A: 0, B: 40 });
    assert.equal(await f.refresh(), false);
    assert.equal(first.sync.isPaused(), true);
    assert.equal(second.sync.isPaused(), true);
    assert.equal(firstDb.writes + secondDb.writes, 0);
    assert.equal(f.paused(), true);
    assert.equal(await f.refresh(), true);
    assert.deepEqual(firstDb.value(), { A: 10, B: 20 });
    assert.deepEqual(secondDb.value(), { A: 30, B: 40 });
    assert.equal(first.sync.getPending(), null);
    assert.equal(second.sync.getPending(), null);
    assert.equal(f.paused(), false);
});

test('an acknowledgement cannot replace edits still waiting for the autosave timer', () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.hold = true;
    c.save({ A: 1, B: 0 });
    c.edit({ A: 123, B: 45 });
    db.acknowledge();
    assert.deepEqual(c.get(), { A: 123, B: 45 });
    c.save(c.get());
    while (c.sync.getPending()) db.acknowledge();
    assert.deepEqual(db.value(), { A: 123, B: 45 });
    assert.equal(f.paused(), false);
});

test('a stale acknowledgement retains the next edit before its autosave timer runs', async () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.hold = true;
    db.race = { A: 10, B: 0 };
    c.save({ A: 0, B: 1 });
    c.edit({ A: 0, B: 123 });
    db.acknowledge();
    assert.equal(c.sync.getPending().local.B, 123);
    assert.equal(JSON.parse(f.saved.getItem('report_pending')).local.B, 123);
    db.hold = false;
    await f.refresh();
    assert.deepEqual(db.value(), { A: 10, B: 123 });
});

test('an edit made during the latest-data read remains in the resumed draft', async () => {
    const f = fixture();
    const db = database({ A: 0, B: 0 });
    const c = client(f, db, db.value());
    db.emit();
    db.replace({ A: 10, B: 0 });
    c.save({ A: 0, B: 1 });
    let releaseRead;
    const reference = db.ref.bind(db);
    db.ref = () => ({
        ...reference(),
        get: () => new Promise(resolve => { releaseRead = () => resolve(snapshot(db.value())); })
    });
    const refreshing = f.refresh();
    c.edit({ A: 0, B: 123 });
    releaseRead();
    assert.equal(await refreshing, true);
    assert.deepEqual(db.value(), { A: 10, B: 123 });
    assert.equal(f.paused(), false);
});

test('two devices retain separate fields through repeated delayed and reordered acknowledgements', async () => {
    let remote = { A: 0, B: 0 };
    const devices = [];
    const requests = [];
    function connect() {
        const device = { listener: null, broadcast: true };
        devices.push(device);
        return {
            ref() {
                return {
                    on(type, listener) { device.listener = listener; },
                    get: () => Promise.resolve(snapshot(remote)),
                    transaction(update, complete, applyLocally) {
                        assert.equal(applyLocally, false);
                        requests.push(() => {
                            const value = update(copy(remote));
                            const committed = value !== undefined;
                            if (committed) remote = copy(value);
                            const saved = snapshot(remote);
                            const notify = () => devices.forEach(peer => {
                                if (peer.broadcast) peer.listener(saved);
                            });
                            if (requests.length % 2) notify();
                            complete(null, committed, saved);
                            if (!(requests.length % 2)) notify();
                        });
                    }
                };
            }
        };
    }
    const firstFixture = fixture();
    const secondFixture = fixture();
    const first = client(firstFixture, connect(), remote);
    const second = client(secondFixture, connect(), remote);
    devices.forEach(device => device.listener(snapshot(remote)));
    const drain = () => {
        let count = 0;
        while (requests.length) {
            assert.ok(++count < 30, 'the write queue must settle');
            requests.shift()();
        }
    };
    for (let n = 1; n <= 80; n++) {
        devices[0].broadcast = n % 3 === 0;
        devices[1].broadcast = n % 4 === 0;
        first.save({ ...first.get(), A: n });
        second.save({ ...second.get(), B: n * 2 });
        if (n % 2) requests.reverse();
        drain();
        for (const f of [firstFixture, secondFixture]) {
            if (f.paused()) await f.refresh();
            drain();
        }
        assert.deepEqual(remote, { A: n, B: n * 2 }, 'both edits must survive round ' + n);
    }
});
