(function (global) {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;
    const START_YEAR_SPAN = 200;
    const LATE_TO_EARLY = 'late-to-early';
    const EARLY_TO_LATE = 'early-to-late';
    const fields = ['date', 'early', 'late', 'normal', 'notes'];
    const hasName = value => typeof value === 'string' && value.trim() !== '';
    const isManual = row => row?.auto_assignment !== true && hasName(row?.early) && hasName(row?.late);
    const normalizeMode = mode => mode === EARLY_TO_LATE ? EARLY_TO_LATE : LATE_TO_EARLY;

    function weekTime(weekId) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return NaN;
        const date = new Date(weekId + 'T00:00:00Z');
        return Number.isFinite(+date) && date.toISOString().slice(0, 10) === weekId ? +date : NaN;
    }

    function weekNumber(weekId) {
        // Existing keys are Sunday UTC in Japan and Monday UTC in some other time zones.
        return Math.floor((weekTime(weekId) + 4 * DAY_MS) / WEEK_MS);
    }

    function offWeekKey(weekId) {
        const date = new Date(weekTime(weekId));
        const day = date.getUTCDay();
        if (day === 0) date.setUTCDate(date.getUTCDate() + 1);
        else if (day !== 1) return null;
        return date.toISOString().slice(0, 10);
    }

    function isWeekOff(offWeeks, weekId) {
        const key = offWeekKey(weekId);
        return key !== null && offWeeks[key] === true;
    }

    function planWeekOffChange(offWeeks, weekId, off) {
        const key = offWeekKey(weekId);
        if (!key || typeof off !== 'boolean' || (offWeeks[key] === true) === off) return null;
        // Keep an explicit false so concurrent changes to other weeks can still merge.
        return { ...offWeeks, [key]: off };
    }

    function orderedNames(value) {
        return Array.isArray(value) ? [...new Set(value.filter(hasName))] : [];
    }

    function collectRules(rotationRules) {
        const rules = [];
        for (const [key, rule] of Object.entries(rotationRules)) {
            const week = weekNumber(key);
            const order = orderedNames(rule?.order);
            if (Number.isFinite(week) && hasName(rule?.id) && order.length >= 2) {
                rules.push({ week, id: rule.id, order, mode: normalizeMode(rule.mode) });
            }
        }
        return rules.sort((a, b) => b.week - a.week);
    }

    function ruleForWeek(rules, week) {
        return rules.find(candidate => candidate.week <= week);
    }

    function namesAt(order, index, mode = LATE_TO_EARLY) {
        const at = position => order.length ? order[((position % order.length) + order.length) % order.length] : '';
        return { early: at(index), late: at(index + (mode === EARLY_TO_LATE ? -1 : 1)) };
    }

    function create({ members, rotationOrder, baseDate, overrides = {}, rotationRules = {}, offWeeks = {} }) {
        const configured = orderedNames(rotationOrder);
        const fallbackOrder = configured.length ? configured : orderedNames(members);
        const base = Number(baseDate);
        const skipped = new Set(Object.keys(offWeeks).filter(key => offWeeks[key] === true).map(weekNumber).filter(Number.isFinite));
        const rules = collectRules(rotationRules);

        return function assignmentsFor(weekId) {
            const week = weekNumber(weekId);
            const rule = ruleForWeek(rules, week);
            const ruleId = rule?.id ?? null;
            if (skipped.has(week)) return { early: '', late: '', ruleId, off: true };
            const saved = overrides[weekId];
            // A newly applied order supersedes old assignments in its range without deleting them.
            if (isManual(saved) && (!rule || saved.rotation_rule_id === ruleId)) {
                return { early: saved.early, late: saved.late, ruleId };
            }

            const order = rule?.order ?? fallbackOrder;
            const offset = rule ? week - rule.week : Math.round((weekTime(weekId) - base) / WEEK_MS);
            let index = Number.isFinite(offset) ? offset : 0;
            for (const skippedWeek of skipped) {
                if (skippedWeek < week && (!rule || skippedWeek >= rule.week)) index--;
            }
            return { ...namesAt(order, index, rule?.mode), ruleId };
        };
    }

    function mondayOf(date) {
        const monday = new Date(date);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        return monday;
    }

    function localDate(date) {
        return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
    }

    function startWeekRange(now) {
        const first = mondayOf(now);
        const last = new Date(first);
        last.setFullYear(last.getFullYear() + START_YEAR_SPAN);
        return { first, last };
    }

    function setupStartCalendar(input, now = new Date()) {
        if (!input) return null;
        const { first, last } = startWeekRange(now);
        const minDate = localDate(first);
        const maxDate = localDate(last);
        const picker = input._flatpickr;
        if (input.dataset.currentWeek !== minDate) {
            input.min = minDate;
            input.max = maxDate;
            input.dataset.currentWeek = minDate;
            if (picker) {
                picker.set('minDate', minDate);
                picker.set('maxDate', maxDate);
            }
            if (input.value && !selectStartWeek(input.value, now)) {
                if (picker) picker.clear(false);
                else input.value = '';
            }
        }
        if (picker || typeof global.flatpickr !== 'function') return picker ?? null;
        return global.flatpickr(input, {
            dateFormat: 'Y-m-d',
            locale: { ...global.flatpickr.l10ns?.ja, firstDayOfWeek: 1 },
            disableMobile: true,
            minDate,
            maxDate,
            onReady: (dates, value, calendar) => calendar.calendarContainer.classList.add('shift-start-calendar'),
            onOpen: () => setupStartCalendar(input)
        });
    }

    function selectStartWeek(value, now = new Date()) {
        if (!Number.isFinite(weekTime(value))) return null;
        const day = new Date(value + 'T00:00:00');
        const { first, last } = startWeekRange(now);
        if (!Number.isFinite(+day) || day < first || day > last) return null;
        const monday = mondayOf(day);
        return { date: localDate(monday), weekId: monday.toISOString().slice(0, 10) };
    }

    function setupModePicker(input, getRotationRules) {
        const form = input?.form;
        const radios = form?.elements.namedItem('shift-rotation-mode');
        if (!radios) return;

        const restoreMode = () => {
            if (form.dataset.rotationModeChanged === 'true') return;
            const now = new Date();
            const weekId = selectStartWeek(input.value, now)?.weekId ?? mondayOf(now).toISOString().slice(0, 10);
            const rule = ruleForWeek(collectRules(getRotationRules()), weekNumber(weekId));
            radios.value = rule?.mode ?? LATE_TO_EARLY;
        };
        if (form.dataset.rotationModeBound !== 'true') {
            form.addEventListener('change', event => {
                if (event.target.name === 'shift-rotation-mode') form.dataset.rotationModeChanged = 'true';
                else if (event.target === input) restoreMode();
            });
            form.dataset.rotationModeBound = 'true';
        }
        restoreMode();
    }

    function planOrderChange({ weekId, members, rotationRules = {}, mode: requestedMode }) {
        const week = weekNumber(weekId);
        const order = orderedNames(members);
        if (!Number.isFinite(week) || order.length < 2) return null;
        const mode = normalizeMode(requestedMode);
        const rules = Object.fromEntries(Object.entries(rotationRules).filter(([key]) => !(weekNumber(key) >= week)));
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        rules[weekId] = { id, order, mode };
        return { rules, mode, first: namesAt(order, 0, mode) };
    }

    function readEdit(row, previous, field, ruleId = null) {
        if (!fields.includes(field)) return null;
        const values = Object.fromEntries(Array.from(row.querySelectorAll('[data-shift-field]'),
            input => [input.dataset.shiftField, input.value]));
        if (typeof values[field] !== 'string') return null;
        const next = { ...values, ...previous, [field]: values[field] };
        if (field === 'early' || field === 'late') {
            if (!hasName(values.early) || !hasName(values.late)) return null;
            next.early = values.early;
            next.late = values.late;
            next.auto_assignment = false;
            if (ruleId) next.rotation_rule_id = ruleId;
            else delete next.rotation_rule_id;
        } else if (!isManual(previous)) {
            // Keep the old row shape for older clients without freezing the calculated names.
            next.auto_assignment = true;
        }
        return next;
    }

    const api = { create, setupStartCalendar, selectStartWeek, setupModePicker, planOrderChange, isWeekOff, planWeekOffChange, readEdit };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else global.ShiftRotation = api;
})(globalThis);
