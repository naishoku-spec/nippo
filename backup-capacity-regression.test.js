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
        Date, JSON, BROWSER_BACKUP_ENABLED: true, HISTORY_BACKUP_PREFIX: 'nippo_history_backup_', AUTO_BACKUP_PREFIX: 'nippo_auto_backup_', LS_KEY: 'nippo_records', NOTES_LS_KEY: 'nippo_daily_notes', isProduction: true,
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

test('legacy backups are preserved on startup, edit, and history view', () => {
    const storage = {
        'nippo_auto_backup_2026-08-25': '{"records":"saved daily snapshot"}',
        'nippo_history_backup_1': '{"timestamp":"2026-08-25 12:00:00"}',
        'nippo_records_pending_sync': '{"count":123}'
    };
    const before = { ...storage };
    const panel = {};
    const selected = [];
    const forbidden = () => assert.fail('Disabled backups must not register a timer or modify storage');
    const context = vm.createContext({
        localStorage: storage,
        safeLocalStorageGetItem: key => storage[key] ?? null,
        safeLocalStorageSetItem: forbidden,
        safeLocalStorageRemoveItem: forbidden,
        setTimeout: forbidden,
        addEventListener: forbidden,
        document: { getElementById: () => panel, addEventListener: forbidden },
        selectHistoryBackup: slot => selected.push(slot)
    });
    context.window = context;
    const backupStart = source.indexOf('const BROWSER_BACKUP_ENABLED');
    const lifecycle = source.indexOf("window.addEventListener('beforeunload', () => flushPendingHistoryBackup");
    const backupEnd = source.indexOf('// -------------------------------------------------------------------', lifecycle);
    const listStart = source.indexOf('window.renderBackupList =');
    const listEnd = source.indexOf('window.selectHistoryBackup =', listStart);
    vm.runInContext(source.slice(backupStart, backupEnd) + source.slice(listStart, listEnd), context);
    context.scheduleDailyBackupRefresh();
    context.triggerHistorySave();
    context.flushPendingHistoryBackup(true);
    assert.equal(context.performDailyBackup({ refreshExisting: true }), false);
    assert.equal(context.saveHistoryBackup(), false);
    context.renderBackupList();
    assert.match(panel.innerHTML, /data-date="2026-08-25"/);
    assert.deepEqual(selected, [1]);
    assert.deepEqual(storage, before);
});

test('the legacy restore screen is reachable by URL but absent from every sidebar', () => {
    for (const page of ['index.html', '1f.html', '1f-kenpin.html', 'saidan.html']) {
        const sidebar = fs.readFileSync(page, 'utf8').match(/<aside[\s\S]+?<\/aside>/i)?.[0];
        assert.ok(sidebar, page);
        assert.doesNotMatch(sidebar, /view-backup|view=backup|switchView\('backup'\)/, page);
    }
    assert.match(fs.readFileSync('index.html', 'utf8'), /id="backup-view-container"/);
    assert.match(source, /\['day',[^\n]+'backup'\]\.includes\(viewParam\)/);
    const view = source.slice(source.indexOf('function switchView('), source.indexOf('// Toggle header selectors visibility'));
    assert.match(view, /if \(view === 'backup'\) \{\s+renderBackupList\(\)/);
    assert.doesNotMatch(view, /performDailyBackup\(/);
});
