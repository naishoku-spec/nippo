// Firebase Configuration (shared with 2F app)
const firebaseConfig = {
    apiKey: "AIzaSyAz4YDGJDcJ6-e6l5N9-LKin7TbWMb68As",
    authDomain: "nippo-f7e61.firebaseapp.com",
    databaseURL: "https://nippo-f7e61-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "nippo-f7e61",
    storageBucket: "nippo-f7e61.firebasestorage.app",
    messagingSenderId: "63956754364",
    appId: "1:63956754364:web:94945733f68ef837a1d5b9",
    measurementId: "G-SR8Y5NKQTZ"
};

// Initialize Firebase
let database = null;
if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    firebase.initializeApp(firebaseConfig);
    database = firebase.database();
}

// Environment Detection (Production vs Development)
const isProduction = true; // 常に本番データ（Web）と同期するためにtrueに変更
const SECRET_KEY = 'nippo-report-secure-key-2026';
const DB_PATH = `${SECRET_KEY}/${isProduction ? '1f_nippo_records' : '1f_nippo_records_dev'}`;
const DB_CARRYOVER_PATH = `${SECRET_KEY}/${isProduction ? '1f_carryover' : '1f_carryover_dev'}`;
const LS_KEY = isProduction ? '1f_nippo_records' : '1f_nippo_records_dev';
const LS_CARRYOVER_KEY = isProduction ? '1f_carryover' : '1f_carryover_dev';

console.log(`1F App: Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode. Data path: ${DB_PATH}`);

// State Management
let records = JSON.parse(localStorage.getItem(LS_KEY)) || [];
let currentDate = new Date().toLocaleDateString('sv-SE');
let isFirstLoad = true;

// Real-time synchronization from Firebase
if (database) {
    // Sync records
    database.ref(DB_PATH).on('value', (snapshot) => {
        const firebaseData = snapshot.val();
        let firebaseRecords = [];
        if (firebaseData) {
            firebaseRecords = Array.isArray(firebaseData) ? firebaseData : Object.values(firebaseData);
        }

        if (isFirstLoad) {
            isFirstLoad = false;
            // --- 1-TIME PATCH to fix R1 count ---
            let patched = false;
            firebaseRecords.forEach(r => {
                if (r.machine === 'R1' && r.count === 1) {
                    r.count = 0;
                    patched = true;
                }
            });
            // ------------------------------------
            
            if (firebaseRecords.length > 0) {
                records = firebaseRecords;
                localStorage.setItem(LS_KEY, JSON.stringify(records));
            } else if (records.length > 0) {
                database.ref(DB_PATH).set(records);
            }
            if (patched) database.ref(DB_PATH).set(records);
            if (typeof renderRecords === 'function') renderRecords();
        } else {
            if (firebaseRecords.length > 0) {
                // --- 1-TIME PATCH ---
                firebaseRecords.forEach(r => {
                    if (r.machine === 'R1' && r.count === 1) r.count = 0;
                });
                // --------------------
                records = firebaseRecords;
                localStorage.setItem(LS_KEY, JSON.stringify(records));
                if (typeof renderRecords === 'function') {
                    renderRecords();
                    if (monthViewContainer && monthViewContainer.style.display === 'block') renderMonthlyRecords();
                }
            }
        }
    });
}

const MACHINES = ['R1', 'R2', 'R3', 'R4'];

// DOM Elements
const recordsList = document.getElementById('records-list-1f');
const datePicker = document.getElementById('current-date-picker');
const dayTotalEl = document.getElementById('day-total-count-1f');
const grandTotalDisplayEl = document.getElementById('grand-total-display-1f');
const monthlyGrandTotalEl = document.getElementById('monthly-grand-total-1f');
const avgDurationEl = document.getElementById('avg-duration-1f');
const viewDayBtn = document.getElementById('view-day');
const viewMonthBtn = document.getElementById('view-month');
const dayViewContainer = document.getElementById('day-view-container');
const monthViewContainer = document.getElementById('month-view-container');

// Helpers for PC and Mobile input handling
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function normalizeTime(val) {
    val = (val || '').trim();
    if (!val) return '';
    // Convert 845 or 0845 to 08:45
    if (/^\d{3,4}$/.test(val)) {
        if (val.length === 3) val = '0' + val;
        return val.substring(0, 2) + ':' + val.substring(2);
    }
    return val;
}

// Initialize
function init() {
    const isMobile = isMobileDevice();
    if (!isMobile) {
        // PC版での時間入力を使いやすくするためにtextタイプに変更し、全選択・自動整形を適用
        ['start-time-1f', 'end-time-1f'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.type = 'text';
                el.placeholder = 'HH:mm';
                el.setAttribute('onfocus', 'this.select()');
                el.addEventListener('blur', function() {
                    this.value = normalizeTime(this.value);
                });
            }
        });
    }

    datePicker.value = currentDate;

    flatpickr(datePicker, {
        locale: "ja",
        defaultValue: currentDate,
        disableMobile: true,
        onChange: function (selectedDates, dateStr) {
            currentDate = dateStr;
            ensureDayRecords(currentDate);
            renderRecords();
            if (monthViewContainer.style.display === 'block') renderMonthlyRecords();
        },
        onDayCreate: function (dObj, dStr, fp, dayElem) {
            const dateStr = dayElem.dateObj.toLocaleDateString('sv-SE');
            if (dayElem.dateObj.getDay() === 0 || isJapaneseHoliday(dateStr)) {
                dayElem.classList.add("weekend-sun");
            } else if (dayElem.dateObj.getDay() === 6) {
                dayElem.classList.add("weekend-sat");
            }
        }
    });

    viewDayBtn.addEventListener('click', () => switchView('day'));
    viewMonthBtn.addEventListener('click', () => switchView('month'));
    document.getElementById('entry-form-1f').addEventListener('submit', handleAddRecord);

    ensureDayRecords(currentDate);
    renderRecords();

    // Mobile Menu Setup
    setupMobileMenu();
}

function setupMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

    if (!hamburgerBtn || !sidebar || !sidebarOverlay) return;

    const toggleMenu = (show) => {
        sidebar.classList.toggle('open', show);
        sidebarOverlay.classList.toggle('active', show);
        if (show) {
            sidebarOverlay.style.display = 'block';
        } else {
            setTimeout(() => {
                if (!sidebar.classList.contains('open')) {
                    sidebarOverlay.style.display = 'none';
                }
            }, 300);
        }
    };

    hamburgerBtn.addEventListener('click', () => toggleMenu(true));
    sidebarCloseBtn?.addEventListener('click', () => toggleMenu(false));
    sidebarOverlay.addEventListener('click', () => toggleMenu(false));

    // Close menu when navigation item is clicked
    const navItems = sidebar.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => toggleMenu(false));
    });
}

// View switching
function switchView(view) {
    if (view === 'day') {
        dayViewContainer.style.display = 'block';
        monthViewContainer.style.display = 'none';
        viewDayBtn.classList.add('active');
        viewMonthBtn.classList.remove('active');
    } else {
        dayViewContainer.style.display = 'none';
        monthViewContainer.style.display = 'block';
        viewDayBtn.classList.remove('active');
        viewMonthBtn.classList.add('active');
        renderMonthlyRecords();
    }
}

// Monthly Records
function renderMonthlyRecords() {
    const currentMonth = currentDate.substring(0, 7);
    const monthRecords = records.filter(r => r.date && r.date.startsWith(currentMonth));

    // Machine-specific monthly data
    const machineData = {};
    MACHINES.forEach(m => { machineData[m] = { total: 0, days: 0 }; });

    const dailyData = {};
    let totalMonthCount = 0;

    monthRecords.forEach(r => {
        if (r.count > 0) {
            machineData[r.machine].total += r.count;
            machineData[r.machine].days++;
            totalMonthCount += r.count;

            if (!dailyData[r.date]) {
                dailyData[r.date] = { total: 0, machines: new Set() };
            }
            dailyData[r.date].total += r.count;
            dailyData[r.date].machines.add(r.machine);
        }
    });

    // Machine list
    const machineListEl = document.getElementById('monthly-machine-list');
    machineListEl.innerHTML = MACHINES.map(m => `
        <div class="monthly-machine-item">
            <span class="machine-badge machine-badge-${m.toLowerCase()}">${m}</span>
            <div class="stats-data">
                <div class="total-val">${machineData[m].total.toLocaleString()}</div>
                <div class="avg-val">${machineData[m].days}日 / 平均 ${machineData[m].days > 0 ? Math.round(machineData[m].total / machineData[m].days).toLocaleString() : 0}</div>
            </div>
        </div>
    `).join('');

    // Stats overview
    const statsOverviewEl = document.getElementById('monthly-stats-overview-1f');
    const dayCount = Object.keys(dailyData).length;
    statsOverviewEl.innerHTML = `
        <div class="stats-summary-flex">
            <div class="stats-item">
                <div class="stats-label">稼働日数</div>
                <div class="stats-value">${dayCount} 日</div>
            </div>
            <div class="stats-item primary">
                <div class="stats-label">総プレス数</div>
                <div class="stats-value">${totalMonthCount.toLocaleString()}</div>
            </div>
            <div class="stats-item">
                <div class="stats-label">月平均/日</div>
                <div class="stats-value">${dayCount > 0 ? Math.round(totalMonthCount / dayCount).toLocaleString() : 0}</div>
            </div>
        </div>
    `;

    // Daily breakdown
    const dailyListEl = document.getElementById('monthly-daily-list-1f');
    const sortedRecords = monthRecords
        .filter(r => r.count > 0 || r.notes)
        .sort((a, b) => b.date.localeCompare(a.date) || a.machine.localeCompare(b.machine));

    let html = '';
    let lastDate = '';
    sortedRecords.forEach(r => {
        if (r.date !== lastDate) {
            html += `
                <tr class="date-group-divider">
                    <td colspan="7" style="padding: 1rem;">
                        ${r.date.split('-')[0]}年 ${r.date.split('-')[1]}月 ${r.date.split('-')[2]}日
                    </td>
                </tr>
            `;
            lastDate = r.date;
        }
        const { h, m } = calculateDuration(r.startTime, r.endTime);
        html += `
            <tr>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${r.date.split('-')[1]}/${r.date.split('-')[2]}</td>
                <td class="machine-cell"><span class="machine-badge machine-badge-${r.machine.toLowerCase()}">${r.machine}</span></td>
                <td class="time-cell">${r.startTime || ''}</td>
                <td class="time-cell">${r.endTime || ''}</td>
                <td style="font-size: 0.85rem; color: var(--text-muted);">${h}時間 ${m}分</td>
                <td style="text-align: right; font-weight: 700; color: var(--primary);">${r.count > 0 ? r.count.toLocaleString() : ''}</td>
                <td style="font-size: 0.8rem; color: var(--text-muted);">${r.notes || ''}</td>
            </tr>
        `;
    });
    dailyListEl.innerHTML = html || '<tr><td colspan="7" style="text-align:center; padding: 2rem;">記録がありません</td></tr>';
}

// Add record
function handleAddRecord(e) {
    e.preventDefault();
    const startTimeInput = document.getElementById('start-time-1f');
    const endTimeInput = document.getElementById('end-time-1f');

    if (!isMobileDevice()) {
        startTimeInput.value = normalizeTime(startTimeInput.value);
        endTimeInput.value = normalizeTime(endTimeInput.value);
    }

    const record = {
        id: Date.now() + Math.random(),
        date: currentDate,
        machine: document.getElementById('machine-1f').value,
        startTime: startTimeInput.value,
        endTime: endTimeInput.value,
        count: parseInt(document.getElementById('count-1f').value || 0),
        notes: document.getElementById('notes-1f').value
    };
    records.push(record);
    saveRecords();
    renderRecords();
    document.getElementById('count-1f').value = '';
    document.getElementById('notes-1f').value = '';
}

// Japanese Holiday Calculation
function isJapaneseHoliday(dateStr) {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();

    const fixedHolidays = {
        '1-1': true, '2-11': true, '2-23': true, '4-29': true,
        '5-3': true, '5-4': true, '5-5': true, '7-21': true,
        '8-11': true, '9-23': true, '10-14': true, '11-3': true,
        '11-23': true
    };
    if (fixedHolidays[`${month}-${day}`]) return true;

    // Vernal equinox
    if (month === 3) {
        const vernalDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        if (day === vernalDay) return true;
    }
    // Happy Monday holidays
    if (month === 1 && d.getDay() === 1 && day >= 8 && day <= 14) return true;
    if (month === 9 && d.getDay() === 1 && day >= 15 && day <= 21) return true;
    if (month === 10 && d.getDay() === 1 && day >= 8 && day <= 14) return true;

    return false;
}

// Ensure machines R1-R4 exist for a specific date
function ensureDayRecords(date) {
    const dayOfWeek = new Date(date).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6 || isJapaneseHoliday(date)) return;

    const existingMachines = records.filter(r => r.date === date).map(r => r.machine);
    let updated = false;

    MACHINES.forEach(m => {
        if (!existingMachines.includes(m)) {
            records.push({
                id: Date.now() + Math.random(),
                date: date,
                machine: m,
                startTime: '08:45',
                endTime: '17:00',
                count: 0,
                notes: ''
            });
            updated = true;
        }
    });

    if (updated) saveRecords();
}

// Update record
function updateRecord(id, field, value) {
    const record = records.find(r => r.id == id);
    if (!record) return;
    if (field === 'count') {
        record[field] = parseInt(value) || 0;
    } else {
        record[field] = value;
    }
    saveRecords();
    calculateAndDisplayStats();
}

// Duration calculation
function calculateDuration(start, end) {
    if (!start || !end) return { h: 0, m: 0, totalMinutes: 0 };
    const s = start.split(':').map(Number);
    const e = end.split(':').map(Number);
    let diff = (e[0] * 60 + e[1]) - (s[0] * 60 + s[1]);
    if (diff < 0) diff += 24 * 60;
    return { h: Math.floor(diff / 60), m: diff % 60, totalMinutes: diff };
}

// Save
function saveRecords() {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('LocalStorage save failed:', e);
    }
    if (database) {
        database.ref(DB_PATH).set(records)
            .then(() => {
                // syncToGoogleSheets(records); // Disconnected
            })
            .catch(err => console.error('Firebase save failed:', err));
    }
}

// Calculate cumulative total for a machine up to a certain date
function getCumulativeTotal(machine, upToDate) {
    const sum = records
        .filter(r => r.machine === machine && r.date <= upToDate && r.count > 0)
        .reduce((acc, r) => acc + r.count, 0);
    return sum;
}

// Render Records
function renderRecords() {
    const dayRecords = records.filter(r => r.date === currentDate)
        .sort((a, b) => a.machine.localeCompare(b.machine));

    recordsList.innerHTML = '';

    dayRecords.forEach(record => {
        const { h, m } = calculateDuration(record.startTime, record.endTime);
        const cumTotal = getCumulativeTotal(record.machine, currentDate);
        const tr = document.createElement('tr');

        const isMobile = isMobileDevice();
        tr.innerHTML = `
            <td class="machine-cell"><span class="machine-badge machine-badge-${record.machine.toLowerCase()}">${record.machine}</span></td>
            <td class="time-cell">
                <input type="${isMobile ? 'time' : 'text'}" class="inline-input" value="${record.startTime}"
                       ${isMobile ? '' : 'placeholder="HH:mm" onfocus="this.select()"'}
                       ${isMobile ? `onchange="updateRecord(${record.id}, 'startTime', this.value); this.closest('tr').querySelector('.duration-text').innerText = getDurationLabel('${record.id}', this.value, null)"` : 
                                   `onblur="this.value = normalizeTime(this.value); updateRecord(${record.id}, 'startTime', this.value); this.closest('tr').querySelector('.duration-text').innerText = getDurationLabel('${record.id}', this.value, null)"`} >
            </td>
            <td class="time-cell">
                <input type="${isMobile ? 'time' : 'text'}" class="inline-input" value="${record.endTime}"
                       ${isMobile ? '' : 'placeholder="HH:mm" onfocus="this.select()"'}
                       ${isMobile ? `onchange="updateRecord(${record.id}, 'endTime', this.value); this.closest('tr').querySelector('.duration-text').innerText = getDurationLabel('${record.id}', null, this.value)"` : 
                                   `onblur="this.value = normalizeTime(this.value); updateRecord(${record.id}, 'endTime', this.value); this.closest('tr').querySelector('.duration-text').innerText = getDurationLabel('${record.id}', null, this.value)"`} >
            </td>
            <td class="duration-cell" style="font-size: 0.8rem; color: var(--text-muted);">
                <span class="duration-text">${h}時間 ${m}分</span>
            </td>
            <td class="count-cell">
                <input type="number" class="inline-input" value="${record.count == 0 ? '' : record.count}"
                       onblur="updateRecord(${record.id}, 'count', this.value)">
            </td>
            <td class="total-cell" style="text-align: center; font-weight: 700; color: var(--accent); font-size: 0.85rem;">
                ${cumTotal.toLocaleString()}
            </td>
            <td class="notes-cell">
                <input type="text" class="inline-input inline-notes" value="${record.notes || ''}" placeholder=""
                       onblur="updateRecord(${record.id}, 'notes', this.value)">
            </td>
            <td class="actions-cell" style="text-align: center;">
                <div style="display: flex; gap: 0.5rem; justify-content: center;">
                    <button onclick="clearRow(${record.id})" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 5px;" title="入力をリセット">
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
                            <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
                        </svg>
                    </button>
                    <button onclick="deleteRecord(${record.id})" style="background: none; border: none; color: var(--danger); opacity: 0.6; cursor: pointer; padding: 5px;" title="項目を削除">
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            </td>
        `;
        recordsList.appendChild(tr);
    });

    calculateAndDisplayStats();
}

// Duration label helper
window.getDurationLabel = (id, newStart, newEnd) => {
    const record = records.find(r => r.id == id);
    const start = newStart || record.startTime;
    const end = newEnd || record.endTime;
    const { h, m } = calculateDuration(start, end);
    return `${h}時間 ${m}分`;
};

// Stats
function calculateAndDisplayStats() {
    const dayRecords = records.filter(r => r.date === currentDate);
    let totalCount = 0;
    let totalMinutes = 0;
    let activeEntries = 0;

    dayRecords.forEach(r => {
        if (r.count > 0) {
            totalCount += r.count;
            const { totalMinutes: mins } = calculateDuration(r.startTime, r.endTime);
            totalMinutes += mins;
            activeEntries++;
        }
    });

    if (dayTotalEl) dayTotalEl.textContent = totalCount.toLocaleString();
    if (grandTotalDisplayEl) {
        grandTotalDisplayEl.textContent = totalCount.toLocaleString();
    }

    // Monthly grand total calculation
    const currentMonth = currentDate.substring(0, 7);
    const monthTotal = records
        .filter(r => r.date && r.date.startsWith(currentMonth))
        .reduce((sum, r) => sum + (r.count || 0), 0);

    if (monthlyGrandTotalEl) {
        monthlyGrandTotalEl.textContent = monthTotal.toLocaleString();
    }

    // Individual Machine Stats Grid (Month Total & Day Avg)
    const statsGrid = document.getElementById('machine-stats-grid-1f');
    if (statsGrid) {
        statsGrid.innerHTML = MACHINES.map(m => {
            const mRecords = records.filter(r => r.machine === m && r.date.startsWith(currentMonth));
            const mTotal = mRecords.reduce((s, r) => s + (r.count || 0), 0);
            const mDays = mRecords.filter(r => r.count > 0).length;
            const mAvg = mDays > 0 ? Math.round(mTotal / mDays) : 0;

            return `
                <div style="padding: 0.6rem; background: rgba(var(--primary-rgb), 0.03); border: 1px solid var(--border); border-radius: 8px;">
                    <div class="machine-badge machine-badge-${m.toLowerCase()}" style="font-size: 0.7rem; padding: 2px 6px; margin-bottom: 0.4rem;">${m}</div>
                    <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                        <div>
                            <div style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">今月累計</div>
                            <div style="font-weight: 800; font-size: 1.1rem; color: var(--primary); line-height: 1;">${mTotal.toLocaleString()}</div>
                        </div>
                        <div style="margin-top: 0.3rem; border-top: 1px solid var(--border); padding-top: 0.3rem;">
                            <div style="font-size: 0.6rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">平均/日</div>
                            <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); line-height: 1;">${mAvg.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    if (avgDurationEl) {
        if (activeEntries > 0) {
            const avgMins = totalMinutes / activeEntries;
            const h = Math.floor(avgMins / 60);
            const m = Math.floor(avgMins % 60);
            avgDurationEl.textContent = `${h}h ${m.toString().padStart(2, '0')}m`;
        } else {
            avgDurationEl.textContent = '0h 00m';
        }
    }
}

// Reset row
function clearRow(id) {
    const record = records.find(r => r.id == id);
    if (!record) return;
    record.count = 0;
    record.notes = '';
    saveRecords();
    renderRecords();
}

// Delete row
function deleteRecord(id) {
    if (confirm('この項目を削除してもよろしいですか？')) {
        records = records.filter(r => r.id != id);
        saveRecords();
        renderRecords();
    }
}

// Expose functions to global scope
window.updateRecord = updateRecord;
window.deleteRecord = deleteRecord;
window.isMobileDevice = isMobileDevice;
window.normalizeTime = normalizeTime;
window.clearRow = clearRow;
window.getDurationLabel = getDurationLabel;

init();
