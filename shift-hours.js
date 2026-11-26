(function (global) {
    'use strict';

    const shifts = { early: '早番', middle: '中番', late: '遅番' };
    const groups = { work: '就業時間', break: '昼休憩' };
    const defaults = {
        work: {
            early: { start: '07:00', end: '16:00' },
            middle: { start: '08:30', end: '17:30' },
            late: { start: '10:30', end: '19:30' }
        },
        break: {
            early: { start: '11:30', end: '12:30' },
            middle: { start: '12:30', end: '13:30' },
            late: { start: '', end: '' }
        }
    };

    function defaultTime(group, shift, edge) {
        if (!Object.hasOwn(groups, group) || !Object.hasOwn(shifts, shift) || (edge !== 'start' && edge !== 'end')) return undefined;
        return defaults[group][shift][edge];
    }

    function validTime(value, fallback) {
        return typeof value === 'string' && (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || (fallback === '' && value === ''));
    }

    function getTime(settings, group, shift, edge) {
        const fallback = defaultTime(group, shift, edge);
        if (fallback === undefined) return undefined;
        const saved = settings?.[group]?.[shift]?.[edge];
        return validTime(saved, fallback) ? saved : fallback;
    }

    function planChange(settings, group, shift, edge, value) {
        const fallback = defaultTime(group, shift, edge);
        if (fallback === undefined || !validTime(value, fallback) || value === getTime(settings, group, shift, edge)) return null;
        return {
            ...settings,
            [group]: {
                ...settings?.[group],
                [shift]: { ...settings?.[group]?.[shift], [edge]: value }
            }
        };
    }

    function renderEditors({ getSettings, canEdit, onChange }) {
        const settings = getSettings();
        for (const [group, title] of Object.entries(groups)) {
            const editor = global.document.getElementById(`shift-${group}-hours`);
            if (!editor) continue;
            if (editor.dataset.hourEditorReady !== 'true') {
                editor.innerHTML = Object.entries(shifts).map(([shift, name]) => `
                    <div class="shift-hour-row">
                        <span class="shift-hour-label" data-shift-kind="${shift}">${name}</span>
                        <div class="shift-hour-range">
                            <input type="time" class="shift-hour-input" step="60" data-shift-kind="${shift}" data-hour-edge="start" aria-label="${name}の${title} 開始">
                            <span aria-hidden="true">〜</span>
                            <input type="time" class="shift-hour-input" step="60" data-shift-kind="${shift}" data-hour-edge="end" aria-label="${name}の${title} 終了">
                        </div>
                    </div>
                `).join('');
                editor.addEventListener('change', event => {
                    const input = event.target;
                    if (input.type !== 'time') return;
                    const { shiftKind, hourEdge } = input.dataset;
                    const next = planChange(getSettings(), group, shiftKind, hourEdge, input.value);
                    if (next) {
                        if (canEdit()) onChange(next);
                        else global.alert('シフト表の読み込み・保存が終わってから、もう一度お試しください。');
                    }
                    const current = getTime(getSettings(), group, shiftKind, hourEdge);
                    if (current !== undefined && input.value !== current) input.value = current;
                });
                editor.dataset.hourEditorReady = 'true';
            }
            for (const input of editor.querySelectorAll('.shift-hour-input')) {
                const value = getTime(settings, group, input.dataset.shiftKind, input.dataset.hourEdge);
                if (input.value !== value) input.value = value;
            }
        }
    }

    const api = { getTime, planChange, renderEditors };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else global.ShiftHours = api;
})(globalThis);
