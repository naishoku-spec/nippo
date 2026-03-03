// ========== Constants & Configuration ==========
const ROLL_TYPES = ['film', 'plain', 'eog'];
const ROLL_LABELS = { film: 'フィルム', plain: '無地', eog: 'EOG' };
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const STORAGE_KEY = 'rollInventoryData';
const LOW_STOCK_THRESHOLD = 5;

// Holiday list (Excel serial dates converted to Date objects)
const HOLIDAYS_RAW = [
    { name: '元旦', serial: 45658 },
    { name: '休み', serial: 45659 },
    { name: '休み', serial: 45660 },
    { name: '休み', serial: 45661 },
    { name: '成人の日', serial: 45670 },
    { name: '建国記念日', serial: 45699 },
    { name: '天皇誕生日', serial: 45711 },
    { name: '振替休日', serial: 45712 },
    { name: '春分の日', serial: 45736 },
    { name: '昭和の日', serial: 45776 },
    { name: '憲法記念日', serial: 45780 },
    { name: 'みどりの日', serial: 45781 },
    { name: 'こどもの日', serial: 45782 },
    { name: '振替休日', serial: 45783 },
    { name: '海の日', serial: 45859 },
    { name: '山の日', serial: 45880 },
    { name: '休み', serial: 45881 },
    { name: '休み', serial: 45882 },
    { name: '休み', serial: 45883 },
    { name: '休み', serial: 45884 },
    { name: '敬老の日', serial: 45915 },
    { name: '秋分の日', serial: 45923 },
    { name: 'スポーツの日', serial: 45943 },
    { name: '文化の日', serial: 45964 },
    { name: '勤労感謝の日', serial: 45984 },
    { name: '振替休日', serial: 45985 },
    { name: '休み', serial: 46020 },
    { name: '休み', serial: 46021 },
    { name: '休み', serial: 46022 },
    // 2026年祝祭日
    { name: '元旦', serial: 46023 },
    { name: '休み', serial: 46024 },
    { name: '休み', serial: 46025 },
    { name: '休み', serial: 46026 },
    { name: '成人の日', serial: 46035 },
    { name: '建国記念日', serial: 46064 },
    { name: '天皇誕生日', serial: 46076 },
    { name: '春分の日', serial: 46100 },
];

// Convert Excel serial date to JS Date
function serialToDate(serial) {
    // Excel epoch: Jan 1, 1900 = serial 1 (but has leap year bug: Feb 29, 1900)
    const epoch = new Date(1899, 11, 30);
    return new Date(epoch.getTime() + serial * 86400000);
}

// Build holiday lookup: 'YYYY-MM-DD' -> name
const HOLIDAYS = {};
HOLIDAYS_RAW.forEach(h => {
    const d = serialToDate(h.serial);
    const key = dateKey(d);
    HOLIDAYS[key] = h.name;
});

function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// Initial data from Excel (most recent: 2026年3月)
const INITIAL_DATA = {
    '2026-3': {
        film: { carryover: 30 },
        plain: { carryover: 22, days: { 2: { production: 1 }, 3: { production: 1 }, 4: { production: 1 }, 5: { production: 1 }, 6: { production: 1 }, 9: { production: 1 }, 10: { production: 1 }, 11: { production: 1 }, 12: { production: 1 }, 13: { production: 1 } } },
        eog: { carryover: 17, days: { 16: { production: 1 }, 17: { production: 1 }, 18: { production: 1 }, 19: { production: 1 } } }
    },
    '2026-2': {
        film: { carryover: 30 },
        plain: { carryover: 27, days: { 3: { production: 1 }, 4: { production: 1 }, 5: { production: 1 }, 6: { production: 1 }, 7: { production: 1 }, 10: { production: 1 }, 12: { production: 1 }, 13: { production: 1 }, 17: { production: 1 }, 18: { production: 1 }, 19: { production: 1 }, 20: { production: 1 }, 21: { production: 1 }, 24: { production: 1 }, 25: { production: 1 } } },
        eog: { carryover: 17 }
    },
    '2026-1': {
        film: { carryover: 30 },
        plain: { carryover: 28, days: { 6: { production: 1 }, 7: { production: 1 }, 8: { production: 1 }, 9: { production: 1 }, 14: { production: 1 }, 15: { production: 1 }, 16: { production: 1 }, 19: { production: 1 }, 20: { production: 1 }, 21: { production: 1 }, 22: { production: 1 }, 23: { production: 1 }, 26: { production: 1 }, 27: { production: 1 }, 28: { production: 1 }, 29: { production: 1 }, 30: { production: 1 } } },
        eog: { carryover: 17 }
    },
    '2025-12': {
        film: { carryover: 34, days: { 1: { production: 1 }, 2: { production: 1 }, 3: { production: 1 }, 4: { production: 1 } } },
        plain: { carryover: 18, days: { 1: { delivery: 10 } } },
        eog: { carryover: 17 }
    }
};

// ========== State ==========
let currentYear = 2026;
let currentMonth = 3;
let allData = {};

// ========== DOM Elements ==========
const yearSelect = document.getElementById('yearSelect');
const monthSelect = document.getElementById('monthSelect');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const inventoryBody = document.getElementById('inventoryBody');
const inventoryFoot = document.getElementById('inventoryFoot');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const saveStatus = document.getElementById('saveStatus');
const toast = document.getElementById('toast');

// ========== Initialization ==========
function init() {
    loadData();
    setupSelectors();
    renderMonth();
    setupEventListeners();
}

function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            allData = JSON.parse(stored);
        } catch (e) {
            allData = {};
        }
    }
    // Merge initial data (don't overwrite user data)
    Object.keys(INITIAL_DATA).forEach(key => {
        if (!allData[key]) {
            allData[key] = JSON.parse(JSON.stringify(INITIAL_DATA[key]));
        }
    });
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    showToast('保存しました', 'success');
    updateSaveStatus();
}

function updateSaveStatus() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    saveStatus.textContent = `最終保存: ${h}:${m}`;
}

// ========== Selectors ==========
function setupSelectors() {
    // Year options: 2024-2100
    for (let y = 2024; y <= 2100; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
    }
    yearSelect.value = currentYear;

    // Month options: 1-12
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        monthSelect.appendChild(opt);
    }
    monthSelect.value = currentMonth;
}

function setupEventListeners() {
    yearSelect.addEventListener('change', () => {
        currentYear = parseInt(yearSelect.value);
        renderMonth();
    });

    monthSelect.addEventListener('change', () => {
        currentMonth = parseInt(monthSelect.value);
        renderMonth();
    });

    prevMonthBtn.addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 1) { currentMonth = 12; currentYear--; }
        yearSelect.value = currentYear;
        monthSelect.value = currentMonth;
        renderMonth();
    });

    nextMonthBtn.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 12) { currentMonth = 1; currentYear++; }
        yearSelect.value = currentYear;
        monthSelect.value = currentMonth;
        renderMonth();
    });

    saveBtn.addEventListener('click', saveData);

    resetBtn.addEventListener('click', () => {
        if (confirm('この月のデータをリセットしますか？')) {
            const key = `${currentYear}-${currentMonth}`;
            if (INITIAL_DATA[key]) {
                allData[key] = JSON.parse(JSON.stringify(INITIAL_DATA[key]));
            } else {
                delete allData[key];
            }
            saveData();
            renderMonth();
        }
    });
}

// ========== Data Access ==========
function getMonthData(year, month) {
    const key = `${year}-${month}`;
    if (!allData[key]) {
        allData[key] = {
            film: { carryover: 0, days: {} },
            plain: { carryover: 0, days: {} },
            eog: { carryover: 0, days: {} }
        };
    }
    // Ensure days object exists
    ROLL_TYPES.forEach(type => {
        if (!allData[key][type]) allData[key][type] = { carryover: 0, days: {} };
        if (!allData[key][type].days) allData[key][type].days = {};
    });
    return allData[key];
}

function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

// ========== Rendering ==========
function renderMonth() {
    const data = getMonthData(currentYear, currentMonth);
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);

    inventoryBody.innerHTML = '';
    inventoryFoot.innerHTML = '';

    // --- Carryover row ---
    const carryoverRow = document.createElement('tr');
    carryoverRow.className = 'row-carryover';

    let carryoverHtml = '<td>繰越</td>';
    ROLL_TYPES.forEach(type => {
        carryoverHtml += `<td></td><td></td>`;
        carryoverHtml += `<td><input type="number" min="0" class="carryover-input" 
            data-type="${type}" value="${data[type].carryover || 0}" 
            id="carryover-${type}"></td>`;
    });
    carryoverRow.innerHTML = carryoverHtml;
    inventoryBody.appendChild(carryoverRow);

    // Add carryover input listeners
    carryoverRow.querySelectorAll('.carryover-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const type = e.target.dataset.type;
            data[type].carryover = parseInt(e.target.value) || 0;
            recalculate(data, daysInMonth);
            propagateCarryover(currentYear, currentMonth);
            autoSave();
        });
        input.addEventListener('focus', (e) => e.target.select());
    });

    // --- Daily rows ---
    const totals = {};
    ROLL_TYPES.forEach(type => {
        totals[type] = { delivery: 0, production: 0 };
    });

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth - 1, day);
        const dayOfWeek = date.getDay();
        const dayName = DAY_NAMES[dayOfWeek];
        const dKey = dateKey(date);
        const holidayName = HOLIDAYS[dKey];
        const isSunday = dayOfWeek === 0;
        const isSaturday = dayOfWeek === 6;
        const isHoliday = !!holidayName;

        const tr = document.createElement('tr');
        if (isSunday) tr.className = 'row-sunday';
        else if (isHoliday) tr.className = 'row-holiday';
        else if (isSaturday) tr.className = 'row-saturday';

        // Date cell
        let dateLabel = `${currentMonth}/${day}`;
        let dayLabel = '';
        if (isHoliday && !isSunday) {
            dayLabel = `<span class="day-label day-label-holiday">${holidayName}</span>`;
        } else if (isSunday) {
            dayLabel = `<span class="day-label day-label-sun">${dayName}</span>`;
        } else if (isSaturday) {
            dayLabel = `<span class="day-label day-label-sat">${dayName}</span>`;
        } else {
            dayLabel = `<span class="day-label" style="color: var(--text-muted)">${dayName}</span>`;
        }

        let rowHtml = `<td>${dateLabel}${dayLabel}</td>`;

        ROLL_TYPES.forEach(type => {
            const dayData = (data[type].days && data[type].days[day]) || {};
            const delivery = dayData.delivery || '';
            const production = dayData.production || '';

            rowHtml += `<td><input type="number" min="0" data-type="${type}" data-day="${day}" data-field="delivery" value="${delivery}" placeholder="–"></td>`;
            rowHtml += `<td><input type="number" min="0" data-type="${type}" data-day="${day}" data-field="production" value="${production}" placeholder="–"></td>`;
            rowHtml += `<td class="remaining-cell ${type}-remaining" id="remaining-${type}-${day}">–</td>`;

            if (delivery) totals[type].delivery += parseInt(delivery) || 0;
            if (production) totals[type].production += parseInt(production) || 0;
        });

        tr.innerHTML = rowHtml;
        inventoryBody.appendChild(tr);

        // Add input listeners
        tr.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', (e) => {
                const type = e.target.dataset.type;
                const d = parseInt(e.target.dataset.day);
                const field = e.target.dataset.field;
                const val = parseInt(e.target.value) || 0;

                if (!data[type].days) data[type].days = {};
                if (!data[type].days[d]) data[type].days[d] = {};

                if (val > 0) {
                    data[type].days[d][field] = val;
                } else {
                    delete data[type].days[d][field];
                    if (Object.keys(data[type].days[d]).length === 0) {
                        delete data[type].days[d];
                    }
                }

                recalculate(data, daysInMonth);
                propagateCarryover(currentYear, currentMonth);
                autoSave();
            });
            input.addEventListener('focus', (e) => e.target.select());
            // Arrow key navigation
            input.addEventListener('keydown', handleArrowKeys);
        });
    }

    // Calculate and display remaining values
    recalculate(data, daysInMonth);

    // Footer row
    renderFooter(data, daysInMonth);
}

function recalculate(data, daysInMonth) {
    ROLL_TYPES.forEach(type => {
        let remaining = data[type].carryover || 0;
        let totalDelivery = 0;
        let totalProduction = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const dayData = (data[type].days && data[type].days[day]) || {};
            const delivery = dayData.delivery || 0;
            const production = dayData.production || 0;

            remaining = remaining + delivery - production;
            totalDelivery += delivery;
            totalProduction += production;

            const cell = document.getElementById(`remaining-${type}-${day}`);
            if (cell) {
                cell.textContent = remaining;
                cell.classList.toggle('low-stock', remaining <= LOW_STOCK_THRESHOLD && remaining >= 0);
            }
        }

        // Update summary cards
        const carryoverEl = document.getElementById(`${type}Carryover`);
        const currentEl = document.getElementById(`${type}Current`);
        const deliveryTotalEl = document.getElementById(`${type}DeliveryTotal`);
        const productionTotalEl = document.getElementById(`${type}ProductionTotal`);

        if (carryoverEl) carryoverEl.textContent = data[type].carryover || 0;
        if (currentEl) {
            currentEl.textContent = remaining;
            currentEl.classList.toggle('low-stock', remaining <= LOW_STOCK_THRESHOLD && remaining >= 0);
        }
        if (deliveryTotalEl) deliveryTotalEl.textContent = totalDelivery;
        if (productionTotalEl) productionTotalEl.textContent = totalProduction;
    });

    renderFooter(data, daysInMonth);
}

function renderFooter(data, daysInMonth) {
    inventoryFoot.innerHTML = '';
    const tr = document.createElement('tr');

    let totalDeliveries = {};
    let totalProductions = {};
    let lastRemaining = {};

    ROLL_TYPES.forEach(type => {
        let remaining = data[type].carryover || 0;
        let td = 0, tp = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const dayData = (data[type].days && data[type].days[day]) || {};
            const delivery = dayData.delivery || 0;
            const production = dayData.production || 0;
            remaining = remaining + delivery - production;
            td += delivery;
            tp += production;
        }

        totalDeliveries[type] = td;
        totalProductions[type] = tp;
        lastRemaining[type] = remaining;
    });

    let footHtml = '<td>次月繰越</td>';
    ROLL_TYPES.forEach(type => {
        const cls = `foot-${type}`;
        footHtml += `<td class="${cls}">${totalDeliveries[type]}</td>`;
        footHtml += `<td class="${cls}">${totalProductions[type]}</td>`;
        footHtml += `<td class="${cls}" style="font-weight:700">${lastRemaining[type]}</td>`;
    });

    tr.innerHTML = footHtml;
    inventoryFoot.appendChild(tr);
}

// ========== Carryover Propagation ==========
function propagateCarryover(year, month) {
    const currentData = getMonthData(year, month);
    const daysInMonth = getDaysInMonth(year, month);

    // Calculate next month
    let nextYear = year;
    let nextMonth = month + 1;
    if (nextMonth > 12) {
        nextMonth = 1;
        nextYear++;
    }

    const nextKey = `${nextYear}-${nextMonth}`;
    // If we want to automatically create the next month or update it if it exists
    if (!allData[nextKey]) {
        allData[nextKey] = {
            film: { carryover: 0, days: {} },
            plain: { carryover: 0, days: {} },
            eog: { carryover: 0, days: {} }
        };
    }

    ROLL_TYPES.forEach(type => {
        let remaining = currentData[type].carryover || 0;
        for (let day = 1; day <= daysInMonth; day++) {
            const dayData = (currentData[type].days && currentData[type].days[day]) || {};
            remaining = remaining + (dayData.delivery || 0) - (dayData.production || 0);
        }

        // Only update if it's different to avoid unnecessary saves
        if (allData[nextKey][type].carryover !== remaining) {
            allData[nextKey][type].carryover = remaining;
        }
    });
}

// ========== Auto-save (debounced) ==========
let autoSaveTimer = null;
function autoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
        updateSaveStatus();
    }, 1000);
}

// ========== Arrow Key Navigation ==========
function handleArrowKeys(e) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) return;
    if (e.key === 'Tab') return; // Default tab behavior

    const input = e.target;
    const td = input.closest('td');
    const tr = td.closest('tr');
    const tbody = tr.closest('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.rows);
    const rowIndex = rows.indexOf(tr);
    const cells = Array.from(tr.cells);
    const cellIndex = cells.indexOf(td);

    let targetRow = rowIndex;
    let targetCell = cellIndex;

    switch (e.key) {
        case 'ArrowUp':
            targetRow = Math.max(0, rowIndex - 1);
            e.preventDefault();
            break;
        case 'ArrowDown':
            targetRow = Math.min(rows.length - 1, rowIndex + 1);
            e.preventDefault();
            break;
        case 'ArrowLeft':
            // Find previous input cell
            for (let i = cellIndex - 1; i >= 0; i--) {
                if (cells[i].querySelector('input')) {
                    targetCell = i;
                    break;
                }
            }
            e.preventDefault();
            break;
        case 'ArrowRight':
            // Find next input cell
            for (let i = cellIndex + 1; i < cells.length; i++) {
                if (cells[i].querySelector('input')) {
                    targetCell = i;
                    break;
                }
            }
            e.preventDefault();
            break;
    }

    const targetTr = rows[targetRow];
    if (targetTr) {
        const targetTd = targetTr.cells[targetCell];
        if (targetTd) {
            const targetInput = targetTd.querySelector('input');
            if (targetInput) {
                targetInput.focus();
                targetInput.select();
            }
        }
    }
}

// ========== Toast ==========
function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = 'toast' + (type ? ` ${type}` : '');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ========== Start ==========
document.addEventListener('DOMContentLoaded', init);
