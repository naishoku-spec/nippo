'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('app.js', 'utf8');

function section(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Missing source section: ${startMarker}`);
    return source.slice(start, end);
}

function fixture() {
    const elements = new Map();
    const timers = new Map();
    let nextTimer = 0;
    let context;

    function element() {
        const listeners = new Map();
        const classes = new Set();
        let html = '';
        return {
            value: '', textContent: '', style: {}, children: [], htmlWrites: 0,
            get innerHTML() { return html; },
            set innerHTML(value) { html = value; this.htmlWrites++; },
            classList: {
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                contains: name => classes.has(name),
                toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
            },
            addEventListener(type, listener) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(listener);
            },
            emit(type, properties = {}) {
                const event = { target: this, preventDefault() {}, stopPropagation() {}, ...properties };
                for (const listener of listeners.get(type) || []) listener(event);
            },
            appendChild(child) { this.children.push(child); },
            closest() { return null; },
            focus() {
                document.activeElement = this;
                if (this.onFocus) this.onFocus();
            },
            getBoundingClientRect() { return { left: 200, right: 300, top: 200 }; }
        };
    }

    const document = element();
    document.getElementById = id => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    document.querySelectorAll = () => [];
    document.createElement = element;
    document.activeElement = element();
    document.getElementById('snSizeTabs').children.push(element());

    context = vm.createContext({
        document,
        window: { innerWidth: 1200, innerHeight: 800 },
        console,
        setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
        snCommentCurrentCell: null,
        snCommentFocusTimer: null,
        snCommentListSignature: null,
        snowsprintCurrentYear: 2026,
        snowsprintCurrentMonth: 10,
        snowsprintActiveProduct: 0,
        snowsprintActiveSize: 0,
        snowsprintAllData: {},
        snowsprintConfigNeedsSync: false,
        snowsprintDataSync: null,
        snowsprintViewContainer: { style: { display: 'block' } },
        SNOWSPRINT_STORAGE_KEY: 'test-only',
        SNOWSPRINT_DB_PATH: 'test-only',
        SNOWSPRINT_INITIAL_DATA: {},
        SNOWSPRINT_TAB_CONFIG: [{ sizes: [{ category: 'sn2', config: [] }, { category: 'sn2', config: [] }] }],
        database: {},
        safeLocalStorageGetItem: () => null,
        safeLocalStorageSetItem() {},
        scheduleDailyBackupRefresh() {},
        ensureSnowsprintConfiguredItems: () => false,
        ensureSnowsprintMonth() {},
        propagateSnowSprintCarryover() {},
        renderSnowsprintSizeTabs() {},
        renderSnowsprintGeneric() { context.tableRenders++; },
        tableRenders: 0,
        comments: [],
        getSnowsprintCellComments: () => context.comments,
        getSnowsprintCommentCellLabel: () => '10/1 arrival',
        submitSnowsprintComment() {},
        SharedSync: {
            canRenderView(selector, meta = {}) {
                return meta.force === true || !document.activeElement?.closest(selector);
            },
            createPathSync(options) {
                context.remoteRefresh = options.onRemote;
                return { save() {} };
            }
        }
    });
    context.window.SharedSync = context.SharedSync;

    const code = [
        section('function initSnowsprint() {', 'function ensureSnowsprintMonth'),
        section('function setupSnowsprintMonthSelector() {', 'function saveSnowsprintData'),
        section('function switchSnowsprintProduct(', 'function renderSnowsprint() {'),
        section('function renderSnowsprint() {', 'function escapeHtmlAttr('),
        section('function escapeHtmlAttr(', 'function getSnowsprintCellComments('),
        section('function openSnowsprintComment(', 'function submitSnowsprintComment('),
        section('function renderSnowsprintCommentList() {', '// Wire up comment popup'),
        section('(function initCommentPopup()', '// Finally, start the application')
    ].join('\n');
    vm.runInContext(code, context, { filename: 'app-comment-functions.js' });

    return {
        context, document, elements,
        open() {
            context.openSnowsprintComment(
                { category: 'sn2', type1: 'small', type2: 'metal', field: 'arrival', day: '1' },
                element()
            );
        },
        isOpen: () => elements.get('snCommentPopup').classList.contains('active'),
        runTimers() {
            for (const [id, callback] of Array.from(timers)) {
                timers.delete(id);
                callback();
            }
        }
    };
}

test('table recalculation preserves the open comment and draft', () => {
    const f = fixture();
    f.open();
    f.elements.get('snCommentInput').value = 'unfinished comment';
    f.context.renderSnowsprint();
    assert.equal(f.isOpen(), true);
    assert.equal(f.elements.get('snCommentInput').value, 'unfinished comment');
});

test('remote synchronization refreshes comments without closing the draft', () => {
    const f = fixture();
    f.context.initSnowsprint();
    f.open();
    const input = f.elements.get('snCommentInput');
    input.value = 'unfinished comment';
    f.document.activeElement = input;
    f.context.comments = [{ text: 'remote comment', time: Date.now() }];
    f.context.remoteRefresh();
    assert.equal(f.isOpen(), true);
    assert.equal(input.value, 'unfinished comment');
    assert.match(f.elements.get('snCommentList').innerHTML, /remote comment/);
});

test('repeated synchronization leaves unchanged comments in place', () => {
    const f = fixture();
    f.context.initSnowsprint();
    f.context.comments = [{ text: 'saved comment', time: 1000 }];
    f.open();
    const list = f.elements.get('snCommentList');
    const initialWrites = list.htmlWrites;
    for (let i = 0; i < 3; i++) {
        f.context.comments = [{ text: 'saved comment', time: 1000 }];
        f.context.remoteRefresh();
    }
    assert.equal(list.htmlWrites, initialWrites, 'sync echoes must not replace the comment nodes');

    f.context.comments.push({ text: 'new comment', time: 2000 });
    f.context.remoteRefresh();
    assert.equal(list.htmlWrites, initialWrites + 1);
    assert.match(list.innerHTML, /new comment/);
});

test('clearing the comments updates once and stays stable on sync echoes', () => {
    const f = fixture();
    f.context.initSnowsprint();
    f.context.comments = [{ text: 'saved comment', time: 1000 }];
    f.open();
    const list = f.elements.get('snCommentList');
    f.context.comments = [];
    f.context.remoteRefresh();
    assert.equal(list.innerHTML, '');
    const clearedWrites = list.htmlWrites;
    f.context.remoteRefresh();
    assert.equal(list.htmlWrites, clearedWrites);
});

test('focus-related recalculation leaves the popup open', () => {
    const f = fixture();
    f.open();
    f.elements.get('snCommentInput').onFocus = () => f.context.renderSnowsprint();
    f.runTimers();
    assert.equal(f.isOpen(), true);
});

test('closing cancels the pending textarea focus', () => {
    const f = fixture();
    f.open();
    f.context.closeSnowsprintComment();
    f.runTimers();
    assert.notEqual(f.document.activeElement, f.elements.get('snCommentInput'));
});

test('opening gesture click cannot dismiss; a fresh overlay press can', () => {
    const f = fixture();
    f.open();
    const overlay = f.elements.get('snCommentOverlay');
    overlay.emit('click');
    assert.equal(f.isOpen(), true, 'release of the opening gesture must not close');
    f.document.emit('pointerdown', { target: overlay, button: 0 });
    overlay.emit('click');
    assert.equal(f.isOpen(), false, 'a new outside press must close');
});

test('month and size changes dismiss the previous cell comment', () => {
    const f = fixture();
    f.context.setupSnowsprintMonthSelector();
    f.open();
    f.elements.get('monthSelectSnowsprint').value = '11';
    f.elements.get('monthSelectSnowsprint').emit('change');
    assert.equal(f.isOpen(), false);
    f.open();
    f.context.switchSnowsprintSize(1);
    assert.equal(f.isOpen(), false);
});
