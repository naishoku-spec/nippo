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
        records: [],
        recordsList: document.getElementById('records-list'),
        calculateDuration: () => ({ h: 1, m: 0 }),
        calculateDefectRate: () => 0,
        calculateAndDisplayStats() {}, renderTrashList() {},
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

test('press monthly view still renders all four default machines with no records', () => {
    const f = fixture('1f-app.js', 'function renderMonthlyRecords()', '// Add record');
    f.context.renderMonthlyRecords();
    assert.equal((f.document.getElementById('monthly-machine-list').innerHTML.match(/monthly-machine-item/g) || []).length, 4);
    assert.ok(f.document.getElementById('monthly-daily-list-1f').innerHTML.includes('colspan'));
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
