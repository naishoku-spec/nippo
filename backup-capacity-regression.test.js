'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('app.js', 'utf8');
const daily = source.slice(source.indexOf('function performDailyBackup('), source.indexOf('function scheduleDailyBackupRefresh('));
const history = source.slice(source.indexOf('function saveHistoryBackup('), source.indexOf('let _historyDebounceTimer'));

function fixture({ full = false, reportedFull = false } = {}) {
    const entries = new Map([
        ['nippo_history_backup_1', '{"snapshot":1}'],
        ['nippo_history_backup_2', '{"snapshot":2}'],
        ['nippo_history_backup_3', '{"snapshot":3}']
    ]);
    const before = [...entries];
    const logs = [];
    const writes = [];
    let prunes = 0;
    const context = {
        window: { FirebaseConnectionStorage: { getStatus: () => ({ storageWriteFailed: reportedFull }) } },
        Date, JSON, HISTORY_BACKUP_PREFIX: 'nippo_history_backup_', AUTO_BACKUP_PREFIX: 'nippo_auto_backup_', LS_KEY: 'nippo_records', NOTES_LS_KEY: 'nippo_daily_notes', isProduction: true,
        console: { log: value => logs.push(value), error: value => logs.push(value) },
        getLocalBackupSnapshot: () => ({ records: '[{"count":99}]' }),
        shouldReplaceDailyBackup: () => true,
        pruneOldDailyBackups: () => prunes++,
        safeLocalStorageGetItem: key => entries.get(key) ?? null,
        safeLocalStorageSetItem(key, value) { writes.push(key); if (full) return false; entries.set(key, value); return true; },
        safeLocalStorageRemoveItem() { throw new Error('Existing backup must not be deleted'); }
    };
    vm.createContext(context);
    vm.runInContext(daily + '\n' + history, context);
    return { context, entries, before, writes, logs, prunes: () => prunes };
}

test('a failed daily backup does not prune earlier backups or log success', () => {
    const f = fixture({ full: true });
    assert.equal(f.context.performDailyBackup(), false);
    assert.deepEqual([...f.entries], f.before);
    assert.equal(f.prunes(), 0);
    assert.equal(f.logs.length, 0);
});

test('a successful daily backup still follows the existing retention policy', () => {
    const f = fixture();
    assert.equal(f.context.performDailyBackup(), true);
    assert.equal(f.prunes(), 1);
    assert.equal(f.logs.length, 1);
});

test('known capacity exhaustion leaves every history slot unchanged', () => {
    const f = fixture({ reportedFull: true });
    assert.equal(f.context.saveHistoryBackup(), false);
    assert.deepEqual([...f.entries], f.before);
    assert.equal(f.writes.length, 0);
});

test('a failed first history write no longer deletes the third slot or continues rotation', () => {
    const f = fixture({ full: true });
    assert.equal(f.context.saveHistoryBackup(), false);
    assert.deepEqual([...f.entries], f.before);
    assert.equal(f.writes.length, 1);
    assert.equal(f.logs.length, 0);
});
