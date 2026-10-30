'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const sources = Object.fromEntries(
    ['app.js', '1f-app.js', '1f-kenpin-app.js', 'saidan-app.js', 'shared-sync.js']
        .map(file => [file, fs.readFileSync(file, 'utf8')])
);

function section(file, startMarker, endMarker) {
    const source = sources[file];
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Missing ${file}: ${startMarker}`);
    return source.slice(start, end);
}

function element() {
    return {
        innerHTML: '', textContent: '', style: {}, children: [], dataset: {},
        classList: { add() {}, remove() {} },
        appendChild(child) { this.children.push(child); },
        setAttribute() {}, addEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => []
    };
}

function fixture(file, startMarker, endMarker, options = {}) {
    const elements = new Map();
    const document = {
        addEventListener() {},
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        querySelectorAll: () => [],
        createElement: element
    };
    const context = vm.createContext({
        document,
        window: {
            location: { href: 'http://127.0.0.1/test' },
            history: { replaceState() {} }
        },
        URL, console,
        currentDate: '2026-10-19',
        MACHINES: ['R1', 'R2', 'R3', 'R4'],
        database: null, recordsSync: null, startTimePresetButtons: [],
        records: [],
        recordsList: document.getElementById('records-list'),
        calculateDuration: () => ({ h: 1, m: 0 }),
        calculateDefectRate: () => 0,
        calculateAndDisplayStats() {}, renderTrashList() {},
        updateDailyStartTimeControls() {},
        getCumulativeTotal: () => 0,
        ensureMinRows() {}, updateCountDisplay() {},
        activeRecordId: null, BLANK_ROWS: 0,
        ...options
    });
    vm.runInContext(sources['shared-sync.js'], context, { filename: 'shared-sync.js' });
    context.SharedSync = context.window.SharedSync;
    if (file === '1f-app.js') {
        const helperStart = sources[file].indexOf('function getMachineBadgeClass(');
        if (helperStart >= 0) {
            vm.runInContext(section(file, 'function getMachineBadgeClass(', '// Monthly Records'), context);
        }
    } else if (file === 'app.js') {
        vm.runInContext(section(file, 'function normalizeTime(', '// Initialize'), context);
        vm.runInContext(section(file, 'function getDailyRecordUpdatedAt(', 'function normalizeDailyRecords('), context);
        vm.runInContext(section(file, 'function getPreviousStartTime(', '// Ensure machines A-J'), context);
    }
    vm.runInContext(section(file, startMarker, endMarker), context, { filename: file });
    return { context, document, elements };
}

const text = 'A"B <tag> & \'C\' \\path';
const encoded = 'A&quot;B &lt;tag&gt; &amp; &#39;C&#39; \\path';
const record = {
    id: 1, date: '2026-10-19', machine: 'R1', count: 12,
    product: text, customer: text, type: text, lot: text, operator: text,
    worker: text, notes: text + '\n</textarea>', startTime: '08:45', endTime: '17:00'
};

test('sidebar overlay only intercepts page input while the menu is active', () => {
    const css = fs.readFileSync('style.css', 'utf8');
    const closed = css.match(/\.sidebar-overlay\s*\{([^}]+)\}/);
    const open = css.match(/\.sidebar-overlay\.active\s*\{([^}]+)\}/);
    assert.ok(closed && open);
    assert.match(closed[1], /pointer-events:\s*none\s*;/);
    assert.match(open[1], /pointer-events:\s*auto\s*;/);
});

function dailyLayoutFixture(mobile) {
    function container(children) {
        return { children, moves: 0, get firstChild() { return this.children[0] || null; },
            insertBefore(child, next) {
                const previous = child.parentElement;
                if (previous) previous.children.splice(previous.children.indexOf(child), 1);
                const index = next ? this.children.indexOf(next) : this.children.length;
                this.children.splice(index, 0, child);
                child.parentElement = this;
                this.moves++;
            } };
    }
    const targets = { hidden: false, selection: { A: true, C: true } };
    const dateSelector = { value: '2026-10-19' };
    const table = {};
    const day = container([targets, table]);
    day.style = { display: 'block' };
    targets.parentElement = day;
    const header = container([dateSelector]);
    dateSelector.parentElement = header;
    const f = fixture('app.js', 'function updateDailyStartTimeLayout(', 'function updateDailyStartTimeControls(', {
        dayViewContainer: day,
        saveRecords() { assert.fail('Layout changes must not save records'); }
    });
    f.elements.set('daily-start-time-targets', targets);
    f.elements.set('dayDateSelector', dateSelector);
    f.context.window.matchMedia = () => ({ matches: mobile });
    return { ...f, targets, dateSelector, day, header, table, setMobile(value) { mobile = value; } };
}

test('2F desktop layout leaves targets in the original position without DOM moves', () => {
    const f = dailyLayoutFixture(false);
    f.context.updateDailyStartTimeLayout();
    f.context.updateDailyStartTimeLayout();
    assert.equal(f.targets.parentElement, f.day);
    assert.deepEqual(f.day.children, [f.targets, f.table]);
    assert.deepEqual(f.header.children, [f.dateSelector]);
    assert.equal(f.day.moves + f.header.moves, 0);
    assert.equal(f.targets.hidden, false);
});

test('2F mobile layout moves the existing target controls before the calendar', () => {
    const f = dailyLayoutFixture(true);
    const selection = f.targets.selection;
    f.context.updateDailyStartTimeLayout();
    f.context.updateDailyStartTimeLayout();
    assert.deepEqual(f.header.children, [f.targets, f.dateSelector]);
    assert.deepEqual(f.day.children, [f.table]);
    assert.equal(f.header.moves, 1);
    assert.equal(f.targets.selection, selection);
    assert.deepEqual(selection, { A: true, C: true });
    assert.equal(f.dateSelector.value, '2026-10-19');
});

test('2F resizing restores the desktop position while keeping the same controls and selection', () => {
    const f = dailyLayoutFixture(true);
    f.context.updateDailyStartTimeLayout();
    f.setMobile(false);
    f.context.updateDailyStartTimeLayout();
    assert.deepEqual(f.day.children, [f.targets, f.table]);
    assert.deepEqual(f.header.children, [f.dateSelector]);
    assert.deepEqual(f.targets.selection, { A: true, C: true });
    f.setMobile(true);
    f.context.updateDailyStartTimeLayout();
    assert.deepEqual(f.header.children, [f.targets, f.dateSelector]);
});

test('2F other views hide and restore moved target controls before returning to the daily view', () => {
    const f = dailyLayoutFixture(true);
    f.context.updateDailyStartTimeLayout();
    f.day.style.display = 'none';
    f.context.updateDailyStartTimeLayout();
    assert.equal(f.targets.hidden, true);
    assert.deepEqual(f.header.children, [f.dateSelector]);
    assert.deepEqual(f.day.children, [f.targets, f.table]);
    f.day.style.display = 'block';
    f.context.updateDailyStartTimeLayout();
    assert.equal(f.targets.hidden, false);
    assert.deepEqual(f.header.children, [f.targets, f.dateSelector]);
});

function productionStartTimeFixture(data, selected = ['A', 'C', 'E'], options = {}) {
    const machineOptions = { children: [], replacements: 0, replaceChildren(...children) {
        this.children = children;
        this.replacements++;
    } };
    const buttons = [{ disabled: true }, { disabled: true }];
    const all = { checked: false, disabled: true, indeterminate: false };
    const saved = [];
    let renders = 0;
    const f = fixture('app.js', 'function updateDailyStartTimeControls(', '// Update a specific field in a record', {
        records: structuredClone(data), MACHINES: Array.from('ABCDEFGHIJ'),
        database: {}, dailyRecordsSync: { isReady: () => true },
        dayViewContainer: { style: { display: 'block' } }, canWriteAppData: () => true,
        dailyStartTimeSelectionDate: '2026-10-19', dailyStartTimeMachineInputs: [], dailyStartTimeOptions: machineOptions,
        dailyStartTimeButtons: buttons, dailyStartTimeAllInput: all,
        markSyncUpdated(item, updatedAt) { item._syncUpdatedAt = updatedAt; },
        saveRecords() { saved.push(structuredClone(f.context.records)); },
        renderRecords() { renders++; f.context.updateDailyStartTimeControls(); },
        ...options
    });
    f.context.updateDailyStartTimeControls();
    f.context.dailyStartTimeMachineInputs.forEach(input => {
        input.checked = !input.disabled && selected.includes(input.value);
    });
    f.context.updateDailyStartTimeControls();
    return { ...f, get inputs() { return Array.from(f.context.dailyStartTimeMachineInputs); },
        machineOptions, buttons, all, saved, getRenders: () => renders };
}

for (const time of ['07:00', '08:30']) {
    test(`2F preset ${time} saves only the selected A/C/E start times for the current date`, () => {
        const data = [
            ...Array.from('ABCDEFGHIJ', (machine, index) => ({ ...record, id: index + 1, machine, _syncUpdatedAt: 100 })),
            { ...record, id: 11, machine: 'custom' },
            { ...record, id: 12, machine: 'A', date: '2026-10-18' },
            { ...record, id: 13, machine: 'C', date: '2026-10-20' }
        ];
        const f = productionStartTimeFixture(data);
        assert.equal(f.context.setSelectedDayStartTime(time), true);
        assert.equal(f.saved.length, 1);
        assert.equal(f.getRenders(), 1);
        f.saved[0].forEach((item, index) => {
            if (index < 10 && ['A', 'C', 'E'].includes(item.machine)) {
                assert.deepEqual(item, { ...data[index], startTime: time, _startTimeMode: 'manual', _inheritedStartTime: '', _syncUpdatedAt: item._syncUpdatedAt });
                assert.ok(item._syncUpdatedAt > 100);
            } else {
                assert.deepEqual(item, data[index]);
            }
        });
        assert.deepEqual(f.inputs.filter(input => input.checked).map(input => input.value), ['A', 'C', 'E']);
        assert.equal(f.all.indeterminate, true);
        assert.equal(f.context.setSelectedDayStartTime(time), false);
        assert.equal(f.saved.length, 1, 'Unchanged presets must not create another save');
    });
}

test('2F presets keep unchanged timestamps and update every existing row of a selected machine', () => {
    const f = productionStartTimeFixture([
        { ...record, machine: 'A', startTime: '07:00', _startTimeMode: 'manual', _inheritedStartTime: '', _syncUpdatedAt: 123 },
        { ...record, id: 2, machine: 'A', _syncUpdatedAt: 456 },
        { ...record, id: 3, machine: 'B', _syncUpdatedAt: 789 }
    ], ['A']);
    f.context.setSelectedDayStartTime('07:00');
    assert.equal(f.saved[0][0]._syncUpdatedAt, 123);
    assert.equal(f.saved[0][1].startTime, '07:00');
    assert.ok(f.saved[0][1]._syncUpdatedAt > 456);
    assert.deepEqual(f.saved[0][2], f.context.records[2]);
    assert.equal(f.saved[0].length, 3);
});

test('2F selection controls reflect partial/all/none without saving records', () => {
    const f = productionStartTimeFixture(Array.from('ABCDEFGHIJ', machine => ({ ...record, machine })));
    f.context.updateDailyStartTimeControls();
    assert.equal(f.all.disabled, false);
    assert.equal(f.all.checked, false);
    assert.equal(f.all.indeterminate, true);
    assert.ok(f.buttons.every(button => !button.disabled));
    f.inputs.forEach(input => { input.checked = true; });
    f.context.updateDailyStartTimeControls();
    assert.equal(f.all.checked, true);
    assert.equal(f.all.indeterminate, false);
    f.inputs.forEach(input => { input.checked = false; });
    f.context.updateDailyStartTimeControls();
    assert.equal(f.all.checked, false);
    assert.equal(f.all.indeterminate, false);
    assert.ok(f.buttons.every(button => button.disabled));
    assert.equal(f.saved.length, 0);
});

test('2F selecting a different date clears targets without editing or creating records', () => {
    const f = productionStartTimeFixture([
        { ...record, machine: 'A' }, { ...record, id: 2, machine: 'A', date: '2026-10-20' }
    ]);
    const before = JSON.stringify(f.context.records);
    f.context.currentDate = '2026-10-20';
    f.context.updateDailyStartTimeControls();
    assert.ok(f.inputs.every(input => !input.checked));
    assert.ok(f.buttons.every(button => button.disabled));
    assert.equal(f.inputs[0].disabled, false);
    assert.ok(f.inputs.slice(1).every(input => input.disabled));
    assert.equal(f.context.dailyStartTimeSelectionDate, '2026-10-20');
    assert.equal(JSON.stringify(f.context.records), before);
    assert.equal(f.saved.length, 0);
});

test('2F empty and loading dates disable targets and presets', () => {
    for (const loading of [false, true]) {
        const f = productionStartTimeFixture(loading ? [{ ...record, machine: 'A' }] : [], ['A'], {
            dailyRecordsSync: { isReady: () => !loading }
        });
        f.context.updateDailyStartTimeControls();
        assert.ok(f.inputs.every(input => input.disabled && !input.checked));
        assert.ok(f.buttons.every(button => button.disabled));
        assert.equal(f.all.disabled, true);
        assert.equal(f.context.setSelectedDayStartTime('07:00'), false);
        assert.equal(f.saved.length, 0);
    }
});

test('2F new K/L targets preserve existing selections and do not save just by appearing', () => {
    const data = Array.from('ABCDEFGHIJ', (machine, index) => ({ ...record, id: index + 1, machine }));
    const f = productionStartTimeFixture(data, ['A', 'C']);
    const originalInputs = f.inputs;
    const replacements = f.machineOptions.replacements;
    f.context.updateDailyStartTimeControls();
    assert.equal(f.machineOptions.replacements, replacements, 'Unchanged options must retain focusable nodes');
    assert.equal(f.inputs[0], originalInputs[0]);

    f.context.records.push({ ...record, id: 11, machine: 'K' });
    f.context.updateDailyStartTimeControls();
    assert.equal(f.inputs.length, 11);
    assert.deepEqual(f.inputs.filter(input => input.checked).map(input => input.value), ['A', 'C']);
    const k = f.inputs.find(input => input.value === 'K');
    assert.equal(k.disabled, false);
    assert.equal(k.checked, false);
    k.checked = true;
    assert.equal(f.context.setSelectedDayStartTime('07:00'), true);
    assert.deepEqual(f.saved[0].filter(item => item.startTime === '07:00').map(item => item.machine), ['A', 'C', 'K']);

    f.context.records = f.context.records.filter(item => item.machine !== 'K');
    f.context.records.push({ ...record, id: 12, machine: 'L' });
    f.context.updateDailyStartTimeControls();
    assert.equal(f.inputs.some(input => input.value === 'K'), false);
    assert.equal(f.inputs.find(input => input.value === 'L').checked, false);
    assert.deepEqual(f.inputs.filter(input => input.checked).map(input => input.value), ['A', 'C']);
    assert.equal(f.saved.length, 1);
});

test('2F a new machine can be targeted without any default A-J records', () => {
    const f = productionStartTimeFixture([{ ...record, machine: 'K' }], ['K']);
    assert.equal(f.inputs.length, 11);
    assert.ok(f.inputs.filter(input => input.value !== 'K').every(input => input.disabled));
    assert.equal(f.inputs.find(input => input.value === 'K').disabled, false);
    assert.ok(f.buttons.every(button => !button.disabled));
    assert.equal(f.context.setSelectedDayStartTime('08:30'), true);
    assert.equal(f.saved[0].length, 1);
    assert.equal(f.saved[0][0].startTime, '08:30');
});

test('2F duplicate and literal custom names produce one safe option per current-day machine', () => {
    const f = productionStartTimeFixture([
        { ...record, machine: text }, { ...record, id: 2, machine: text },
        { ...record, id: 3, machine: '__proto__' }, { ...record, id: 4, machine: 'constructor' },
        { ...record, id: 5, machine: 'K', date: '2026-10-20' },
        { ...record, id: 6, machine: '   ' }, { ...record, id: 7, machine: '' }
    ], [text]);
    assert.equal(f.inputs.length, 13);
    assert.equal(f.inputs.filter(input => input.value === text).length, 1);
    assert.equal(f.inputs.some(input => input.value === 'K'), false);
    const option = f.machineOptions.children.find(label => label.children[0].value === text);
    assert.equal(option.children[1].textContent, text);
    assert.equal(option.children[1].innerHTML, '');
    assert.equal(f.saved.length, 0);
    f.context.setSelectedDayStartTime('07:00');
    assert.equal(f.saved[0][0].startTime, '07:00');
    assert.equal(f.saved[0][1].startTime, '07:00');
    assert.ok(f.saved[0].slice(2).every(item => item.startTime === '08:45'));
});

test('2F changing date removes old extra machines and clears the new targets', () => {
    const f = productionStartTimeFixture([
        { ...record, machine: 'K' }, { ...record, id: 2, machine: 'L', date: '2026-10-20' }
    ], ['K']);
    f.context.currentDate = '2026-10-20';
    f.context.updateDailyStartTimeControls();
    assert.equal(f.inputs.some(input => input.value === 'K'), false);
    assert.equal(f.inputs.find(input => input.value === 'L').checked, false);
    assert.ok(f.buttons.every(button => button.disabled));
    assert.equal(f.saved.length, 0);
});

for (const scenario of ['no selection', 'loading', 'missing sync', 'stale version', 'other view', 'invalid time', 'stale date', 'disabled target', 'unknown target']) {
    test(`2F preset does not edit or save during ${scenario}`, () => {
        const f = productionStartTimeFixture([{ ...record, machine: 'A' }], ['A']);
        let time = '07:00';
        if (scenario === 'no selection') f.inputs[0].checked = false;
        if (scenario === 'loading') f.context.dailyRecordsSync = { isReady: () => false };
        if (scenario === 'missing sync') f.context.dailyRecordsSync = null;
        if (scenario === 'stale version') f.context.canWriteAppData = () => false;
        if (scenario === 'other view') f.context.dayViewContainer.style.display = 'none';
        if (scenario === 'invalid time') time = '25:00';
        if (scenario === 'stale date') f.context.dailyStartTimeSelectionDate = '2026-10-18';
        if (scenario === 'disabled target') f.inputs[0].disabled = true;
        if (scenario === 'unknown target') f.inputs[0].value = 'custom';
        const before = JSON.stringify(f.context.records);
        assert.equal(f.context.setSelectedDayStartTime(time), false);
        assert.equal(JSON.stringify(f.context.records), before);
        assert.equal(f.saved.length, 0);
        assert.equal(f.getRenders(), 0);
    });
}

function pressStartTimeFixture(data, options = {}) {
    const saved = [];
    let renders = 0;
    const f = fixture('1f-app.js', 'function setDayStartTime(', '// Update record', {
        records: structuredClone(data),
        database: {}, recordsSync: { isReady: () => true },
        dayViewContainer: { style: { display: 'block' } },
        mark1fRecordUpdated(item, updatedAt) { item._syncUpdatedAt = updatedAt; },
        saveRecords() { saved.push(structuredClone(f.context.records)); },
        renderRecords() { renders++; },
        ...options
    });
    return { ...f, saved, getRenders: () => renders };
}

for (const time of ['07:00', '08:30']) {
    test(`press preset ${time} changes all named machines including new R5 on the selected day in one save`, () => {
        const data = [
            ...['R1', 'R2', 'R3', 'R4'].map((machine, index) => ({
                ...record, id: index + 1, machine, count: 100 + index, notes: `note ${index}`
            })),
            { ...record, id: 5, machine: 'R5' },
            { ...record, id: 6, date: '2026-10-18' },
            { ...record, id: 7, date: '2026-10-20' }
        ];
        const f = pressStartTimeFixture(data);
        assert.equal(f.context.setDayStartTime(time), true);
        assert.equal(f.saved.length, 1);
        assert.equal(f.getRenders(), 1);
        f.saved[0].forEach((item, index) => {
            if (index < 5) {
                const { startTime, _syncUpdatedAt, ...rest } = item;
                const { startTime: originalStartTime, ...originalRest } = data[index];
                assert.equal(startTime, time);
                assert.ok(_syncUpdatedAt > 0);
                assert.deepEqual(rest, originalRest);
            } else {
                assert.deepEqual(item, data[index]);
            }
        });
        assert.equal(new Set(f.saved[0].slice(0, 5).map(item => item._syncUpdatedAt)).size, 1);
        assert.equal(f.context.setDayStartTime(time), false);
        assert.equal(f.saved.length, 1, 'Repeated clicks must not save unchanged records');
    });
}

test('press preset preserves the timestamp of rows already using the selected time', () => {
    const f = pressStartTimeFixture([
        { ...record, startTime: '07:00', _syncUpdatedAt: 123 },
        { ...record, id: 2, machine: 'R2', _syncUpdatedAt: 456 }
    ]);
    f.context.setDayStartTime('07:00');
    assert.equal(f.saved[0][0]._syncUpdatedAt, 123);
    assert.equal(f.saved[0][1].startTime, '07:00');
    assert.ok(f.saved[0][1]._syncUpdatedAt > 456);
    assert.equal(f.saved[0].length, 2, 'Presets must not create missing machine rows');
});

test('press presets support free and added machines even without R1-R4', () => {
    const data = [
        { ...record, machine: 'R5' }, { ...record, id: 2, machine: 'R10' },
        { ...record, id: 3, machine: text }, { ...record, id: 4, machine: '   ' }
    ];
    const f = pressStartTimeFixture(data);
    assert.equal(f.context.setDayStartTime('07:00'), true);
    assert.deepEqual(f.saved[0].slice(0, 3).map(item => item.startTime), ['07:00', '07:00', '07:00']);
    assert.deepEqual(f.saved[0][3], data[3]);
});

test('press preset buttons enable when only an added machine is displayed', () => {
    const buttons = [{ disabled: true }, { disabled: true }];
    const f = fixture('1f-app.js', 'function renderRecords()', '// Trash Management Logic', {
        records: [{ ...record, machine: 'R5' }], startTimePresetButtons: buttons,
        database: {}, recordsSync: { isReady: () => true }
    });
    f.context.renderRecords();
    assert.ok(buttons.every(button => !button.disabled));
});

for (const scenario of ['loading', 'missing sync', 'stale version', 'monthly view', 'invalid time', 'no target rows']) {
    test(`press preset does not edit or save during ${scenario}`, () => {
        const f = pressStartTimeFixture([record]);
        let time = '07:00';
        if (scenario === 'loading') f.context.recordsSync = { isReady: () => false };
        if (scenario === 'missing sync') f.context.recordsSync = null;
        if (scenario === 'stale version') f.context.SharedSync.canWrite = () => false;
        if (scenario === 'monthly view') f.context.dayViewContainer.style.display = 'none';
        if (scenario === 'invalid time') time = '25:00';
        if (scenario === 'no target rows') f.context.records[0].machine = '   ';
        const before = JSON.stringify(f.context.records);
        assert.equal(f.context.setDayStartTime(time), false);
        assert.equal(JSON.stringify(f.context.records), before);
        assert.equal(f.saved.length, 0);
        assert.equal(f.getRenders(), 0);
    });
}

test('rendering legacy project column colors does not edit or save the board', () => {
    const board = { id: 'board', name: 'Project', columns: [{ id: 'column', title: '', tasks: [] }] };
    const before = JSON.stringify(board);
    let saves = 0;
    const f = fixture('app.js', 'function renderBoard(', 'function formatDateShort(', {
        getCurrentBoard: () => board, currentAssigneeFilter: 'all', addColumn() {},
        saveBoardsToFirebase() { saves++; }
    });
    f.context.renderBoard();
    assert.equal(JSON.stringify(board), before);
    assert.equal(saves, 0);
    assert.match(f.elements.get('kanban-board-container').children[0].className, /col-color-0/);
});

test('blurring an unchanged project column title does not update timestamps or save', () => {
    const column = { id: 'column', title: 'Same', _syncUpdatedAt: 100 };
    let saves = 0;
    let updates = 0;
    const f = fixture('app.js', 'window.onColumnTitleChange =', '// ---- Task CRUD ----', {
        getCurrentBoard: () => ({ columns: [column] }),
        markProjectItemUpdated() { updates++; },
        saveBoardsToFirebase() { saves++; }
    });
    f.context.window.onColumnTitleChange('column', 'Same');
    assert.equal(saves, 0);
    assert.equal(updates, 0);
    f.context.window.onColumnTitleChange('column', 'Changed');
    assert.equal(column.title, 'Changed');
    assert.equal(saves, 1);
    assert.equal(updates, 1);
});

for (const [name, end, data, sync] of [
    ['saveSliverData', 'function renderSliver(', 'sliverAllData', 'sliverDataSync'],
    ['saveHanaponData', 'function renderHanapon(', 'hanaponAllData', 'hanaponDataSync'],
    ['saveSnowsprintData', 'function handleSnowsprintInput(', 'snowsprintAllData', 'snowsprintDataSync'],
    ['saveHanaponBoxData', 'function handleHanaponBoxInput(', 'hanaponBoxAllData', 'hanaponBoxDataSync']
]) test(`${name} distinguishes automatic setup from actual input`, () => {
    const settings = [];
    let histories = 0;
    const f = fixture('app.js', `function ${name}(`, end, {
        [data]: { month: { count: 0 } }, [sync]: { save(value, options) { settings.push(options); } },
        database: {}, canWriteAppData: () => true,
        SLIVER_STORAGE_KEY: 'sliver', HANAPON_STORAGE_KEY: 'hanapon',
        SNOWSPRINT_STORAGE_KEY: 'snow', HANAPON_BOX_STORAGE_KEY: 'box',
        safeLocalStorageSetItem() {}, scheduleDailyBackupRefresh() {},
        normalizeHanaponBoxData: value => value, setTimeout() {},
        triggerHistorySave() { histories++; }
    });
    f.context[name](false);
    assert.equal(settings[0].automatic, true);
    assert.equal(histories, 0);
    f.context[name]();
    assert.equal(settings[1].automatic, false);
    assert.equal(histories, 1);
});

test('HTML encoding preserves empty values, zero and text that resembles an entity', () => {
    const f = fixture('app.js', 'function shiftHandleDrop(', 'function shiftAddMember(');
    assert.equal(f.context.SharedSync.escapeHtml(null), '');
    assert.equal(f.context.SharedSync.escapeHtml(undefined), '');
    assert.equal(f.context.SharedSync.escapeHtml(0), '0');
    assert.equal(f.context.SharedSync.escapeHtml('&quot;'), '&amp;quot;');
    assert.equal(f.context.SharedSync.escapeHtml(text), encoded);
});

test('reordering shift members preserves every manual weekly override', () => {
    const overrides = {
        '2026-10-18': { date: '10/19', early: 'C', late: 'B', normal: 'A', notes: text },
        '2026-10-25': { notes: 'next week' }
    };
    const original = JSON.stringify(overrides);
    let saved;
    let renders = 0;
    const f = fixture('app.js', 'function shiftHandleDrop(', 'function shiftAddMember(', {
        shiftNames: ['A', 'B', 'C'], shiftDraggedIndex: 0, shiftOverrides: overrides,
        shiftSaveAllData() { saved = JSON.stringify(f.context.shiftOverrides); },
        shiftRenderMembers() { renders++; }
    });
    f.context.shiftHandleDrop.call({ dataset: { index: '2' }, classList: { remove() {} } }, {
        preventDefault() {}
    });
    assert.equal(JSON.stringify(f.context.shiftNames), JSON.stringify(['B', 'C', 'A']));
    assert.equal(JSON.stringify(f.context.shiftOverrides), original);
    assert.equal(saved, original);
    assert.equal(renders, 1);
});

test('dropping a shift member in the same position does not save or clear overrides', () => {
    const overrides = { week: { notes: 'keep' } };
    const f = fixture('app.js', 'function shiftHandleDrop(', 'function shiftAddMember(', {
        shiftNames: ['A', 'B'], shiftDraggedIndex: 1, shiftOverrides: overrides,
        shiftSaveAllData() { assert.fail('No save expected'); }, shiftRenderMembers() {}
    });
    f.context.shiftHandleDrop.call({ dataset: { index: '1' }, classList: { remove() {} } }, {
        preventDefault() {}
    });
    assert.equal(f.context.shiftOverrides, overrides);
});

test('applying the reordered shift rotation also keeps manual weekly fields', () => {
    const monday = new Date(2026, 9, 19);
    const overrides = { week: { early: 'C', late: 'A', notes: text } };
    let saves = 0;
    const f = fixture('app.js', 'function shiftUpdateRotationOrder()', 'let shiftDraggedElement', {
        shiftNames: ['B', 'C', 'A'], shiftRotationOrder: ['A', 'B', 'C'],
        shiftOverrides: overrides, shiftBaseDate: new Date(2026, 0, 1),
        shiftGetMondayOfCurrentWeek: () => monday,
        confirm: () => true, alert() {}, shiftGenerateTable() {},
        shiftSaveAllData() { saves++; }
    });
    f.context.shiftUpdateRotationOrder();
    assert.equal(f.context.shiftOverrides, overrides);
    assert.equal(JSON.stringify(f.context.shiftRotationOrder), JSON.stringify(['B', 'C', 'A']));
    assert.equal(saves, 1);
});

test('product dropdown keeps special characters out of the inline JavaScript', () => {
    const f = fixture('app.js', 'function renderComboboxDropdownItems(', 'window.selectComboboxItem', {
        VALID_PRODUCTS: [text]
    });
    const dropdown = element();
    f.context.renderComboboxDropdownItems(dropdown, '', { value: text, getAttribute: () => null }, 1);
    assert.ok(dropdown.innerHTML.includes(`data-product="${encoded}"`));
    assert.ok(dropdown.innerHTML.includes('selectComboboxItem(event, this.dataset.product, this, 1)'));
    assert.ok(!dropdown.innerHTML.includes('<tag>'));
});

test('press monthly totals include default and free machine names without collisions', () => {
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record', {
        records: [
            { ...record, machine: 'R1', count: 10 },
            { ...record, machine: 'R5', count: 20 },
            { ...record, date: '2026-10-20', machine: 'R5', count: 30 },
            { ...record, machine: '__proto__', count: 4 },
            { ...record, machine: 'constructor', count: 5 },
            { ...record, machine: text, count: 1 },
            { ...record, machine: 'idle machine', count: 0 },
            { ...record, date: '2026-09-19', machine: 'other month', count: 99 }
        ]
    });
    f.context.renderMonthlyRecords();
    const machines = f.document.getElementById('monthly-machine-list').innerHTML;
    for (const name of ['R1', 'R2', 'R3', 'R4', 'R5', '__proto__', 'constructor', 'idle machine']) {
        assert.ok(machines.includes(`>${name}</span>`), name);
    }
    assert.ok(machines.includes('>50</div>'));
    assert.ok(machines.includes('2日 / 平均 25'));
    assert.ok(machines.includes(`>${encoded}</span>`));
    assert.ok(!machines.includes('other month'));
    assert.ok(f.document.getElementById('monthly-stats-overview-1f').innerHTML.includes('>70</div>'));
    assert.ok(f.document.getElementById('monthly-daily-list-1f').innerHTML.includes(`>${encoded}</span>`));
    assert.ok(!machines.includes('machine-badge-a"'));
});

test('press monthly view displays the specified type and start date only for R1-R4', () => {
    const data = [
        { ...record, machine: 'R1', count: 10 },
        { ...record, machine: 'R5', count: 20 },
        { ...record, machine: '__proto__', count: 4 }
    ];
    const before = structuredClone(data);
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record', {
        records: data, saveRecords() { assert.fail('Machine details must not save records'); }
    });
    f.context.renderMonthlyRecords();
    const items = f.document.getElementById('monthly-machine-list').innerHTML.split('<div class="monthly-machine-item">').slice(1);
    const expected = [
        ['R1', 'シボ', '2016.10.3'], ['R2', 'シボ', '2018.11.19'],
        ['R3', 'シボ＆碁石', '2021.9.2'], ['R4', 'シボ＆ノーマル', '2024.10.2']
    ];
    for (const [index, [machine, type, start]] of expected.entries()) {
        assert.ok(items[index].includes(`>${machine}</span>`));
        assert.ok(items[index].includes(`class="monthly-machine-type">type ${type}</div>`));
        assert.ok(items[index].includes(`class="monthly-machine-start">${start}~稼働</div>`));
        assert.ok(items[index].indexOf('monthly-machine-details') < items[index].indexOf('stats-data'));
    }
    for (const item of items.slice(4)) assert.ok(!item.includes('monthly-machine-details'));
    assert.deepEqual(f.context.records, before);
});

test('press long-term totals cover the selected calendar year and all years for R1-R4 only', () => {
    const data = [
        { ...record, date: '2025-12-31', machine: 'R1', count: 100 },
        { ...record, date: '2026-01-01', machine: 'R1', count: 200 },
        { ...record, date: '2026-06-15', machine: 'R2', count: 300 },
        { ...record, machine: 'R3', count: 400 },
        { ...record, date: '2026-12-31', machine: 'R4', count: 500 },
        { ...record, date: '2027-01-01', machine: 'R1', count: 600 },
        { ...record, machine: 'R5', count: 9000 },
        { ...record, machine: 'R10', count: 500 },
        { ...record, date: '2025-12-31', machine: 'custom', count: 7000 }
    ];
    const before = structuredClone(data);
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record', {
        records: data, saveRecords() { assert.fail('Rendering totals must not save records'); }
    });
    for (const [date, annual] of [
        ['2026-10-19', '1,400'], ['2026-02-01', '1,400'], ['2027-06-01', '600'], ['2025-12-31', '100']
    ]) {
        f.context.currentDate = date;
        f.context.renderMonthlyRecords();
        const html = f.document.getElementById('monthly-stats-overview-1f').innerHTML;
        assert.ok(html.includes(`id="annual-total-count-1f">${annual}</div>`), date);
        assert.ok(html.includes('id="all-time-total-count-1f">2,100</div>'), date);
        assert.ok(html.includes(`${date.substring(0, 4)}年`));
        assert.ok(html.indexOf('月平均/日') < html.indexOf('annual-total-label-1f'));
        assert.ok(html.indexOf('annual-total-count-1f') < html.indexOf('all-time-total-count-1f'));
        const machines = f.document.getElementById('monthly-machine-list').innerHTML;
        for (const [machine, count] of [['r1', '900'], ['r2', '300'], ['r3', '400'], ['r4', '500']]) {
            assert.ok(machines.includes(`id="machine-all-time-count-${machine}">${count}</strong>`), date + ' ' + machine);
        }
        assert.ok(!machines.includes('id="machine-all-time-count-r5"'));
    }
    assert.deepEqual(f.context.records, before);
});

test('press long-term totals include leap day and both calendar-year boundaries', () => {
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record', {
        currentDate: '2024-06-01', records: [
            { ...record, date: '2023-12-31', machine: 'R1', count: 7 },
            { ...record, date: '2024-01-01', machine: 'R1', count: 11 },
            { ...record, date: '2024-02-29', machine: 'R2', count: 13 },
            { ...record, date: '2024-12-31', machine: 'R4', count: 17 },
            { ...record, date: '2025-01-01', machine: 'R3', count: 19 }
        ]
    });
    f.context.renderMonthlyRecords();
    const html = f.document.getElementById('monthly-stats-overview-1f').innerHTML;
    assert.ok(html.includes('id="annual-total-count-1f">41</div>'));
    assert.ok(html.includes('id="all-time-total-count-1f">67</div>'));
});

test('press long-term totals accept numeric stored counts and ignore invalid or undated entries without editing data', () => {
    const data = [
        { ...record, machine: 'R1', count: 5 },
        { ...record, date: '2026-09-01', machine: 'R2', count: '20' },
        { ...record, date: '2025-01-01', machine: 'R3', count: '12' },
        { ...record, date: '2026-01-01', machine: 'R4', count: -9 },
        ...[undefined, null, '', NaN, Infinity, 'invalid'].map(count => ({ ...record, date: '2026-09-02', count })),
        { ...record, date: undefined, count: 999 }, { ...record, date: '', count: 999 }
    ];
    const before = structuredClone(data);
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record', { records: data });
    f.context.renderMonthlyRecords();
    const html = f.document.getElementById('monthly-stats-overview-1f').innerHTML;
    assert.ok(html.includes('id="annual-total-count-1f">25</div>'));
    assert.ok(html.includes('id="all-time-total-count-1f">37</div>'));
    const machines = f.document.getElementById('monthly-machine-list').innerHTML;
    for (const [machine, count] of [['r1', '5'], ['r2', '20'], ['r3', '12'], ['r4', '0']]) {
        assert.ok(machines.includes(`id="machine-all-time-count-${machine}">${count}</strong>`));
    }
    assert.deepEqual(f.context.records, before);
});

test('press monthly view still renders all four default machines with no records', () => {
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record');
    f.context.renderMonthlyRecords();
    assert.equal((f.document.getElementById('monthly-machine-list').innerHTML.match(/monthly-machine-item/g) || []).length, 4);
    assert.ok(f.document.getElementById('monthly-daily-list-1f').innerHTML.includes('colspan'));
    const html = f.document.getElementById('monthly-stats-overview-1f').innerHTML;
    assert.ok(html.includes('id="annual-total-count-1f">0</div>'));
    assert.ok(html.includes('id="all-time-total-count-1f">0</div>'));
    for (const machine of ['r1', 'r2', 'r3', 'r4']) {
        assert.ok(f.document.getElementById('monthly-machine-list').innerHTML.includes(`id="machine-all-time-count-${machine}">0</strong>`));
    }
});

test('press per-machine all-time totals include months with no current-month records and format large counts', () => {
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record', {
        records: [
            { ...record, date: '2020-01-01', machine: 'R1', count: 1234567890123 },
            { ...record, date: '2027-12-31', machine: 'R1', count: 777 },
            { ...record, date: '2024-02-29', machine: 'R4', count: 50 }
        ]
    });
    f.context.renderMonthlyRecords();
    const machines = f.document.getElementById('monthly-machine-list').innerHTML;
    assert.ok(machines.includes('id="machine-all-time-count-r1">1,234,567,890,900</strong>'));
    assert.ok(machines.includes('id="machine-all-time-count-r2">0</strong>'));
    assert.ok(machines.includes('id="machine-all-time-count-r4">50</strong>'));
    assert.ok(machines.includes('0日 / 平均 0'));
});

test('press daily machine stats show the same read-only all-time totals across calendar changes', () => {
    const data = [
        { ...record, date: '2025-01-01', machine: 'R1', count: 100 },
        { ...record, machine: 'R1', count: 200 },
        { ...record, machine: 'R2', count: 300 },
        { ...record, date: '2027-01-01', machine: 'R3', count: 400 },
        { ...record, date: '2025-12-31', machine: 'R4', count: 500 },
        { ...record, machine: 'R5', count: 9000 }
    ];
    const before = structuredClone(data);
    const f = fixture('1f-app.js', 'function calculateAndDisplayStats()', '// Reset row', {
        records: data, dayTotalEl: null, grandTotalDisplayEl: null,
        monthlyGrandTotalEl: null, avgDurationEl: null,
        saveRecords() { assert.fail('Displaying all-time totals must not save records'); }
    });
    for (const date of ['2026-10-19', '2025-12-31', '2028-06-01']) {
        f.context.currentDate = date;
        f.context.calculateAndDisplayStats();
        const html = f.document.getElementById('machine-stats-grid-1f').innerHTML;
        for (const [machine, count] of [['r1', '300'], ['r2', '300'], ['r3', '400'], ['r4', '500']]) {
            assert.ok(html.includes(`id="daily-machine-all-time-count-${machine}">${count}</strong>`), date + ' ' + machine);
        }
        assert.equal((html.match(/全期間合計/g) || []).length, 4);
        assert.ok(!html.includes('daily-machine-all-time-count-r5'));
    }
    assert.deepEqual(f.context.records, before);
});

for (const file of ['app.js', '1f-app.js']) {
    test(`${file} daily form preserves literal quotes and markup in text`, () => {
        const f = fixture(file, 'function renderRecords()', '// Trash Management Logic', {
            records: [{ ...record, machine: text }]
        });
        f.context.renderRecords();
        const html = f.context.recordsList.children[0].innerHTML;
        assert.ok(html.includes(`>${encoded}</span>`));
        if (file === 'app.js') assert.ok(html.includes(`value="${encoded}"`));
        assert.ok(!html.includes('<tag>'));
        assert.equal(f.context.records[0].product, text);
    });
}

test('inspection text inputs and tooltips preserve quotes, ampersands and brackets', () => {
    const f = fixture('1f-kenpin-app.js', 'function renderRecords()', 'function createRecordFromBlank(', {
        records: [record]
    });
    f.context.renderRecords();
    const html = f.document.getElementById('records-list-kenpin').children[0].innerHTML;
    assert.equal((html.match(new RegExp('value="' + encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length, 4);
    assert.ok(html.includes(`title="${encoded}"`));
    assert.ok(!html.includes('<tag>'));
});

test('cutting daily form preserves product, worker and literal textarea closing tags', () => {
    const f = fixture('saidan-app.js', 'function renderRecords()', '// Trash management', { records: [record] });
    f.context.renderRecords();
    const html = f.document.getElementById('saidan-items-container').children[0].innerHTML;
    assert.ok(html.includes(`value="${encoded}"`));
    assert.ok(html.includes(`${encoded}\n&lt;/textarea&gt;</textarea>`));
    assert.equal((html.match(/<\/textarea>/g) || []).length, 1);
});

test('2F monthly product totals and details display literal text including object-like names', () => {
    const f = fixture('app.js', 'function renderMonthlyRecords()', '// Handle Quick Entry', {
        records: [record, { ...record, product: '__proto__', count: 3 }]
    });
    f.context.renderMonthlyRecords();
    const totals = f.document.getElementById('monthly-product-totals').innerHTML;
    assert.ok(totals.includes(`>${encoded}</span>`));
    assert.ok(totals.includes('>__proto__</span>'));
    assert.ok(f.document.getElementById('monthly-full-detailed-list').innerHTML.includes(`>${encoded}</td>`));
});

test('cutting monthly product, worker and note use text instead of injected HTML or JavaScript', () => {
    const f = fixture('saidan-app.js', 'function renderMonthlyRecords()', 'function setupMobileMenu(', {
        records: [record, { ...record, product: '__proto__' }]
    });
    f.context.renderMonthlyRecords();
    const totals = f.document.getElementById('saidan-monthly-products-list').innerHTML;
    const details = f.document.getElementById('saidan-monthly-daily-list').innerHTML;
    assert.ok(totals.includes(`title="${encoded}"`));
    assert.ok(totals.includes('>__proto__</div>'));
    assert.ok(details.includes(`>${encoded}</td>`));
    assert.ok(details.includes(`data-note="${encoded}\n&lt;/textarea&gt;"`));
    assert.ok(details.includes('onclick="openSaidanNoteModal(this.dataset.note)"'));
    assert.ok(!details.includes('<tag>'));
});

for (const file of ['app.js', '1f-app.js', 'saidan-app.js']) {
    test(`${file} deletion list does not interpret saved names as HTML`, () => {
        const end = file === 'app.js' ? '// Helper to update duration' : file === '1f-app.js' ? '// Duration label helper' : 'function deleteRecord(';
        const f = fixture(file, 'function renderTrashList()', end, { records: [{ ...record, machine: text }] });
        f.context.renderTrashList();
        const id = file === 'saidan-app.js' ? 'saidan-trash-list' : 'trash-list-container';
        const html = f.document.getElementById(id).children[0].innerHTML;
        assert.ok(html.includes(`>${encoded}</span>`));
        assert.ok(!html.includes('<tag>'));
    });
}

test('shift names, options and manual fields retain literal special characters after rendering', () => {
    const monday = new Date(2026, 9, 19);
    const weekId = monday.toISOString().split('T')[0];
    const f = fixture('app.js', 'function shiftGenerateTable()', '// ==========================================', {
        shiftNames: [text, 'B'], shiftRotationOrder: [text, 'B'], shiftBaseDate: monday,
        shiftBaseEarlyIndex: 0, shiftGetMondayOfCurrentWeek: () => monday,
        shiftFormatDate: () => '10/19', isJapaneseHoliday: () => false,
        shiftOverrides: { [weekId]: { date: text, early: text, late: 'B', normal: text, notes: text } }
    });
    f.context.shiftGenerateTable();
    const html = f.document.getElementById('shift-tbody').innerHTML;
    assert.ok(html.includes(`<option value="${encoded}" selected>${encoded}</option>`));
    assert.ok(html.includes(`value="${encoded}" oninput="shiftSaveRowState`));
    assert.ok(!html.includes('<tag>'));
});

test('shift member chips render user-entered names as text', () => {
    const f = fixture('app.js', 'function shiftRenderMembers()', 'function shiftSetupDragAndDrop(', {
        shiftNames: [text], shiftSetupDragAndDrop() {}, shiftGenerateTable() {}
    });
    f.context.shiftRenderMembers();
    const html = f.document.getElementById('shift-member-list').innerHTML;
    assert.ok(html.includes(encoded));
    assert.ok(!html.includes('<tag>'));
});
