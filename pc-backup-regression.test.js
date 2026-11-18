'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runBackup } = require('./tools/weekday-backup.cjs');

const weekdayNoon = '2026-11-18T03:00:00Z';
const japanDate = '2026-11-18';
const backupName = 'nippo-backup_' + japanDate + '.json';
const nippo = '{"nippo_records":{"count":12345678901234567890},"saidan_daily_notes":{"note":"fixture"},"1f_nippo_daily_notes":{"note":"another"},"nippo_records_dev":{"test":true}}';
const shift = '{"2026-11":{"comment":"fixture"}}';

async function withDirectory(t) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nippo-pc-backup-test-')));
    t.after(async () => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await fs.rmdir(file);
            else await fs.unlink(file);
        }
        await fs.rmdir(directory);
    });
    return { directory, nippoBranch: 'fixture-nippo', shiftBranch: 'fixture-shift' };
}

function fakeRead(body = nippo) {
    return async url => new Response(url.hostname.startsWith('nippo-') ? body : shift);
}

const noRead = () => assert.fail('This run must not contact Firebase');

function validArchive(date = japanDate) {
    return JSON.stringify({
        formatVersion: 1,
        date,
        savedAt: date + 'T03:00:00.000Z',
        projects: { 'nippo-f7e61': { records: { count: 1 } }, 'shift-table-427cd': JSON.parse(shift) }
    }) + '\n';
}

test('weekday backup contains both snapshots and every production key, without changing numeric values', async t => {
    const config = await withDirectory(t);
    const calls = [];
    const result = await runBackup(config, {
        clock: () => new Date(weekdayNoon),
        get(url, options) {
            assert.equal(options.method, 'GET');
            assert.equal(options.redirect, 'error');
            assert.equal(url.protocol, 'https:');
            assert.equal(url.searchParams.get('format'), 'export');
            assert.equal(url.username, '');
            assert.equal(url.password, '');
            calls.push(url.hostname.split('-default-rtdb.')[0] + url.pathname);
            return fakeRead()(url);
        }
    });
    assert.deepEqual(result, { date: japanDate, status: 'saved' });
    assert.deepEqual(calls, [
        'nippo-f7e61/fixture-nippo.json',
        'shift-table-427cd/shift_data/fixture-shift.json'
    ]);
    const text = await fs.readFile(path.join(config.directory, backupName), 'utf8');
    const record = JSON.parse(text);
    assert.equal(record.date, japanDate);
    assert.equal(record.formatVersion, 1);
    assert.deepEqual(record.projects['shift-table-427cd'], JSON.parse(shift));
    assert.deepEqual(Object.keys(record.projects['nippo-f7e61']), [
        'nippo_records', 'saidan_daily_notes', '1f_nippo_daily_notes'
    ]);
    assert.match(text, /"count":12345678901234567890/);
    assert.deepEqual(await fs.readdir(config.directory), [backupName]);
});

test('weekend and pre-noon catch-up runs never read Firebase or create files', async t => {
    const config = await withDirectory(t);
    for (const timestamp of ['2026-11-20T15:00:00Z', '2026-11-22T03:00:00Z', '2026-11-23T02:59:59Z']) {
        const result = await runBackup(config, { clock: () => new Date(timestamp), get: noRead });
        assert.equal(result.status, 'outside-window', timestamp);
    }
    assert.deepEqual(await fs.readdir(config.directory), []);
});

test('a backup already saved on the same day is left byte-for-byte intact', async t => {
    const config = await withDirectory(t);
    const file = path.join(config.directory, backupName);
    const contents = validArchive();
    await fs.writeFile(file, contents);
    const result = await runBackup(config, { clock: () => new Date(weekdayNoon), get: noRead });
    assert.equal(result.status, 'already-saved');
    assert.equal(await fs.readFile(file, 'utf8'), contents);
});

test('damaged or incomplete same-day items are kept and a complete backup uses a new filename', async t => {
    const config = await withDirectory(t);
    const stem = backupName.slice(0, -'.json'.length);
    const incomplete = JSON.parse(validArchive());
    delete incomplete.projects['shift-table-427cd'];
    const existing = [
        [backupName, '{"formatVersion":1,'],
        [stem + '-2.json', ''],
        [stem + '-3.json', validArchive('2026-11-17')],
        [stem + '-4.json', JSON.stringify(incomplete)]
    ];
    for (const [name, contents] of existing) await fs.writeFile(path.join(config.directory, name), contents);
    const directory = path.join(config.directory, stem + '-5.json');
    await fs.mkdir(directory);

    const clock = () => new Date(weekdayNoon);
    assert.equal((await runBackup(config, { clock, get: fakeRead() })).status, 'saved');
    for (const [name, contents] of existing) assert.equal(await fs.readFile(path.join(config.directory, name), 'utf8'), contents);
    assert.ok((await fs.stat(directory)).isDirectory());
    const newName = stem + '-6.json';
    const saved = JSON.parse(await fs.readFile(path.join(config.directory, newName), 'utf8'));
    assert.deepEqual(Object.keys(saved.projects), ['nippo-f7e61', 'shift-table-427cd']);
    assert.equal((await runBackup(config, { clock, get: noRead })).status, 'already-saved');
    assert.equal((await fs.readdir(config.directory)).length, 6);
});

test('a valid numbered backup is found even when an earlier filename is absent', async t => {
    const config = await withDirectory(t);
    const alternate = backupName.replace('.json', '-3.json');
    await fs.writeFile(path.join(config.directory, alternate), validArchive());
    const result = await runBackup(config, { clock: () => new Date(weekdayNoon), get: noRead });
    assert.equal(result.status, 'already-saved');
    assert.deepEqual(await fs.readdir(config.directory), [alternate]);
});

test('a failed response creates no backup and leaves earlier files unchanged', async t => {
    const config = await withDirectory(t);
    const previous = 'nippo-backup_2026-11-17.json';
    await fs.writeFile(path.join(config.directory, previous), '{"earlier":"keep"}');
    const get = async url => url.hostname.startsWith('nippo-')
        ? new Response(nippo)
        : new Response('private failure body', { status: 403 });
    await assert.rejects(runBackup(config, { clock: () => new Date(weekdayNoon), get }),
        { message: 'shift: HTTP 403' });
    assert.deepEqual(await fs.readdir(config.directory), [previous]);
    assert.equal(await fs.readFile(path.join(config.directory, previous), 'utf8'), '{"earlier":"keep"}');
});

test('empty and invalid snapshots do not publish a backup', async t => {
    const config = await withDirectory(t);
    for (const body of ['null', '{}', '{"only_dev":{}}', '{"bad":', '1']) {
        await assert.rejects(runBackup(config, { clock: () => new Date(weekdayNoon), get: fakeRead(body) }));
        assert.deepEqual(await fs.readdir(config.directory), []);
    }
});

test('a valid backup created during the download wins without being overwritten', async t => {
    const config = await withDirectory(t);
    const file = path.join(config.directory, backupName);
    const contents = validArchive();
    const result = await runBackup(config, {
        clock: () => new Date(weekdayNoon),
        async get(url) {
            if (url.hostname.startsWith('nippo-')) await fs.writeFile(file, contents);
            return fakeRead()(url);
        }
    });
    assert.equal(result.status, 'already-saved');
    assert.equal(await fs.readFile(file, 'utf8'), contents);
    assert.deepEqual(await fs.readdir(config.directory), [backupName]);
});

test('concurrent runs publish only one valid backup for the day', async t => {
    const config = await withDirectory(t);
    const options = { clock: () => new Date(weekdayNoon), get: fakeRead() };
    const results = await Promise.all([runBackup(config, options), runBackup(config, options)]);
    assert.deepEqual(results.map(result => result.status).sort(), ['already-saved', 'saved']);
    assert.deepEqual(await fs.readdir(config.directory), [backupName]);
});

test('a late Friday download cannot publish on Saturday', async t => {
    const config = await withDirectory(t);
    let now = '2026-11-20T14:59:55Z';
    await assert.rejects(runBackup(config, {
        clock: () => new Date(now),
        get(url) {
            now = '2026-11-20T15:00:00Z';
            return fakeRead()(url);
        }
    }), { message: 'The backup window ended during download.' });
    assert.deepEqual(await fs.readdir(config.directory), []);
});

test('the final commit is blocked if Friday ends after download but while flushing the file', async t => {
    const config = await withDirectory(t);
    let now = '2026-11-20T14:59:59Z';
    const open = fs.open;
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await open(...args);
        return {
            writeFile: handle.writeFile.bind(handle),
            close: handle.close.bind(handle),
            async sync() {
                await handle.sync();
                now = '2026-11-20T15:00:00Z';
            }
        };
    });
    await assert.rejects(runBackup(config, { clock: () => new Date(now), get: fakeRead() }),
        { message: 'The backup window ended before publication.' });
    assert.deepEqual(await fs.readdir(config.directory), []);
});
