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
const NOTES_LS_KEY = isProduction ? '1f_nippo_daily_notes' : '1f_nippo_daily_notes_dev';
const NOTES_DB_PATH = `${SECRET_KEY}/${isProduction ? '1f_nippo_daily_notes' : '1f_nippo_daily_notes_dev'}`;


console.log(`1F App: Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode. Data path: ${DB_PATH}`);

// State Management
let records = JSON.parse(localStorage.getItem(LS_KEY)) || [];
let currentDate = new Date().toLocaleDateString('sv-SE');
let isFirstLoad = true;
let isFirebaseSynced = false; 
let dailyNotes = JSON.parse(localStorage.getItem(NOTES_LS_KEY)) || {};
let noteSaveTimeout = null;


// Real-time synchronization from Firebase
if (database) {
    database.ref(DB_PATH).on('value', (snapshot) => {
        const firebaseData = snapshot.val();
        let firebaseRecords = [];
        if (firebaseData) {
            firebaseRecords = Array.isArray(firebaseData) ? firebaseData : Object.values(firebaseData);
        }

        if (isFirstLoad) {
            isFirstLoad = false;
            
            if (firebaseRecords.length > 0) {
                // Cloud has data: prioritize it
                records = firebaseRecords;
                localStorage.setItem(LS_KEY, JSON.stringify(records));
            } else {
                // Cloud is empty: seed it with local data if available
                if (records.length > 0) {
                    database.ref(DB_PATH).set(records);
                }
            }
            
            isFirebaseSynced = true; 
            ensureDayRecords(currentDate);
            renderRecords();
            if (monthViewContainer && monthViewContainer.style.display === 'block') renderMonthlyRecords();
        } else {
            // Live updates from other devices
            if (firebaseRecords.length > 0) {
                // Ensure consistent ordering for comparison
                const sortedFirebase = firebaseRecords.slice().sort((a, b) => a.date.localeCompare(b.date) || a.machine.localeCompare(b.machine));
                const sortedLocal = records.slice().sort((a, b) => a.date.localeCompare(b.date) || a.machine.localeCompare(b.machine));


                // Only update if the data is actually different to avoid unnecessary jumping
                if (JSON.stringify(sortedLocal) !== JSON.stringify(sortedFirebase)) {
                    records = firebaseRecords;
                    localStorage.setItem(LS_KEY, JSON.stringify(records));
                    renderRecords();
                    if (monthViewContainer && monthViewContainer.style.display === 'block') renderMonthlyRecords();
                }
            }
        }
    });



    // Sync centralized notes
    database.ref(NOTES_DB_PATH).on('value', (snapshot) => {
        const firebaseNotes = snapshot.val();
        if (firebaseNotes) {
            dailyNotes = firebaseNotes;
            localStorage.setItem(NOTES_LS_KEY, JSON.stringify(dailyNotes));
            renderDailyNotes();
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
    // 全てのデバイス（PC・スマホ）で時間入力を使いやすくするためにtextタイプとして扱い、自動整形を適用
    ['start-time-1f', 'end-time-1f'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.type = 'text';
            el.placeholder = 'HH:mm';
            el.setAttribute('inputmode', 'numeric'); // 数字キーボードを出しやすくする
            el.setAttribute('onfocus', 'this.select()');
            el.addEventListener('blur', function() {
                this.value = normalizeTime(this.value);
            });
        }
    });


    datePicker.value = currentDate;

    flatpickr(datePicker, {
        locale: "ja",
        defaultValue: currentDate,
        disableMobile: true,
        onChange: function (selectedDates, dateStr) {
            currentDate = dateStr;
            ensureDayRecords(currentDate);
            renderRecords();
            renderDailyNotes();
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
    renderDailyNotes();

    // Prevent data loss on refresh/close
    window.addEventListener('beforeunload', () => {
        saveRecords();
        saveDailyNotes1f();
    });

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
                    <td colspan="6" style="padding: 1rem;">
                        ${r.date.split('-')[0]}年 ${r.date.split('-')[1]}月 ${r.date.split('-')[2]}日
                    </td>
                </tr>
            `;
            lastDate = r.date;
        }
        html += `
            <tr>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${r.date.split('-')[1]}/${r.date.split('-')[2]}</td>
                <td class="machine-cell"><span class="machine-badge machine-badge-${r.machine.toLowerCase()}">${r.machine}</span></td>
                <td class="time-cell">${r.startTime || ''}</td>
                <td class="time-cell">${r.endTime || ''}</td>
                <td style="text-align: right; font-weight: 700; color: var(--primary);">${r.count > 0 ? r.count.toLocaleString() : ''}</td>
            </tr>

        `;
    });
    dailyListEl.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding: 2rem;">記録がありません</td></tr>';
}

// Add record
function handleAddRecord(e) {
    e.preventDefault();
    const startTimeInput = document.getElementById('start-time-1f');
    const endTimeInput = document.getElementById('end-time-1f');

    startTimeInput.value = normalizeTime(startTimeInput.value);
    endTimeInput.value = normalizeTime(endTimeInput.value);


    const record = {
        id: Date.now() + Math.random(),
        date: currentDate,
        machine: document.getElementById('machine-1f').value,
        startTime: startTimeInput.value,
        endTime: endTimeInput.value,
        count: parseInt(document.getElementById('count-1f').value || 0)
    };
    records.push(record);
    saveRecords(record);
    renderRecords();
    document.getElementById('count-1f').value = '';

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
        const numVal = parseInt(value);
        record[field] = isNaN(numVal) ? 0 : numVal;
    } else {
        record[field] = value;
    }
    
    saveRecords(); // Normal full sync
    calculateAndDisplayStats();
    // No full render here to keep focus, but stats are updated
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

// Save logic: Granular updates to prevent multi-device conflicts
function saveRecords() {
    // Always save to localStorage immediately
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('LocalStorage save failed:', e);
    }
    
    // Sync to Firebase using full sync for 1F (stabler and manageable data size)
    if (database && isFirebaseSynced) {
        database.ref(DB_PATH).set(records)
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

        tr.innerHTML = `
            <td class="machine-cell"><span class="machine-badge machine-badge-${record.machine.toLowerCase()}">${record.machine}</span></td>
            <td class="time-cell">
                <input type="text" class="inline-input" value="${record.startTime}"
                       placeholder="HH:mm" inputmode="numeric" onfocus="this.select()"
                       onblur="this.value = normalizeTime(this.value); updateRecord(${record.id}, 'startTime', this.value)" >
            </td>
            <td class="time-cell">
                <input type="text" class="inline-input" value="${record.endTime}"
                       placeholder="HH:mm" inputmode="numeric" onfocus="this.select()"
                       onblur="this.value = normalizeTime(this.value); updateRecord(${record.id}, 'endTime', this.value)" >
            </td>

            <td class="count-cell">
                <input type="number" class="inline-input" value="${record.count == 0 ? '' : record.count}"
                       oninput="instantUpdateCount(${record.id}, this.value, this)"
                       onblur="updateRecord(${record.id}, 'count', this.value)">
            </td>

            <td class="total-cell" style="text-align: center; font-weight: 700; color: var(--accent); font-size: 0.85rem;">
                ${cumTotal.toLocaleString()}
            </td>
        `;

        recordsList.appendChild(tr);
    });

    calculateAndDisplayStats();
    renderTrashList();
}

// Trash Management Logic
window.toggleTrashArea = function() {
    const panel = document.getElementById('trash-panel');
    const btn = document.getElementById('toggleTrashBtn');
    if (!panel || !btn) return;
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        btn.innerText = '削除パネルを閉じる';
        renderTrashList();
    } else {
        panel.style.display = 'none';
        btn.innerText = '削除パネルを表示';
    }
};

function renderTrashList() {
    const listContainer = document.getElementById('trash-list-container');
    if (!listContainer) return;
    
    const dayRecords = records.filter(r => r.date === currentDate);
    listContainer.innerHTML = '';
    
    if (dayRecords.length === 0) {
        listContainer.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">削除できる項目がありません。</p>';
        return;
    }
    
    dayRecords.forEach(record => {
        const chip = document.createElement('div');
        chip.style.cssText = `
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: white;
            border: 1px solid #feb2b2;
            border-radius: 20px;
            padding: 4px 12px;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
            user-select: none;
        `;
        chip.innerHTML = `
            <span style="font-weight: 600; color: #c53030;">${record.machine}</span>
            <span style="color: #718096; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${record.count > 0 ? record.count.toLocaleString() : '(0)'}</span>
            <svg width="12" height="12" fill="#e53e3e" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
        `;
        chip.onmouseover = () => { chip.style.background = '#fff5f5'; chip.style.transform = 'translateY(-1px)'; };
        chip.onmouseout = () => { chip.style.background = 'white'; chip.style.transform = 'none'; };
        chip.onclick = () => deleteRecord(record.id);
        listContainer.appendChild(chip);
    });
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
        localStorage.setItem(LS_KEY, JSON.stringify(records));
        
        if (database && isFirebaseSynced) {
            database.ref(DB_PATH + '/' + id).remove()
                .then(() => {
                    renderRecords();
                    if (monthViewContainer && monthViewContainer.style.display === 'block') renderMonthlyRecords();
                })
                .catch(err => console.error('Firebase remove failed:', err));
        } else {
            renderRecords();
            if (monthViewContainer && monthViewContainer.style.display === 'block') renderMonthlyRecords();
        }
    }
}

// Expose functions to global scope
window.updateRecord = updateRecord;
window.deleteRecord = deleteRecord;
window.isMobileDevice = isMobileDevice;
window.normalizeTime = normalizeTime;
window.clearRow = clearRow;
window.getDurationLabel = getDurationLabel;

// Instant update as typing (UI only, persistence happens on blur)
window.instantUpdateCount = function(id, value, inputEl) {
    const record = records.find(r => r.id == id);
    if (!record) return;
    
    const numVal = parseInt(value);
    record.count = isNaN(numVal) ? 0 : numVal;
    
    // Update the duration calculation (if applicable, though row doesn't show it anymore, stats use it)
    // Update the cumulative total cell for this row
    const tr = inputEl.closest('tr');
    if (tr) {
        const totalCell = tr.querySelector('.total-cell');
        if (totalCell) {
            const cumTotal = getCumulativeTotal(record.machine, currentDate);
            totalCell.textContent = cumTotal.toLocaleString();
        }
    }
    
    // Update all global display elements (Summary cards, stats)
    calculateAndDisplayStats();

    // Debounce a full save to Firebase so it persists even if user doesn't blur soon
    clearTimeout(window.instantSaveTimeout);
    window.instantSaveTimeout = setTimeout(() => {
        saveRecords();
    }, 2000);
};



// Centralized Daily Notes Logic
function renderDailyNotes() {
    const textarea = document.getElementById('day-note-text-1f');
    if (textarea) {
        textarea.value = dailyNotes[currentDate] || "";
    }
}

window.saveDailyNotes1f = function() {
    const textarea = document.getElementById('day-note-text-1f');
    if (!textarea) return;
    
    const text = textarea.value.trim();
    if (text) {
        dailyNotes[currentDate] = text;
    } else {
        delete dailyNotes[currentDate];
    }
    
    localStorage.setItem(NOTES_LS_KEY, JSON.stringify(dailyNotes));
    
    clearTimeout(noteSaveTimeout);
    noteSaveTimeout = setTimeout(() => {
        if (database) {
            database.ref(NOTES_DB_PATH).set(dailyNotes).then(() => {
                const saveStatus = document.getElementById('saveStatusNotes1f');
                if (saveStatus) {
                    saveStatus.textContent = "保存しました";
                    setTimeout(() => saveStatus.textContent = "", 3000);
                }
            });
        }
    }, 1000);
}


init();
