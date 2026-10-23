const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const HOST = 'fixture-default-rtdb.asia-southeast1.firebasedatabase.app';
const CONFIG = { databaseURL: 'https://' + HOST };

function harness(initial = {}) {
    const values = new Map(Object.entries(initial));
    const removed = [];
    const storage = {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { removed.push(key); values.delete(key); }
    };
    const nodes = new Map();
    function element() {
        const children = new Map();
        return {
            style: {}, textContent: '', events: {},
            setAttribute() {},
            appendChild(child) { nodes.set(child.id, child); },
            remove() { nodes.delete(this.id); },
            addEventListener(event, handler) { this.events[event] = handler; },
            querySelector(selector) {
                if (!children.has(selector)) children.set(selector, element());
                return children.get(selector);
            }
        };
    }
    const timers = new Map();
    let nextTimer = 0;
    let time = 0;
    const setTimer = (handler, delay) => {
        const id = ++nextTimer;
        timers.set(id, { handler, at: time + delay });
        return id;
    };
    const navigations = [];
    const document = {
        head: element(), body: element(), activeElement: null,
        createElement: element,
        getElementById: id => nodes.get(id),
        addEventListener() {}
    };
    const window = {
        localStorage: storage,
        WebSocket: class {},
        location: {
            href: 'https://fixture.test/nippo/index.html?view=stock', protocol: 'https:',
            replace(url) { navigations.push(url); }
        },
        history: { state: null, replaceState() {} },
        addEventListener() {}
    };
    vm.runInNewContext(fs.readFileSync('shared-sync.js', 'utf8'), {
        window, document, localStorage: storage, URL, console,
        setTimeout: setTimer, clearTimeout: id => timers.delete(id),
        setInterval: setTimer, clearInterval: id => timers.delete(id),
        Date, JSON, Proxy, Promise
    });
    return {
        sync: window.SharedSync, storage, values, removed, nodes, window, navigations,
        advance(ms) {
            time += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= time) { timers.delete(id); timer.handler(); }
            }
        }
    };
}

function database() {
    const listeners = new Map();
    let writes = 0;
    return {
        app: { options: CONFIG }, listeners,
        ref(path) {
            return {
                on(event, value, error) { listeners.set(path, { value, error }); },
                transaction() { writes++; throw new Error('Unexpected write'); }
            };
        },
        emit(path, value) { listeners.get(path).value({ val: () => value }); },
        fail(path, code) { listeners.get(path).error({ code }); },
        get writes() { return writes; }
    };
}

test('connection recovery retains originals and changes only this database transport metadata', () => {
    const initial = {
        'firebase:previous_websocket_failure': 'true',
        ['firebase:host:' + HOST]: '"s-obsolete.asia-southeast1.firebasedatabase.app"',
        'firebase:host:another.firebaseio.com': '"s-other.firebaseio.com"',
        nippo_records: '[{"count":123}]',
        rollInventoryData: '{"2026-10":{"film":{"carryover":9}}}',
        nippo_records_pending_sync: '{"local":[{"count":456}]}',
        'nippo_auto_backup_2026-10-21': '{"records":"keep"}'
    };
    const h = harness(initial);
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), true);
    assert.deepEqual(h.removed.sort(), ['firebase:host:' + HOST, 'firebase:previous_websocket_failure'].sort());
    const recovery = JSON.parse(h.storage.getItem('nippo_firebase_connection_recovery'));
    for (const key of h.removed) assert.equal(recovery.settings[key], initial[key]);
    for (const [key, value] of Object.entries(initial)) {
        if (!h.removed.includes(key)) assert.equal(h.storage.getItem(key), value, key);
    }
    h.storage.setItem('firebase:previous_websocket_failure', 'true');
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), true);
    assert.equal(h.storage.getItem('firebase:previous_websocket_failure'), 'true', 'do not alter a running connection twice');
});

test('a fresh browser does not add recovery data or change storage', () => {
    const h = harness({ nippo_records: '[]' });
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), true);
    assert.deepEqual([...h.values], [['nippo_records', '[]']]);
    assert.deepEqual(h.removed, []);
});

test('a later connection reset retains the current endpoint rather than an earlier recovery value', () => {
    const key = 'firebase:host:' + HOST;
    const h = harness({
        [key]: '"s-current.firebaseio.com"',
        nippo_firebase_connection_recovery: JSON.stringify({ settings: {
            [key]: '"s-earlier.firebaseio.com"',
            'firebase:host:another.firebaseio.com': '"s-other.firebaseio.com"'
        } })
    });
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), true);
    const recovered = JSON.parse(h.storage.getItem('nippo_firebase_connection_recovery')).settings;
    assert.equal(recovered[key], '"s-current.firebaseio.com"');
    assert.equal(recovered['firebase:host:another.firebaseio.com'], '"s-other.firebaseio.com"');
});

test('storage exhaustion never resets connection metadata without retaining it first', () => {
    const h = harness({ 'firebase:previous_websocket_failure': 'true' });
    h.storage.setItem = () => { throw new Error('test-quota'); };
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), false);
    assert.equal(h.storage.getItem('firebase:previous_websocket_failure'), 'true');
    assert.deepEqual(h.removed, []);
});

test('unreadable recovery metadata is left intact rather than overwritten', () => {
    const h = harness({
        'firebase:previous_websocket_failure': 'true',
        nippo_firebase_connection_recovery: 'not-json'
    });
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), false);
    assert.equal(h.storage.getItem('nippo_firebase_connection_recovery'), 'not-json');
    assert.deepEqual(h.removed, []);
});

test('silently rejected storage writes do not discard the original connection settings', () => {
    const h = harness({ 'firebase:previous_websocket_failure': 'true' });
    h.storage.setItem = () => {};
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), false);
    assert.equal(h.storage.getItem('firebase:previous_websocket_failure'), 'true');
    assert.deepEqual(h.removed, []);
});

test('a browser without WebSocket support retains its long-polling preference', () => {
    const h = harness({ 'firebase:previous_websocket_failure': 'true' });
    delete h.window.WebSocket;
    assert.equal(h.sync.prepareFirebaseConnection(CONFIG), true);
    assert.deepEqual(h.removed, []);
});

test('a successful connection stays quiet and does not issue data writes', () => {
    const h = harness();
    const raw = database();
    const guarded = h.sync.guardDatabase(raw);
    h.sync.guardDatabase(raw);
    assert.equal(raw.listeners.size, 1);
    raw.emit('.info/connected', true);
    let local = {};
    h.sync.createPathSync({ database: guarded, path: 'inventory', emptyValue: {},
        getLocal: () => local, setLocal: value => { local = value; } });
    raw.emit('inventory', { count: 99 });
    h.advance(30000);
    assert.equal(local.count, 99);
    assert.equal(raw.writes, 0);
    assert.equal(h.nodes.has('sync-connection-notice'), false);
    assert.equal(h.sync.getConnectionStatus().databases[0].waitingForData, 0);
});

test('stalled initial reads warn even if the transport connects, then recover without a reload', () => {
    const h = harness();
    const raw = database();
    const guarded = h.sync.guardDatabase(raw);
    raw.emit('.info/connected', true);
    let local = { count: 12 };
    h.sync.createPathSync({ database: guarded, path: 'inventory', emptyValue: {},
        getLocal: () => local, setLocal: value => { local = value; } });
    h.advance(9999);
    assert.equal(h.nodes.has('sync-connection-notice'), false);
    h.advance(1);
    assert.equal(h.nodes.has('sync-connection-notice'), true);
    raw.emit('inventory', { count: 99 });
    assert.equal(local.count, 99);
    assert.equal(h.nodes.has('sync-connection-notice'), false);
    assert.equal(raw.writes, 0);
});

test('permission errors are visible rather than silently leaving a cached view', () => {
    const h = harness();
    const raw = database();
    const guarded = h.sync.guardDatabase(raw);
    raw.emit('.info/connected', true);
    h.sync.createPathSync({ database: guarded, path: 'inventory', emptyValue: {},
        getLocal: () => ({ count: 12 }), setLocal() {} });
    raw.fail('inventory', 'PERMISSION_DENIED');
    h.advance(10000);
    assert.equal(h.nodes.has('sync-connection-notice'), true);
    assert.equal(h.sync.getConnectionStatus().databases[0].errors[0], 'PERMISSION_DENIED');
    assert.equal(raw.writes, 0);
});

test('the delayed unsaved-input notice names the risk and the safe cancel action', () => {
    const h = harness();
    let local = { count: 12 };
    const pathSync = h.sync.createPathSync({
        database: null, path: 'inventory', emptyValue: {}, pendingStorageKey: 'pending',
        getLocal: () => local, setLocal: value => { local = value; }
    });
    h.storage.setItem = () => { throw new Error('test-quota'); };
    local.count = 21;
    pathSync.save(local);
    h.advance(9999);
    assert.equal(h.nodes.has('sync-connection-notice'), false);
    h.advance(1);
    const notice = h.nodes.get('sync-connection-notice');
    assert.equal(notice.querySelector('strong').textContent, 'まだ保存が完了していません');
    assert.match(notice.querySelector('p').textContent, /入力した内容が消えるおそれ/);
    assert.match(notice.querySelector('p').textContent, /「キャンセル」を押してください/);
    assert.match(notice.querySelector('p').textContent, /画面を開いたまま/);
    assert.equal(notice.querySelector('button').hidden, true);
});

test('reconnecting retains pending input and dated backups before navigation', () => {
    const backup = '{"records":"untouched"}';
    const h = harness({ 'nippo_auto_backup_2026-10-21': backup });
    const raw = database();
    const guarded = h.sync.guardDatabase(raw);
    let local = { count: 12 };
    const pathSync = h.sync.createPathSync({ database: guarded, path: 'inventory', emptyValue: {},
        pendingStorageKey: 'pending', getLocal: () => local, setLocal: value => { local = value; } });
    local.count = 21;
    pathSync.save(local);
    h.advance(10000);
    h.nodes.get('sync-connection-notice').querySelector('button').events.click();
    assert.equal(h.navigations.length, 1);
    assert.ok(new URL(h.navigations[0]).searchParams.has('_app_refresh'));
    const pending = JSON.parse(h.storage.getItem('pending'));
    assert.equal(pending.local.count, 21);
    assert.equal(pending.requiresRefresh, true);
    assert.equal(h.storage.getItem('nippo_auto_backup_2026-10-21'), backup);
    assert.equal(raw.writes, 0);
});

test('reconnection refuses navigation when pending input cannot be retained', () => {
    const h = harness();
    const raw = database();
    let local = { count: 12 };
    const pathSync = h.sync.createPathSync({ database: h.sync.guardDatabase(raw), path: 'inventory',
        emptyValue: {}, pendingStorageKey: 'pending', getLocal: () => local, setLocal: value => { local = value; } });
    local.count = 21;
    pathSync.save(local);
    h.storage.setItem = () => { throw new Error('test-quota'); };
    local.count = 22;
    h.advance(10000);
    h.nodes.get('sync-connection-notice').querySelector('button').events.click();
    assert.equal(h.navigations.length, 0);
    assert.equal(local.count, 22);
    assert.equal(raw.writes, 0);
});

test('all entry points prepare connection metadata before initializing their Firebase app', () => {
    for (const file of ['app.js', '1f-app.js', '1f-kenpin-app.js', 'saidan-app.js', 'シフト表 - コピー/index.html']) {
        const source = fs.readFileSync(file, 'utf8');
        const prepare = source.indexOf('prepareFirebaseConnection');
        const initialize = source.indexOf('firebase.initializeApp(');
        assert.ok(prepare >= 0 && prepare < initialize, file);
    }
    const app = fs.readFileSync('app.js', 'utf8');
    assert.ok(app.indexOf('SharedSync.prepareFirebaseConnection?.(shiftFirebaseConfig)')
        < app.indexOf("firebase.initializeApp(shiftFirebaseConfig, 'shiftApp')"));
});
