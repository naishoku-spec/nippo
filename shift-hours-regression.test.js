'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ShiftHours = require('./shift-hours');

const shifts = ['early', 'middle', 'late'];
const edges = ['start', 'end'];

test('the work and break editors offer all three shifts with the requested defaults', () => {
    const range = group => shifts.map(shift => edges.map(edge => ShiftHours.getTime({}, group, shift, edge)));
    assert.deepEqual(range('work'), [['07:00', '16:00'], ['08:30', '17:30'], ['10:30', '19:30']]);
    assert.deepEqual(range('break'), [['11:30', '12:30'], ['12:30', '13:30'], ['', '']]);
});

test('each time edit changes only the chosen setting and ignores invalid or unchanged values', () => {
    const saved = Object.freeze({
        work: Object.freeze({ middle: Object.freeze({ end: '17:15' }) }),
        break: Object.freeze({ late: Object.freeze({ start: '13:15', end: '14:15' }) })
    });
    const updated = ShiftHours.planChange(saved, 'work', 'early', 'end', '16:20');
    assert.deepEqual(updated, { ...saved, work: { ...saved.work, early: { end: '16:20' } } });
    assert.equal(saved.work.early, undefined);
    assert.equal(updated.break, saved.break);
    assert.equal(ShiftHours.getTime(updated, 'work', 'early', 'start'), '07:00');
    for (const invalid of ['', '24:00', '7:00', '16:60', '16:00:00']) {
        assert.equal(ShiftHours.planChange(saved, 'work', 'early', 'end', invalid), null);
    }
    assert.equal(ShiftHours.planChange(saved, 'work', 'early', 'end', '16:00'), null);
    assert.equal(ShiftHours.planChange(saved, 'work', 'middle', 'end', '17:15'), null);
    assert.equal(ShiftHours.planChange(saved, 'work', '__proto__', 'end', '16:20'), null);
    assert.equal(ShiftHours.getTime({ work: { late: { end: 'bad' } } }, 'work', 'late', 'end'), '19:30');

    const cleared = ShiftHours.planChange(saved, 'break', 'late', 'end', '');
    assert.deepEqual(cleared.break.late, { start: '13:15', end: '' });
    assert.equal(ShiftHours.getTime(cleared, 'break', 'late', 'end'), '');
});

function createEditor() {
    const fields = shifts.flatMap(shiftKind => edges.map(hourEdge => ({ type: 'time', value: '', dataset: { shiftKind, hourEdge } })));
    const listeners = [];
    return {
        fields, listeners, dataset: {}, innerHTML: '',
        querySelectorAll: () => fields,
        addEventListener(type, listener) {
            assert.equal(type, 'change');
            listeners.push(listener);
        },
        edit(input, value) {
            input.value = value;
            listeners[0]({ target: input });
        }
    };
}

test('rendering does not save defaults, and an edit is saved only when the shared shift is writable', () => {
    const work = createEditor();
    const breaks = createEditor();
    const messages = [];
    const context = vm.createContext({
        document: { getElementById: id => id === 'shift-work-hours' ? work : id === 'shift-break-hours' ? breaks : null },
        alert: message => messages.push(message)
    });
    vm.runInContext(fs.readFileSync('shift-hours.js', 'utf8'), context);
    let settings = {};
    let writable = false;
    let saves = 0;
    const opts = {
        getSettings: () => settings,
        canEdit: () => writable,
        onChange: next => { settings = next; saves++; }
    };
    context.ShiftHours.renderEditors(opts);
    assert.match(breaks.innerHTML, /\u65e9\u756a/);
    assert.match(breaks.innerHTML, /\u4e2d\u756a/);
    assert.match(breaks.innerHTML, /\u9045\u756a/);
    assert.doesNotMatch(breaks.innerHTML, /\u25c6|\u2663/);
    assert.equal(saves, 0);

    const earlyEnd = work.fields[1];
    assert.equal(earlyEnd.value, '16:00');
    work.edit(earlyEnd, '16:20');
    assert.equal(earlyEnd.value, '16:00');
    assert.equal(messages.length, 1);
    assert.equal(saves, 0);

    writable = true;
    work.edit(earlyEnd, '16:20');
    assert.equal(earlyEnd.value, '16:20');
    assert.deepEqual(JSON.parse(JSON.stringify(settings)), { work: { early: { end: '16:20' } } });
    work.edit(earlyEnd, '16:20');
    assert.equal(saves, 1);
    settings = { ...settings, break: { late: { start: '13:30', end: '14:30' } } };
    context.ShiftHours.renderEditors(opts);
    assert.deepEqual(breaks.fields.slice(-2).map(input => input.value), ['13:30', '14:30']);
    assert.equal(work.listeners.length, 1);
    assert.equal(breaks.listeners.length, 1);
    assert.equal(saves, 1);
});

test('reapplying a time draft keeps a different time and weekly record saved by another device', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync('shared-sync.js', 'utf8'), {
        window, document: { baseURI: 'http://localhost/index.html', addEventListener() {} }, URL
    });
    const overrides = { '2026-12-27': { early: 'A', late: 'B', notes: 'keep' } };
    const base = { overrides };
    const draft = { ...base, shift_hours: ShiftHours.planChange({}, 'work', 'early', 'end', '16:15') };
    const latest = {
        overrides: { '2026-12-27': { ...overrides['2026-12-27'], notes: 'updated' } },
        off_weeks: { '2026-12-28': true },
        shift_hours: ShiftHours.planChange({}, 'work', 'early', 'start', '07:15')
    };
    const result = window.SharedSync.reapplyDraft(base, draft, latest);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        ...latest, shift_hours: { work: { early: { start: '07:15', end: '16:15' } } }
    });
});
