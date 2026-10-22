'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const host = 'fixture-default-rtdb.asia-southeast1.firebasedatabase.app';
const config = { databaseURL: 'https://' + host };

function fixture() {
    const records = new Map([
        ['firebase:previous_websocket_failure', 'true'],
        ['firebase:host:' + host, '"s-obsolete.firebaseio.com"'],
        ['nippo_records', '[{"count":12}]'],
        ['nippo_records_pending_sync', '{"local":{"count":456}}'],
        ['nippo_auto_backup_2026-10-21', '{"saved":"keep backup"}']
    ]);
    const nativeCalls = [];
    class Storage {
        constructor(data = new Map()) { this.data = data; this.full = false; }
        getItem(key) { return this.data.get(String(key)) ?? null; }
        setItem(key, value) {
            nativeCalls.push(['set', String(key)]);
            if (this.full) { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; }
            this.data.set(String(key), String(value));
        }
        removeItem(key) { nativeCalls.push(['remove', String(key)]); this.data.delete(String(key)); }
    }
    const localStorage = new Storage(records);
    const sessionStorage = new Storage();
    const before = [...records];
    const window = { Storage, localStorage, sessionStorage };
    const context = vm.createContext({ window, URL, console });
    const source = fs.readFileSync('firebase-storage.js', 'utf8');
    vm.runInContext(source, context);
    window.FirebaseConnectionStorage.prepare(config);
    return { window, context, source, localStorage, sessionStorage, records, before, nativeCalls,
        guard: window.FirebaseConnectionStorage };
}

test('Firebase connection metadata never consumes disk quota or changes existing stored values', () => {
    const f = fixture();
    f.localStorage.full = true;
    for (const key of ['firebase:sentinel', 'firebase:previous_websocket_failure', 'firebase:host:' + host]) {
        assert.equal(f.localStorage.getItem(key), null);
        assert.doesNotThrow(() => f.localStorage.setItem(key, 'true'));
        assert.equal(f.localStorage.getItem(key), 'true');
        f.localStorage.removeItem(key);
        assert.equal(f.localStorage.getItem(key), null);
    }
    assert.deepEqual([...f.records], f.before);
    assert.deepEqual(f.nativeCalls, []);
    assert.equal(f.guard.getStatus().mode, 'memory');
});

test('application records, drafts and backups retain their native quota errors rather than silently using RAM', () => {
    const f = fixture();
    f.localStorage.full = true;
    for (const key of ['nippo_records', 'nippo_records_pending_sync', 'nippo_auto_backup_2026-10-21']) {
        assert.throws(() => f.localStorage.setItem(key, 'new value'), { name: 'QuotaExceededError' });
    }
    assert.deepEqual([...f.records], f.before);
});

test('other Firebase projects and sessionStorage keep native storage behavior', () => {
    const f = fixture();
    const otherKey = 'firebase:host:unrelated.firebaseio.com';
    f.localStorage.setItem(otherKey, 'other');
    assert.equal(f.records.get(otherKey), 'other');
    f.sessionStorage.setItem('firebase:sentinel', 'session');
    assert.equal(f.sessionStorage.data.get('firebase:sentinel'), 'session');
    f.localStorage.setItem('plain_text', 'hello');
    assert.equal(f.records.get('plain_text'), 'hello');
});

test('a failed WebSocket can still select long polling during this page lifetime', () => {
    const f = fixture();
    const key = 'firebase:previous_websocket_failure';
    assert.equal(f.localStorage.getItem(key), null);
    f.localStorage.setItem(key, 'true');
    assert.equal(f.localStorage.getItem(key), 'true');
    f.localStorage.removeItem(key);
    assert.equal(f.localStorage.getItem(key), null);
    assert.equal(f.records.get(key), 'true', 'the earlier persisted metadata is also retained');
});

test('loading the guard twice retains the active connection state and does not stack wrappers', () => {
    const f = fixture();
    f.localStorage.setItem('firebase:previous_websocket_failure', 'true');
    const getItem = f.window.Storage.prototype.getItem;
    vm.runInContext(f.source, f.context);
    assert.equal(f.window.Storage.prototype.getItem, getItem);
    assert.equal(f.localStorage.getItem('firebase:previous_websocket_failure'), 'true');
});

test('only quota failures set the optional-backup stop flag', () => {
    const f = fixture();
    f.guard.noteStorageFailure(new Error('different error'));
    assert.equal(f.guard.getStatus().storageWriteFailed, false);
    f.guard.noteStorageFailure({ name: 'QuotaExceededError' });
    assert.equal(f.guard.getStatus().storageWriteFailed, true);
});

test('every entry loads the guard before the actual Firebase SDK, and shared code recognizes it', () => {
    const { PAGE_FILES } = require('./prepare-release');
    for (const file of PAGE_FILES) {
        const html = fs.readFileSync(file, 'utf8');
        assert.ok(html.indexOf('firebase-storage.js') > 0, file);
        assert.ok(html.indexOf('firebase-storage.js') < html.indexOf('firebase-app-compat.js'), file);
    }
    const f = fixture();
    const window = Object.assign(f.window, { location: { href: 'https://fixture.test/index.html' }, history: {}, addEventListener() {} });
    const document = { addEventListener() {} };
    vm.runInNewContext(fs.readFileSync('shared-sync.js', 'utf8'), {
        window, document, localStorage: f.localStorage, URL, console, setTimeout, clearTimeout, setInterval, clearInterval
    });
    f.localStorage.full = true;
    assert.equal(window.SharedSync.prepareFirebaseConnection(config), true);
    assert.deepEqual([...f.records], f.before);
});
