'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ShiftRotation = require('./shift-rotation');

const order = ['A', 'B', 'C', 'D', 'E', 'F'];
const baseDate = new Date('2026-11-15');
// The existing week key is the UTC date of Monday midnight in Japan.
const w21 = '2026-12-20';
const w28 = '2026-12-27';
const w04 = '2027-01-03';
const w11 = '2027-01-10';
const w18 = '2027-01-17';

function schedule(overrides, options = {}) {
    return ShiftRotation.create({ members: order, rotationOrder: order, baseDate, overrides, ...options });
}

function row(weekId, values) {
    const inputs = Object.fromEntries(Object.entries(values).map(([name, value]) =>
        [name, { dataset: { shiftField: name }, value }]));
    return {
        dataset: { weekId }, inputs,
        querySelectorAll(selector) {
            assert.equal(selector, '[data-shift-field]');
            return Object.values(inputs);
        },
        querySelector(selector) {
            return inputs[/\[data-shift-field="([^"]+)"\]/.exec(selector)?.[1]];
        }
    };
}

test('editing one week does not change the rotation across the year boundary', () => {
    const overrides = Object.freeze({
        '2026-12-13': Object.freeze({ early: 'F', late: 'E', notes: 'kept' }),
        [w21]: Object.freeze({ early: 'A', late: 'F' })
    });
    const resolve = schedule(overrides);
    assert.deepEqual(resolve(w21), { early: 'A', late: 'F', ruleId: null });
    assert.deepEqual(resolve(w28), { early: 'A', late: 'B', ruleId: null });
    assert.deepEqual(resolve(w04), { early: 'B', late: 'C', ruleId: null });
    assert.deepEqual(resolve(w11), { early: 'C', late: 'D', ruleId: null });
    assert.deepEqual(Object.keys(overrides), ['2026-12-13', w21]);
});

test('applying the roster from a chosen week supersedes future assignments without deleting saved rows', () => {
    const earlierKey = '2026-12-13';
    const earlierRule = Object.freeze({ id: 'earlier', order });
    const laterRule = Object.freeze({ id: 'later', order: [...order].reverse() });
    const previousRules = Object.freeze({ [earlierKey]: earlierRule, [w04]: laterRule });
    const firstSaved = Object.freeze({ early: 'E', late: 'F', date: 'kept date', normal: 'kept regular', notes: 'kept memo' });
    const overrides = Object.freeze({
        [w21]: Object.freeze({ early: 'A', late: 'F', rotation_rule_id: 'earlier' }),
        [w28]: firstSaved,
        [w04]: Object.freeze({ early: 'F', late: 'A', rotation_rule_id: 'later' })
    });
    const members = ['D', 'C', 'B', 'A', 'F', 'E'];
    const plan = ShiftRotation.planOrderChange({ weekId: w28, members, rotationRules: previousRules });
    const id = plan.rules[w28].id;
    members.reverse();
    const previous = schedule(overrides, { rotationRules: previousRules });
    const resolve = schedule(overrides, { rotationRules: plan.rules });
    assert.deepEqual(resolve(earlierKey), previous(earlierKey));
    assert.deepEqual(resolve(w21), previous(w21));
    assert.deepEqual(resolve(w28), { early: 'D', late: 'C', ruleId: id });
    assert.deepEqual(resolve(w04), { early: 'C', late: 'B', ruleId: id });
    assert.deepEqual(resolve(w11), { early: 'B', late: 'A', ruleId: id });
    assert.equal(overrides[w28], firstSaved);
    assert.equal(plan.rules[earlierKey], earlierRule);
    assert.equal(plan.rules[w04], undefined);
    assert.equal(previousRules[w04], laterRule);
});

test('reordering member management without applying leaves the prior order in effect', () => {
    const resolve = schedule({}, { members: ['D', 'C', 'A', 'B', 'F', 'E'] });
    assert.deepEqual(resolve('2026-11-08'), { early: 'F', late: 'A', ruleId: null });
    assert.deepEqual(resolve('2026-11-15'), { early: 'A', late: 'B', ruleId: null });
    assert.deepEqual(resolve('2026-12-13'), { early: 'E', late: 'F', ruleId: null });
});

test('early-to-late starts with the roster endpoints and gives each member four regular weeks', () => {
    const members = ['B', 'C', 'D', 'E', 'F', 'A'];
    const overrides = Object.freeze({ [w28]: Object.freeze({ early: 'A', late: 'F', notes: 'kept' }) });
    const plan = ShiftRotation.planOrderChange({ weekId: w04, members, mode: 'early-to-late' });
    assert.deepEqual(plan.first, { early: 'B', late: 'A' });
    assert.equal(plan.rules[w04].mode, 'early-to-late');

    const persistedRules = JSON.parse(JSON.stringify(plan.rules));
    const resolve = schedule(overrides, { rotationRules: persistedRules });
    assert.deepEqual(resolve(w28), schedule(overrides)(w28));
    for (let i = 0; i < members.length + 1; i++) {
        const week = new Date(w04 + 'T00:00:00Z');
        week.setUTCDate(week.getUTCDate() + 7 * i);
        assert.deepEqual(resolve(week.toISOString().slice(0, 10)), {
            early: members[i % members.length],
            late: members[(i + members.length - 1) % members.length],
            ruleId: plan.rules[w04].id
        });
    }
});

test('either mode can take over from a selected week without counting off weeks or changing earlier rules', () => {
    const offWeeks = { '2026-12-28': true, '2027-01-18': true };
    const toLate = ShiftRotation.planOrderChange({ weekId: w28, members: order, mode: 'early-to-late' });
    const backToEarly = ShiftRotation.planOrderChange({
        weekId: w18, members: order, mode: 'late-to-early', rotationRules: toLate.rules
    });
    assert.equal(backToEarly.rules[w28], toLate.rules[w28]);
    assert.deepEqual(backToEarly.first, { early: 'A', late: 'B' });
    const resolve = schedule({}, { offWeeks, rotationRules: backToEarly.rules });
    assert.equal(resolve(w28).off, true);
    assert.deepEqual(resolve(w04), { early: 'A', late: 'F', ruleId: toLate.rules[w28].id });
    assert.deepEqual(resolve(w11), { early: 'B', late: 'A', ruleId: toLate.rules[w28].id });
    assert.equal(resolve(w18).off, true);
    assert.deepEqual(resolve('2027-01-24'), { early: 'A', late: 'B', ruleId: backToEarly.rules[w18].id });
    assert.deepEqual(resolve('2027-01-31'), { early: 'B', late: 'C', ruleId: backToEarly.rules[w18].id });
});

test('off weeks do not consume a turn, including consecutive weeks across the year boundary', () => {
    const normal = schedule({});
    const off = schedule({}, { offWeeks: { '2026-12-28': true } });
    assert.deepEqual(off(w21), normal(w21));
    assert.deepEqual(off(w28), { early: '', late: '', ruleId: null, off: true });
    assert.deepEqual(off(w04), normal(w28));
    assert.deepEqual(off(w11), normal(w04));

    const consecutive = schedule({}, { offWeeks: { '2026-12-28': true, '2027-01-04': true, '2027-01-11': false } });
    assert.equal(consecutive(w04).off, true);
    assert.deepEqual(consecutive(w11), normal(w28));
    assert.deepEqual(consecutive(w18), normal(w04));
});

test('checking and unchecking an off week keeps manual assignments and other row fields', () => {
    const overrides = Object.freeze({
        [w28]: Object.freeze({ early: 'F', late: 'D', date: 'end of year', normal: 'regular', notes: 'memo' }),
        [w04]: Object.freeze({ early: 'E', late: 'B' })
    });
    const offWeeks = Object.freeze(ShiftRotation.planWeekOffChange({}, w28, true));
    const off = schedule(overrides, { offWeeks });
    assert.equal(off(w28).off, true);
    assert.deepEqual(off(w04), { early: 'E', late: 'B', ruleId: null });
    assert.deepEqual(off(w11), schedule({})(w04));

    const edited = ShiftRotation.readEdit(row(w28, { date: 'end of year', normal: 'regular', notes: 'new memo' }),
        overrides[w28], 'notes');
    assert.deepEqual(edited, { ...overrides[w28], notes: 'new memo' });
    const restored = schedule(overrides, { offWeeks: ShiftRotation.planWeekOffChange(offWeeks, w28, false) });
    assert.deepEqual(restored(w28), { early: 'F', late: 'D', ruleId: null });
    assert.deepEqual(restored(w11), schedule({})(w11));
    assert.equal(overrides[w28].notes, 'memo');
});

test('only off weeks within a new rotation affect its order, including its first week', () => {
    const offWeeks = { '2026-12-21': true, '2026-12-28': true, '2027-01-11': true };
    const nextOrder = ['D', 'B', 'F'];
    const rotationRules = { [w28]: { id: 'new', order: nextOrder } };
    const resolve = schedule({}, { offWeeks, rotationRules });
    assert.equal(resolve(w21).off, true);
    assert.deepEqual(resolve(w28), { early: '', late: '', ruleId: 'new', off: true });
    assert.deepEqual(resolve(w04), { early: 'D', late: 'B', ruleId: 'new' });
    assert.equal(resolve(w11).off, true);
    assert.deepEqual(resolve(w18), { early: 'B', late: 'F', ruleId: 'new' });
});

test('week-off settings use the same Monday key in Japan and other time zones', () => {
    const old = Object.freeze({ '2026-12-21': true });
    const marked = ShiftRotation.planWeekOffChange(old, w28, true);
    assert.deepEqual(marked, { '2026-12-21': true, '2026-12-28': true });
    assert.equal(ShiftRotation.isWeekOff(marked, w28), true);
    assert.equal(ShiftRotation.isWeekOff(marked, '2026-12-28'), true);
    assert.equal(ShiftRotation.planWeekOffChange(marked, '2026-12-29', true), null);
    assert.equal(ShiftRotation.planWeekOffChange(marked, '2026-12-28', true), null);
    assert.deepEqual(ShiftRotation.planWeekOffChange(marked, '2026-12-28', false), { ...marked, '2026-12-28': false });
    assert.equal(ShiftRotation.isWeekOff(old, w28), false);
});

test('reapplying a draft that unchecks the last off week keeps a second device\'s off week and notes', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync('shared-sync.js', 'utf8'), {
        window, document: { baseURI: 'http://localhost/index.html', addEventListener() {} }, URL
    });
    const base = { off_weeks: { '2026-12-28': true }, overrides: { [w04]: { notes: 'base' } } };
    const local = { ...base, off_weeks: ShiftRotation.planWeekOffChange(base.off_weeks, w28, false) };
    const remote = { off_weeks: { ...base.off_weeks, '2027-01-04': true }, overrides: { [w04]: { notes: 'remote' } } };
    const merged = window.SharedSync.reapplyDraft(base, local, remote);
    assert.deepEqual(JSON.parse(JSON.stringify(merged)), {
        off_weeks: { '2026-12-28': false, '2027-01-04': true }, overrides: remote.overrides
    });
});

test('the popup calendar allows all weekdays for 200 years and retains a valid selection', () => {
    const now = new Date(2026, 10, 24, 11);
    const input = { value: '2026-12-23', dataset: {} };
    const updates = [];
    let config;
    let initializations = 0;
    const flatpickr = (element, options) => {
        initializations++;
        config = options;
        element._flatpickr = {
            set(key, value) { updates.push([key, value]); },
            clear(triggerChange) {
                assert.equal(triggerChange, false);
                element.value = '';
            }
        };
        return element._flatpickr;
    };
    const context = vm.createContext({ flatpickr });
    vm.runInContext(moduleSource, context);
    const setup = context.ShiftRotation.setupStartCalendar;
    assert.equal(setup(input, now), input._flatpickr);
    assert.equal(config.minDate, '2026-11-23');
    assert.equal(config.maxDate, '2226-11-23');
    assert.equal(config.disableMobile, true);
    assert.equal(config.locale.firstDayOfWeek, 1);
    assert.equal(config.enable, undefined);
    assert.equal(config.disable, undefined);
    const classes = [];
    config.onReady([], '', { calendarContainer: { classList: { add: name => classes.push(name) } } });
    assert.deepEqual(classes, ['shift-start-calendar']);
    setup(input, now);
    assert.equal(initializations, 1);
    assert.deepEqual(updates, []);

    setup(input, new Date(2026, 10, 30, 12));
    assert.deepEqual(updates, [['minDate', '2026-11-30'], ['maxDate', '2226-11-30']]);
    assert.equal(input.value, '2026-12-23');
    setup(input, new Date(2026, 11, 28, 12));
    assert.equal(input.value, '');
});

test('the native fallback receives the same date limits when Flatpickr is unavailable', () => {
    const now = new Date(2026, 10, 24, 11);
    const input = { value: '2026-11-24', dataset: {} };
    assert.equal(ShiftRotation.setupStartCalendar(input, now), null);
    assert.equal(input.min, '2026-11-23');
    assert.equal(input.max, '2226-11-23');
    assert.equal(input.value, '2026-11-24');
    ShiftRotation.setupStartCalendar(input, new Date(2026, 10, 30, 12));
    assert.equal(input.value, '');
});

test('any date in range starts its calendar week and matches existing week keys', () => {
    const now = new Date(2026, 10, 24, 11);
    for (const selected of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']) {
        assert.deepEqual(ShiftRotation.selectStartWeek(selected, now), {
            date: '2026-11-23', weekId: new Date(2026, 10, 23).toISOString().slice(0, 10)
        });
    }
    for (const [selected, monday] of [['2027-01-01', '2026-12-28'], ['2127-11-25', '2127-11-24'], ['2226-11-23', '2226-11-20']]) {
        assert.deepEqual(ShiftRotation.selectStartWeek(selected, now), {
            date: monday, weekId: new Date(monday + 'T00:00:00').toISOString().slice(0, 10)
        });
    }
    assert.equal(ShiftRotation.selectStartWeek('2026-11-16', now), null);
    assert.equal(ShiftRotation.selectStartWeek('2026-11-22', now), null);
    assert.equal(ShiftRotation.selectStartWeek('2026-02-30', now), null);
    assert.equal(ShiftRotation.selectStartWeek('2226-11-24', now), null);
    assert.equal(ShiftRotation.selectStartWeek('', now), null);
    assert.equal(ShiftRotation.planOrderChange({ weekId: w28, members: ['A', 'A'] }), null);
    const plan = ShiftRotation.planOrderChange({ weekId: '2026-12-28', members: ['B', 'A'] });
    assert.deepEqual(schedule({}, { rotationRules: plan.rules })(w28), {
        early: 'B', late: 'A', ruleId: plan.rules['2026-12-28'].id
    });
});

test('the mode picker follows the saved mode for the selected week until a mode is chosen', () => {
    const context = vm.createContext({
        Date: class FixtureDate extends Date {
            constructor(...args) { super(...(args.length ? args : [2026, 11, 22, 11])); }
        }
    });
    vm.runInContext(moduleSource, context);
    const radios = { value: '' };
    const listeners = [];
    const form = {
        dataset: {},
        elements: { namedItem: name => name === 'shift-rotation-mode' ? radios : null },
        addEventListener(event, listener) {
            assert.equal(event, 'change');
            listeners.push(listener);
        }
    };
    const input = { value: '', form };
    const rules = { [w04]: { id: 'future', order, mode: 'early-to-late' } };
    const setup = context.ShiftRotation.setupModePicker;
    setup(input, () => rules);
    assert.equal(radios.value, 'late-to-early');
    input.value = '2027-01-06';
    listeners[0]({ target: input });
    assert.equal(radios.value, 'early-to-late');

    radios.value = 'late-to-early';
    listeners[0]({ target: { name: 'shift-rotation-mode' } });
    input.value = '2027-01-11';
    listeners[0]({ target: input });
    setup(input, () => rules);
    assert.equal(listeners.length, 1);
    assert.equal(radios.value, 'late-to-early');
});

test('editing only a date, regular shift or notes does not restore superseded names', () => {
    const values = { early: 'B', late: 'A', date: 'edited date', normal: 'edited regular', notes: 'edited note' };
    for (const field of ['date', 'normal', 'notes']) {
        const previous = { early: 'F', late: 'E', rotation_rule_id: 'old', notes: 'kept' };
        const edited = ShiftRotation.readEdit(row(w28, values), previous, field);
        assert.equal(edited.rotation_rule_id, 'old');
        assert.equal(edited[field], values[field]);
        const resolve = schedule({ [w28]: edited }, { rotationRules: { [w28]: { id: 'new', order } } });
        assert.deepEqual(resolve(w28), { early: 'A', late: 'B', ruleId: 'new' });
        assert.deepEqual(resolve(w04), { early: 'B', late: 'C', ruleId: 'new' });
    }
    const legacy = { early: 'A', late: 'F', date: 'kept', normal: 'kept', notes: 'old' };
    assert.deepEqual(ShiftRotation.readEdit(row(w21, values), legacy, 'notes'), { ...legacy, notes: 'edited note' });
    assert.equal(ShiftRotation.readEdit(row(w21, values), undefined, 'notes').auto_assignment, true);
});

test('a single name changed after a new order is applied affects only that week', () => {
    const previous = { date: 'kept', normal: 'kept', notes: 'kept', early: 'B', late: 'C', auto_assignment: true };
    const values = { date: 'display', normal: 'display', notes: 'display', early: 'B', late: 'E' };
    const edited = ShiftRotation.readEdit(row(w28, values), previous, 'late', 'applied');
    const rotationRules = { [w21]: { id: 'applied', order } };
    const resolve = schedule({ [w28]: edited }, { rotationRules });
    assert.deepEqual(edited, { ...previous, late: 'E', auto_assignment: false, rotation_rule_id: 'applied' });
    assert.deepEqual(resolve(w28), { early: 'B', late: 'E', ruleId: 'applied' });
    assert.deepEqual(resolve(w04), { early: 'C', late: 'D', ruleId: 'applied' });
    const plan = ShiftRotation.planOrderChange({ weekId: w21, members: order, rotationRules });
    assert.deepEqual(schedule({ [w28]: edited }, { rotationRules: plan.rules })(w28), {
        early: 'B', late: 'C', ruleId: plan.rules[w21].id
    });
});

test('removing a member from the draft roster does not change historical assignments', () => {
    const resolve = schedule({ [w21]: { early: 'A', late: 'removed' } }, { members: order.slice(1) });
    assert.deepEqual(resolve(w21), { early: 'A', late: 'removed', ruleId: null });
    assert.deepEqual(resolve(w28), { early: 'A', late: 'B', ruleId: null });
});

const mainJs = fs.readFileSync('app.js', 'utf8');
const mainHtml = fs.readFileSync('index.html', 'utf8');
const standalone = fs.readFileSync('\u30b7\u30d5\u30c8\u8868 - \u30b3\u30d4\u30fc/index.html', 'utf8');
const moduleSource = fs.readFileSync('shift-rotation.js', 'utf8');
const variants = [
    {
        name: 'main',
        html: mainHtml,
        source: mainJs,
        editStart: 'function shiftAssignments()',
        editEnd: 'window.shiftSaveRowState =',
        renderStart: 'function shiftGenerateTable()',
        renderEnd: 'window.shiftGenerateTable =',
        render: 'shiftGenerateTable',
        save: 'shiftSaveRowState',
        apply: 'shiftUpdateRotationOrder',
        applyEnd: 'window.shiftUpdateRotationOrder =',
        setOff: 'shiftSetWeekOff',
        setOffEnd: 'window.shiftSetWeekOff =',
        rules: 'shiftRotationRules',
        offWeeks: 'shiftOffWeeks',
        syncStart: 'const shiftFirebaseConfig',
        saveAll: 'shiftSaveAllData'
    },
    {
        name: 'standalone',
        html: standalone,
        source: standalone,
        editStart: 'function resolveAssignments()',
        editEnd: 'function isJapaneseHoliday(date)',
        renderStart: 'function generateTable()',
        renderEnd: '</script>',
        render: 'generateTable',
        save: 'saveRowState',
        apply: 'updateRotationOrder',
        applyEnd: 'function setWeekOff(',
        setOff: 'setWeekOff',
        setOffEnd: 'let draggedElement =',
        rules: 'rotationRules',
        offWeeks: 'offWeeks',
        syncStart: 'const firebaseConfig',
        saveAll: 'saveAllData'
    }
];
function extract(source, start, end) {
    const left = source.indexOf(start);
    const right = source.indexOf(end, left);
    assert.ok(left >= 0 && right > left, start);
    return source.slice(left, right);
}

test('reordering standalone shift members does not clear weekly records or off flags', () => {
    const overrides = Object.freeze({ [w28]: { early: 'B', late: 'C', notes: 'kept' } });
    const offWeeks = Object.freeze({ '2026-12-28': true });
    let saved;
    let renders = 0;
    const context = vm.createContext({
        names: ['A', 'B', 'C'], overrides, offWeeks, draggedIndex: 0,
        saveAllData() { saved = { overrides: context.overrides, offWeeks: context.offWeeks }; },
        renderMembers() { renders++; }
    });
    vm.runInContext(extract(standalone, 'function handleDrop(e)', 'function addMember()'), context);
    context.handleDrop.call({ dataset: { index: '2' }, classList: { remove() {} } }, { preventDefault() {} });
    assert.deepEqual(context.names, ['B', 'C', 'A']);
    assert.deepEqual(saved, { overrides, offWeeks });
    assert.equal(renders, 1);
});

for (const variant of variants) {
    test(variant.name + ' loads and saves rotation modes and off-week flags separately from existing records', () => {
        let options;
        let saved;
        const database = {};
        const context = vm.createContext({
            firebase: { initializeApp: () => ({ database: () => database }), database: () => database },
            SharedSync: {
                guardDatabase: value => value, startVersionGuard() {},
                createPathSync(settings) {
                    options = settings;
                    return { save: value => { saved = value; return true; } };
                }
            },
            renderMembers() {}, canWriteAppData: () => true
        });
        context.window = context;
        vm.runInContext(extract(variant.source, variant.syncStart, 'function ' + variant.apply + '()'), context);
        assert.equal(options.getLocal().off_weeks, undefined);
        const records = { [w04]: { early: 'E', late: 'B', normal: 'regular', notes: 'keep' } };
        const offWeeks = { '2026-12-28': false, '2027-01-04': true };
        const rules = { [w04]: { id: 'new', order, mode: 'early-to-late' } };
        options.setLocal({ overrides: records, off_weeks: offWeeks, rotation_rules: rules });
        assert.equal(options.getLocal().off_weeks, offWeeks);
        assert.equal(options.getLocal().rotation_rules, rules);
        assert.equal(context[variant.saveAll](), true);
        assert.equal(saved.off_weeks, offWeeks);
        assert.equal(saved.rotation_rules, rules);
        assert.equal(saved.overrides, records);
        options.setLocal({ overrides: records });
        assert.equal(options.getLocal().off_weeks, undefined);
    });

    test(variant.name + ' preserves overrides when applying a roster and when toggling off weeks', () => {
        assert.match(variant.html, /<script src="(?:\.\.\/)?shift-rotation\.js(?:\?[^"]+)?"\s*><\/script>/);
        assert.match(variant.html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/flatpickr"><\/script>/);
        const dateInput = /<input type="date" id="shift-rotation-start"[^>]*>/.exec(variant.html)?.[0];
        assert.match(dateInput, /\brequired\b/);
        assert.doesNotMatch(dateInput, /\bstep=/);
        assert.match(variant.html, /<form id="shift-rotation-form"[^>]*>[\s\S]*?<input type="date" id="shift-rotation-start"[\s\S]*?<\/form>\s*<h3>/);
        assert.match(variant.html, /<input type="radio" name="shift-rotation-mode" value="late-to-early" checked>/);
        assert.match(variant.html, /<input type="radio" name="shift-rotation-mode" value="early-to-late">/);
        assert.match(variant.html, /<button type="submit" form="shift-rotation-form"/);
        assert.ok(variant.html.includes('onsubmit="event.preventDefault(); ' + variant.apply + '()"'));
        const saved = {
            [w21]: { early: 'A', late: 'F', notes: 'anchor note', date: 'anchor date' },
            [w04]: { early: 'E', late: 'C', notes: 'saved future' }
        };
        const futureSaved = { ...saved[w04] };
        const rows = new Map([
            [w21, row(w21, { date: 'anchor date', early: 'A', late: 'F', normal: 'regular', notes: 'anchor note' })],
            [w28, row(w28, { date: 'next date', early: 'A', late: 'B', normal: 'regular', notes: 'in-progress note' })],
            [w04, row(w04, { date: 'future date', early: 'E', late: 'C', normal: 'regular', notes: 'saved future' })],
            [w11, row(w11, { date: 'later date', early: 'F', late: 'D', normal: 'regular', notes: '' })]
        ]);
        const tbody = {
            innerHTML: '',
            querySelector(selector) { return rows.get(/tr\[data-week-id="([^"]+)"\]/.exec(selector)?.[1]); },
            querySelectorAll() { return [...rows.values()]; }
        };
        const radios = { value: 'late-to-early' };
        const form = { dataset: {}, elements: { namedItem: name => name === 'shift-rotation-mode' ? radios : null } };
        const input = { value: '2026-12-30', form };
        const writes = [];
        const prompts = [];
        let accepted = false;
        let pending = null;
        let paused = false;
        const sync = { isReady: () => true, isPaused: () => paused, getPending: () => pending };
        const monday = () => new Date(w21 + 'T15:00:00Z');
        const fakeDateText = () => 'display date';
        const roster = ['D', 'C', 'B', 'A', 'F', 'E'];
        const save = () => writes.push(JSON.parse(JSON.stringify({
            overrides: saved, rules: context[variant.rules], offWeeks: context[variant.offWeeks]
        })));
        const context = vm.createContext({
            Date: class FixtureDate extends Date {
                constructor(...args) { super(...(args.length ? args : [2026, 11, 22, 11])); }
            },
            document: { getElementById: id => id === 'shift-tbody' ? tbody : id === 'shift-rotation-start' ? input : {} },
            SharedSync: { escapeHtml: value => String(value), canWrite: () => true },
            alert() {},
            confirm(message) { prompts.push(message); return accepted; },
            isJapaneseHoliday: () => false,
            names: roster, rotationOrder: order, baseDate, overrides: saved, rotationRules: {}, offWeeks: {}, dataSync: sync,
            shiftNames: roster, shiftRotationOrder: order, shiftBaseDate: baseDate, shiftOverrides: saved,
            shiftRotationRules: {}, shiftOffWeeks: {}, shiftDataSync: sync,
            canWriteAppData: () => true, shiftSaveAllData: save, saveAllData: save,
            shiftGetMondayOfCurrentWeek: monday, getMondayOfCurrentWeek: monday,
            shiftFormatDate: fakeDateText, formatDate: fakeDateText
        });
        context.window = context;
        vm.runInContext(moduleSource, context);
        vm.runInContext(extract(variant.source, variant.editStart, variant.editEnd), context);
        vm.runInContext(extract(variant.source, variant.renderStart, variant.renderEnd), context);
        vm.runInContext(extract(variant.source, 'function ' + variant.apply + '()', variant.applyEnd), context);
        vm.runInContext(extract(variant.source, 'function ' + variant.setOff + '(', variant.setOffEnd), context);
        context[variant.render]();
        const displayed = /<tr data-week-id="2026-12-27">([\s\S]*?)<\/tr>/.exec(tbody.innerHTML)?.[1];
        assert.match(displayed, /<option value="B" selected>B<\/option>/);
        assert.match(displayed, /<option value="A" selected>A<\/option>/);
        assert.equal(writes.length, 0);

        context[variant.save](w28, 'notes');
        assert.equal(saved[w28].notes, 'in-progress note');
        assert.equal(saved[w28].auto_assignment, true);
        const htmlBeforeEdit = tbody.innerHTML;
        rows.get(w21).inputs.early.value = 'C';
        context[variant.save](w21, 'early');
        assert.equal(tbody.innerHTML, htmlBeforeEdit);
        assert.equal(rows.get(w28).inputs.early.value, 'A');
        assert.equal(rows.get(w28).inputs.late.value, 'B');
        assert.equal(rows.get(w28).inputs.notes.value, 'in-progress note');
        assert.equal(rows.get(w04).inputs.early.value, 'E');
        assert.equal(rows.get(w11).inputs.early.value, 'F');
        assert.deepEqual(saved[w04], futureSaved);
        assert.equal(saved[w21].notes, 'anchor note');
        assert.equal(saved[w21].auto_assignment, false);
        assert.equal(saved[w11], undefined);
        assert.equal(writes.length, 2);

        pending = { local: 'not yet saved' };
        context[variant.apply]();
        assert.equal(prompts.length, 0);
        pending = null;
        context[variant.apply]();
        assert.equal(input.value, '2026-12-30');
        assert.match(prompts[0], /2026-12-28/);
        assert.equal(writes.length, 2);
        assert.deepEqual(context[variant.rules], {});
        accepted = true;
        context[variant.apply]();
        const appliedKey = new Date(2026, 11, 28).toISOString().slice(0, 10);
        assert.deepEqual(writes[2].rules[appliedKey].order, roster);
        assert.equal(writes[2].rules[appliedKey].mode, 'late-to-early');
        assert.deepEqual(writes[2].overrides, writes[1].overrides);
        const appliedRow = /<tr data-week-id="2026-12-27">([\s\S]*?)<\/tr>/.exec(tbody.innerHTML)?.[1];
        assert.match(appliedRow, /data-shift-field="early"[\s\S]*?<option value="D" selected>D<\/option>/);
        assert.match(appliedRow, /data-shift-field="late"[\s\S]*?<option value="C" selected>C<\/option>/);
        assert.match(appliedRow, /in-progress note/);

        const checkbox = { checked: true, matches: () => false };
        context[variant.setOff](w28, checkbox);
        assert.deepEqual(writes[3].overrides, writes[2].overrides);
        assert.deepEqual(writes[3].rules, writes[2].rules);
        assert.deepEqual(writes[3].offWeeks, { '2026-12-28': true });
        const offRow = /<tr data-week-id="2026-12-27">([\s\S]*?)<\/tr>/.exec(tbody.innerHTML)?.[1];
        assert.match(offRow, /type="checkbox"[^>]+checked/);
        assert.equal([...offRow.matchAll(/<span>\u306a\u3057<\/span>/g)].length, 2);
        assert.doesNotMatch(offRow, /data-shift-field="(?:early|late)"/);
        assert.match(offRow, /in-progress note/);
        const carriedRow = /<tr data-week-id="2027-01-03">([\s\S]*?)<\/tr>/.exec(tbody.innerHTML)?.[1];
        assert.match(carriedRow, /data-shift-field="early"[\s\S]*?<option value="D" selected>D<\/option>/);
        assert.match(carriedRow, /data-shift-field="late"[\s\S]*?<option value="C" selected>C<\/option>/);
        assert.match(carriedRow, /saved future/);

        accepted = false;
        context[variant.apply]();
        assert.match(prompts[2], /\u6b21\u306e\u5f53\u756a\u9031/);
        assert.equal(writes.length, 4);
        paused = true;
        checkbox.checked = false;
        context[variant.setOff](w28, checkbox);
        assert.equal(checkbox.checked, true);
        assert.equal(writes.length, 4);
        paused = false;
        checkbox.checked = false;
        context[variant.setOff](w28, checkbox);
        assert.deepEqual(writes[4].offWeeks, { '2026-12-28': false });
        assert.deepEqual(writes[4].overrides, writes[2].overrides);
        const restoredRow = /<tr data-week-id="2026-12-27">([\s\S]*?)<\/tr>/.exec(tbody.innerHTML)?.[1];
        assert.doesNotMatch(restoredRow, /type="checkbox"[^>]+checked/);
        assert.match(restoredRow, /<option value="D" selected>D<\/option>/);

        input.value = '2027-01-04';
        radios.value = 'early-to-late';
        form.dataset.rotationModeChanged = 'true';
        context[variant.apply]();
        assert.equal(writes.length, 5);
        assert.equal(form.dataset.rotationModeChanged, 'true');
        assert.match(prompts[3], /\u65e9\u756a\uff1aD\uff0f\u9045\u756a\uff1aE/);
        accepted = true;
        context[variant.apply]();
        assert.equal(form.dataset.rotationModeChanged, undefined);
        assert.equal(writes[5].rules[w04].mode, 'early-to-late');
        assert.deepEqual(writes[5].rules[appliedKey], writes[2].rules[appliedKey]);
        assert.deepEqual(writes[5].overrides, writes[2].overrides);
        assert.deepEqual(writes[5].offWeeks, writes[4].offWeeks);
        const newRow = /<tr data-week-id="2027-01-03">([\s\S]*?)<\/tr>/.exec(tbody.innerHTML)?.[1];
        assert.match(newRow, /data-shift-field="early"[\s\S]*?<option value="D" selected>D<\/option>/);
        assert.match(newRow, /data-shift-field="late"[\s\S]*?<option value="E" selected>E<\/option>/);
    });
}
