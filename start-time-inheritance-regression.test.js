'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const sources = Object.fromEntries(['1f-app.js', 'app.js'].map(file => [file, fs.readFileSync(file, 'utf8')]));

function section(file, startMarker, endMarker) {
    const source = sources[file];
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Missing ${file}: ${startMarker}`);
    return source.slice(start, end);
}

function fixture(file, data = [], options = {}) {
    const press = file === '1f-app.js';
    const machines = press ? ['R1', 'R2', 'R3', 'R4'] : Array.from('ABCDEFGHIJ');
    const rows = data.map((record, index) => ({
        id: index + 1, product: '', count: 0, orderCount: 0, notes: '', endTime: '19:30',
        _syncUpdatedAt: 100, _startTimeMode: 'manual', _inheritedStartTime: '', ...record,
        _syncKey: press ? `1f:${record.date}:${record.machine}` : `dm_${record.date}_${record.machine}`
    }));
    const saved = [];
    const context = vm.createContext({
        records: structuredClone(rows), recordsNeedCleanup: false,
        MACHINES: machines, database: {},
        recordsSync: { isReady: () => true }, dailyRecordsSync: { isReady: () => true },
        RECORD_UPDATED_AT_FIELD: '_syncUpdatedAt', DAILY_RECORD_UPDATED_AT_FIELD: '_syncUpdatedAt',
        canWriteAppData: () => true,
        saveRecords(settings) { saved.push({ records: structuredClone(context.records), settings: structuredClone(settings) }); },
        ...options
    });
    vm.runInContext(section(file, 'function normalizeTime(', '// Initialize'), context);
    if (press) vm.runInContext(section(file, 'function get1fRecordSyncKey(', 'function normalize1fNotes('), context);
    else vm.runInContext(section(file, 'function getDailyRecordUpdatedAt(', 'function normalizeDailyRecords('), context);
    vm.runInContext(section(file, 'function getPreviousStartTime(', press ? 'function setDayStartTime(' : 'function updateDailyStartTimeLayout('), context);
    return { context, saved, before: rows, machines,
        day(date) { return structuredClone(context.records.filter(record => record.date === date)); } };
}

for (const file of Object.keys(sources)) {
    const press = file === '1f-app.js';
    const first = press ? 'R1' : 'A';
    const second = press ? 'R2' : 'B';
    const endTime = press ? '17:00' : '16:30';

    test(`${file} new day inherits each machine's own previous start time only`, () => {
        const f = fixture(file, [
            { date: '2026-10-29', machine: first, startTime: '07:00', count: 123, product: 'No.6', notes: 'keep first' },
            { date: '2026-10-29', machine: second, startTime: '08:30', count: 456, product: 'No.2', notes: 'keep second' }
        ]);
        f.context.ensureDayRecords('2026-10-30');
        const day = f.day('2026-10-30');
        assert.equal(day.length, f.machines.length);
        for (const row of day) {
            assert.equal(row.startTime, row.machine === first ? '07:00' : row.machine === second ? '08:30' : '08:45');
            assert.equal(row.endTime, endTime);
            assert.equal(row.count, 0);
            assert.ok(!row.notes);
            if (!press) assert.equal(row.orderCount, 0);
        }
        assert.deepEqual(structuredClone(f.context.records.slice(0, 2)), f.before);
        assert.equal(f.saved.length, 1);
        assert.deepEqual(f.saved[0].settings, press ? { automatic: true } : false);
        f.context.ensureDayRecords('2026-10-30');
        assert.equal(f.day('2026-10-30').length, day.length, 'A second render must not duplicate rows');
        assert.deepEqual(f.day('2026-10-30').map(row => row.startTime), day.map(row => row.startTime));
        const savesAfterKeyCleanup = f.saved.length;
        f.context.ensureDayRecords('2026-10-30');
        assert.equal(f.saved.length, savesAfterKeyCleanup, 'Settled records must not save again');
    });

    test(`${file} no past records retain the 08:45 default and ignore future records`, () => {
        const f = fixture(file, [{ date: '2027-01-01', machine: first, startTime: '07:00' }]);
        f.context.ensureDayRecords('2026-10-30');
        assert.ok(f.day('2026-10-30').every(row => row.startTime === '08:45'));
        assert.deepEqual(f.day('2027-01-01'), f.before);
    });

    test(`${file} uses the nearest earlier record across weekends and calendar years`, () => {
        const f = fixture(file, [
            { date: '2026-10-28', machine: first, startTime: '08:30' },
            { date: '2027-01-04', machine: first, startTime: '10:00' },
            { date: '2026-10-30', machine: first, startTime: '07:00' }
        ]);
        f.context.ensureDayRecords('2026-11-02');
        assert.equal(f.day('2026-11-02').find(row => row.machine === first).startTime, '07:00');
        f.context.ensureDayRecords('2027-01-01');
        assert.equal(f.day('2027-01-01').find(row => row.machine === first).startTime, '07:00');
        assert.deepEqual(structuredClone(f.context.records.slice(0, 3)), f.before);
    });

    test(`${file} existing times including blanks and zero-count records are never overwritten`, () => {
        const names = press ? ['R1', 'R2', 'R3', 'R4'] : Array.from('ABCDEFGHIJ');
        const f = fixture(file, [
            { date: '2026-10-29', machine: first, startTime: '07:00' },
            ...names.map((machine, index) => ({ date: '2026-10-30', machine, startTime: index === 0 ? '' : '09:10', count: index }))
        ]);
        f.context.ensureDayRecords('2026-10-30');
        assert.deepEqual(structuredClone(f.context.records), f.before);
        assert.equal(f.saved.length, 0);
        f.context.records[0].startTime = '08:30';
        f.context.ensureDayRecords('2026-10-30');
        assert.deepEqual(f.day('2026-10-30'), f.before.slice(1));
        assert.equal(f.saved.length, 0);
    });

    test(`${file} only missing machine rows receive inherited times`, () => {
        const f = fixture(file, [
            { date: '2026-10-29', machine: first, startTime: '07:00' },
            { date: '2026-10-29', machine: second, startTime: '08:30' },
            { date: '2026-10-30', machine: first, startTime: '10:15', count: 55, notes: 'keep' }
        ]);
        f.context.ensureDayRecords('2026-10-30');
        const day = f.day('2026-10-30');
        assert.deepEqual(day.find(row => row.machine === first), f.before[2]);
        assert.equal(day.find(row => row.machine === second).startTime, '08:30');
    });

    test(`${file} ignores incomplete and invalid past times without modifying them`, () => {
        const invalidTimes = ['', null, undefined, 700, '7', '24:00', '07:60', 'invalid'];
        for (const time of invalidTimes) {
            const f = fixture(file, [
                { date: '2026-10-28', machine: first, startTime: '07:00' },
                { date: '2026-10-29', machine: first, startTime: time },
                { date: '', machine: first, startTime: '06:00' }
            ]);
            assert.equal(f.context.getPreviousStartTime(first, '2026-10-30'), '07:00', String(time));
            assert.equal(f.context.getPreviousStartTime(second, '2026-10-30'), '08:45');
            assert.deepEqual(structuredClone(f.context.records), f.before);
            assert.equal(f.saved.length, 0);
        }
    });

    test(`${file} normalizes copied time strings including midnight without rewriting history`, () => {
        for (const [time, expected] of [['700', '07:00'], ['0830', '08:30'], ['7:00', '07:00'], [' 08:30 ', '08:30'], ['00:00', '00:00'], ['23:59', '23:59']]) {
            const f = fixture(file, [{ date: '2026-10-29', machine: first, startTime: time }]);
            f.context.ensureDayRecords('2026-10-30');
            assert.equal(f.day('2026-10-30').find(row => row.machine === first).startTime, expected);
            assert.deepEqual(f.day('2026-10-29'), f.before);
        }
    });

    test(`${file} multiple prior rows on the same date use the latest updated valid time`, () => {
        const f = fixture(file, [
            { date: '2026-10-29', machine: first, startTime: '07:00', _syncUpdatedAt: 300 },
            { date: '2026-10-29', machine: first, startTime: '08:30', _syncUpdatedAt: 100 },
            { date: '2026-10-28', machine: first, startTime: '06:00', _syncUpdatedAt: 900 }
        ]);
        assert.equal(f.context.getPreviousStartTime(first, '2026-10-30'), '07:00');
        assert.equal(f.saved.length, 0);
        assert.deepEqual(structuredClone(f.context.records), f.before);
    });

    test(`${file} weekday holidays inherit times but empty weekends still create no rows`, () => {
        const f = fixture(file, [{ date: '2026-10-30', machine: first, startTime: '07:00' }]);
        for (const date of ['2026-10-31', '2026-11-01']) f.context.ensureDayRecords(date);
        assert.deepEqual(structuredClone(f.context.records), f.before);
        assert.equal(f.saved.length, 0);
        f.context.ensureDayRecords('2026-11-03');
        assert.equal(f.day('2026-11-03').find(row => row.machine === first).startTime, '07:00');
    });

    test(`${file} waits for server readiness before creating inherited records`, () => {
        for (const sync of [null, { isReady: () => false }]) {
            const f = fixture(file, [{ date: '2026-10-29', machine: first, startTime: '07:00' }],
                press ? { recordsSync: sync } : { dailyRecordsSync: sync });
            f.context.ensureDayRecords('2026-10-30');
            assert.deepEqual(structuredClone(f.context.records), f.before);
            assert.equal(f.saved.length, 0);
        }
    });

    test(`${file} newly configured machines can inherit their own earlier times`, () => {
        const name = press ? 'R5' : 'K';
        const f = fixture(file, [{ date: '2026-10-29', machine: name, startTime: '06:40' }]);
        f.context.MACHINES.push(name);
        f.context.ensureDayRecords('2026-10-30');
        assert.equal(f.day('2026-10-30').find(row => row.machine === name).startTime, '06:40');
    });
}

test('2F keeps its existing product carry-forward independent of the selected start time', () => {
    const f = fixture('app.js', [
        { date: '2026-10-28', machine: 'A', startTime: '08:45', product: 'No.6' },
        { date: '2026-10-29', machine: 'A', startTime: '07:00', product: '', count: 123, orderCount: 456 }
    ]);
    f.context.ensureDayRecords('2026-10-30');
    const row = f.day('2026-10-30').find(record => record.machine === 'A');
    assert.equal(row.product, 'No.6');
    assert.equal(row.startTime, '07:00');
    assert.equal(row.endTime, '16:30');
    assert.equal(row.count, 0);
    assert.equal(row.orderCount, 0);
    assert.deepEqual(structuredClone(f.context.records.slice(0, 2)), f.before);
});

function productionFollowFixture(data, options = {}) {
    const FixedDate = class extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-10-30T04:00:00Z'])); }
        static now() { return Date.parse('2026-10-30T04:00:00Z'); }
    };
    const f = fixture('app.js', data, {
        Date: FixedDate, currentDate: '2026-10-29',
        dayViewContainer: { style: { display: 'block' } },
        dailyStartTimeSelectionDate: '2026-10-29',
        dailyStartTimeMachineInputs: [{ value: 'A', checked: true, disabled: false }],
        calculateAndDisplayStats() {}, renderRecords() {}, updateDailyStartTimeControls() {},
        markSyncUpdated(record, updatedAt) { record._syncUpdatedAt = updatedAt; },
        DAILY_RECORD_KEY_FIELD: '_syncKey', ...options
    });
    vm.runInContext(section('app.js', 'function setSelectedDayStartTime(', '// Update a specific field in a record'), f.context);
    vm.runInContext(section('app.js', 'function updateRecord(', '// Calculate Duration'), f.context);
    vm.runInContext(section('app.js', 'function hashDailyRecordValue(', 'const storedRecordsState'), f.context);
    f.context.window = { location: { href: 'https://fixture.test/index.html' }, addEventListener() {} };
    f.context.document = { baseURI: 'https://fixture.test/', addEventListener() {}, getElementById() { return null; } };
    f.context.URL = URL;
    vm.runInContext(fs.readFileSync('shared-sync.js', 'utf8'), f.context);
    f.context.SharedSync = f.context.window.SharedSync;
    return f;
}

function legacyNextDay(startTime = '08:45', extra = {}) {
    return { date: '2026-10-30', machine: 'A', startTime, endTime: '16:30',
        _startTimeMode: undefined, _inheritedStartTime: undefined, ...extra };
}

test('2F manual input updates pre-existing next-day times of any value without changing other fields', () => {
    for (const time of ['08:45', '08:30', '10:15', '']) {
        const f = productionFollowFixture([
            { date: '2026-10-29', machine: 'A', startTime: '08:45', count: 123 },
            legacyNextDay(time, { product: 'No.6', count: 456, orderCount: 789, notes: 'keep this note', endTime: '17:40' })
        ]);
        f.context.updateRecordLive(1, 'startTime', '07:00');
        const target = f.day('2026-10-30')[0];
        assert.equal(target.startTime, '07:00', time);
        for (const key of ['count', 'orderCount', 'product', 'notes', 'endTime', 'date', 'machine', 'id', '_syncKey']) {
            assert.deepEqual(target[key], f.before[1][key], key);
        }
        assert.equal(target._startTimeMode, 'previous');
        assert.equal(target._inheritedStartTime, '07:00');
        assert.equal(f.saved.length, 1);
    }
});

for (const time of ['07:00', '08:30']) {
    test(`2F ${time} preset updates created next-day rows only for selected machines`, () => {
        const f = productionFollowFixture([
            { date: '2026-10-29', machine: 'A', startTime: '08:45' },
            { date: '2026-10-29', machine: 'B', startTime: '08:45' },
            legacyNextDay(), legacyNextDay('09:00', { machine: 'B' })
        ]);
        assert.equal(f.context.setSelectedDayStartTime(time), true);
        assert.equal(f.day('2026-10-30').find(row => row.machine === 'A').startTime, time);
        assert.deepEqual(f.day('2026-10-30').find(row => row.machine === 'B'), f.before[3]);
        assert.equal(f.saved.length, 1);
        assert.equal(f.context.setSelectedDayStartTime(time), false);
        assert.equal(f.saved.length, 1);
    });
}

test('2F opening an already created day corrects its legacy time from the previous record', () => {
    const f = productionFollowFixture([
        { date: '2026-10-29', machine: 'A', startTime: '07:00' }, legacyNextDay('08:30')
    ]);
    f.context.ensureDayRecords('2026-10-30');
    assert.equal(f.day('2026-10-30').find(row => row.machine === 'A').startTime, '07:00');
    assert.deepEqual(f.day('2026-10-29')[0], f.before[0]);
});

test('2F existing rows follow across weekends, consecutive days off and month boundaries', () => {
    const f = productionFollowFixture([
        { date: '2026-10-29', machine: 'A', startTime: '08:45' }, legacyNextDay(),
        legacyNextDay('08:45', { date: '2026-11-02' }), legacyNextDay('10:15', { date: '2026-11-06' })
    ]);
    f.context.updateRecordLive(1, 'startTime', '07:00');
    for (const date of ['2026-10-30', '2026-11-02', '2026-11-06']) assert.equal(f.day(date)[0].startTime, '07:00', date);
    assert.equal(f.day('2026-10-31').length, 0);
    assert.equal(f.day('2026-11-01').length, 0);
});

test('2F opening a later day skips unused default records in between', () => {
    const f = productionFollowFixture([
        { date: '2026-10-29', machine: 'A', startTime: '07:00' },
        legacyNextDay(), legacyNextDay('08:45', { date: '2026-11-02' })
    ]);
    f.context.ensureDayRecords('2026-11-02');
    assert.equal(f.day('2026-11-02').find(row => row.machine === 'A').startTime, '07:00');
    assert.deepEqual(f.day('2026-10-30')[0], f.before[1]);
});

test('2F a subsequent explicit next-day time stays pinned and becomes the following source', () => {
    for (const time of ['08:45', '08:30', '09:15']) {
        const f = productionFollowFixture([
            { date: '2026-10-29', machine: 'A', startTime: '07:00' },
            legacyNextDay('07:00', { _startTimeMode: 'previous', _inheritedStartTime: '07:00' }),
            legacyNextDay('07:00', { date: '2026-11-02' })
        ], { currentDate: '2026-10-30', dailyStartTimeSelectionDate: '2026-10-30' });
        f.context.updateRecordLive(2, 'startTime', time);
        f.context.records[0].startTime = '10:00';
        f.context.ensureDayRecords('2026-10-30');
        assert.equal(f.day('2026-10-30').find(row => row.machine === 'A').startTime, time);
        assert.equal(f.day('2026-10-30').find(row => row.machine === 'A')._startTimeMode, 'manual');
        assert.equal(f.day('2026-11-02')[0].startTime, time);
    }
});

test('2F blur without an edit does not pin an inherited time and partial typing does not propagate', () => {
    const f = productionFollowFixture([
        { date: '2026-10-29', machine: 'A', startTime: '08:45' },
        legacyNextDay('08:45', { _startTimeMode: 'previous', _inheritedStartTime: '08:45' })
    ]);
    f.context.updateRecord(2, 'startTime', '08:45');
    assert.equal(f.context.records[1]._startTimeMode, 'previous');
    for (const value of ['0', '07:']) {
        f.context.updateRecordLive(1, 'startTime', value);
        assert.equal(f.day('2026-10-30')[0].startTime, '08:45');
    }
    f.context.updateRecordLive(1, 'startTime', '07:00');
    assert.equal(f.day('2026-10-30')[0].startTime, '07:00');
});

test('2F past completed dates are not rewritten by forward propagation', () => {
    const f = productionFollowFixture([
        { date: '2026-10-27', machine: 'A', startTime: '08:45' },
        legacyNextDay('10:00', { date: '2026-10-28', count: 123 })
    ]);
    f.context.updateRecordLive(1, 'startTime', '07:00');
    assert.deepEqual(f.day('2026-10-28')[0], f.before[1]);
});

for (const remoteEdit of [{ startTime: '08:30', _startTimeMode: 'manual', _inheritedStartTime: '' }, { startTime: '09:10' }, { count: 999 }]) {
    test(`2F concurrent explicit changes win over inheritance: ${JSON.stringify(remoteEdit)}`, () => {
        const f = productionFollowFixture([]);
        const base = { id: 1, date: '2026-10-30', machine: 'A', startTime: '08:45', endTime: '16:30', count: 0, _syncKey: 'a', _syncUpdatedAt: 100 };
        const automatic = { ...base, startTime: '07:00', _startTimeMode: 'previous', _inheritedStartTime: '07:00', _syncUpdatedAt: 300 };
        const manual = { ...base, ...remoteEdit, _syncUpdatedAt: 200 };
        for (const [local, remote] of [[automatic, manual], [manual, automatic]]) {
            const merged = f.context.mergeDailyRecordFields(base, local, remote, 'a');
            assert.equal(merged.startTime, manual.startTime);
            assert.equal(merged.count, manual.count);
            assert.equal(merged._startTimeMode, 'manual');
            assert.equal(merged._inheritedStartTime, '');
        }
    });
}

test('2F concurrent automatic creation with an old default is not mistaken for a manual edit', () => {
    const f = productionFollowFixture([]);
    const automatic = { id: 1, date: '2026-10-30', machine: 'A', startTime: '07:00', count: 0,
        _startTimeMode: 'previous', _inheritedStartTime: '07:00', _syncUpdatedAt: 300 };
    const legacy = { ...automatic, startTime: '08:45', _startTimeMode: undefined, _inheritedStartTime: undefined, _syncUpdatedAt: 100 };
    assert.equal(f.context.mergeDailyRecordFields(null, automatic, legacy, 'a').startTime, '07:00');
});

test('2F fresh-read draft replay protects a remote manual time while preserving other local edits', () => {
    const f = productionFollowFixture([]);
    const base = { id: 1, date: '2026-10-30', machine: 'A', startTime: '08:45', endTime: '16:30',
        count: 0, notes: '', product: 'No.6', _syncKey: 'a', _syncUpdatedAt: 100 };
    const local = { ...base, startTime: '07:00', _startTimeMode: 'previous', _inheritedStartTime: '07:00', notes: 'keep local note', _syncUpdatedAt: 300 };
    const remote = { ...base, startTime: '11:00', _startTimeMode: 'manual', _inheritedStartTime: '', count: 999, _syncUpdatedAt: 200 };
    const merged = f.context.rebaseDailyRecords([base], [local], [remote])[0];
    assert.equal(merged.startTime, '11:00');
    assert.equal(merged._startTimeMode, 'manual');
    assert.equal(merged._inheritedStartTime, '');
    assert.equal(merged.count, 999);
    assert.equal(merged.notes, 'keep local note');
});

test('2F ordinary manual draft replay remains unchanged when no inherited time is involved', () => {
    const f = productionFollowFixture([]);
    const base = { id: 1, date: '2026-10-30', machine: 'A', startTime: '08:45', count: 0, _syncKey: 'a', _syncUpdatedAt: 100 };
    const local = { ...base, startTime: '07:00', _startTimeMode: 'manual', _inheritedStartTime: '', notes: 'local', _syncUpdatedAt: 200 };
    const remote = { ...base, count: 123, _syncUpdatedAt: 300 };
    const expected = f.context.normalizeDailyRecords(f.context.SharedSync.reapplyDraft([base], [local], [remote]));
    assert.deepEqual(f.context.rebaseDailyRecords([base], [local], [remote]), expected);
});
