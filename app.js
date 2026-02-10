// Firebase Configuration
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
// URLが自分のGitHub Pagesのものであれば本番データ、それ以外（自分のPCなど）はテスト用データを使用します
const isProduction = window.location.hostname === 'naishoku-spec.github.io';
const DB_PATH = isProduction ? 'nippo_records' : 'nippo_records_dev';
const LS_KEY = isProduction ? 'nippo_records' : 'nippo_records_dev';

console.log(`Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode. Data path: ${DB_PATH}, LocalStorage: ${LS_KEY}`);

// State Management
let records = JSON.parse(localStorage.getItem(LS_KEY)) || [];
let currentDate = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD format
let isFirstLoad = true;

// Real-time synchronization from Firebase
if (database) {
    database.ref(DB_PATH).on('value', (snapshot) => {
        const firebaseData = snapshot.val();

        // Convert Firebase object to array if needed
        let firebaseRecords = [];
        if (firebaseData) {
            if (Array.isArray(firebaseData)) {
                firebaseRecords = firebaseData;
            } else {
                // Firebase sometimes converts arrays to objects
                firebaseRecords = Object.values(firebaseData);
            }
        }

        if (isFirstLoad) {
            isFirstLoad = false;

            // On first load: merge local and Firebase data
            if (firebaseRecords.length > 0 && records.length === 0) {
                // Firebase has data, local is empty - use Firebase
                records = firebaseRecords;
                localStorage.setItem(LS_KEY, JSON.stringify(records));
            } else if (firebaseRecords.length === 0 && records.length > 0) {
                // Local has data, Firebase is empty - push local to Firebase
                database.ref(DB_PATH).set(records);
            } else if (firebaseRecords.length > 0 && records.length > 0) {
                // Both have data - merge by using the one with more records or more recent data
                // Prefer Firebase if it has more or equal records (likely more up-to-date)
                if (firebaseRecords.length >= records.length) {
                    records = firebaseRecords;
                    localStorage.setItem(LS_KEY, JSON.stringify(records));
                } else {
                    // Local has more - sync to Firebase
                    database.ref(DB_PATH).set(records);
                }
            }

            // Render after initial sync
            if (typeof renderRecords === 'function') {
                renderRecords();
            }
        } else {
            // Subsequent updates - only accept if Firebase has data
            if (firebaseRecords.length > 0) {
                records = firebaseRecords;
                localStorage.setItem(LS_KEY, JSON.stringify(records));
                if (typeof renderRecords === 'function') {
                    renderRecords();
                    if (monthViewContainer && monthViewContainer.style.display === 'block') {
                        renderMonthlyRecords();
                    }
                }
            }
        }
    });
}

const MACHINES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
// ... (PRODUCTS list remains same)
const PRODUCTS = [
    '', 'No.4', 'No.6', 'No.10', 'No.30フラット', 'No.30スイック', 'No.30タブレット',
    '鼻ぽん大', '鼻ぽん小', '穴あき鼻ぽん小さめ', '穴あき鼻ぽん普通', '鼻ぽん特注',
    'コア', '楕円型タブレット', 'SH', 'MSH', 'ソフト', 'インジェクション',
    'ガーゼボール', '固巻円柱綿', 'ぼぼ小', 'ぼぼ大', 'ウォータージェット綿球',
    '美顔器 小', '美顔器 大', '歯科用綿球', '円柱状脱脂綿', '俵綿球', 'ふた',
    'コットンボール', '消臭ボール', '高圧縮', '円錐型綿', 'エアロマビーズ',
    'ツッペル極小 #6片', 'ツッペル小 #10片', 'ツッペル中 #12片', 'ツッペル大 #14片',
    '両穴コットン玉#4両', '両穴コットン玉#6両', '両穴コットン玉#7両', '両穴コットン玉#8両',
    '両穴コットン玉#10両', '両穴コットン玉#12両', '両穴コットン玉#14両', '両穴コットン玉#16両',
    '両穴コットン玉#18両', '両穴コットン玉#20両', '両穴コットン玉#22両', '両穴コットン玉#25両',
    '両穴コットン玉#30両', '両穴コットン玉#35両', '両穴コットン玉#40両',
    '片穴コットン玉#6片', '片穴コットン玉#8片', '片穴コットン玉#10片', '片穴コットン玉#12片',
    '片穴コットン玉#14片', '片穴コットン玉#16片', '片穴コットン玉#18片', '片穴コットン玉#20片',
    '片穴コットン玉#22片', '片穴コットン玉#25片', '片穴コットン玉#30片', '片穴コットン玉#35片',
    '片穴コットン玉#40片', '片穴コットン玉#10太片', '片穴コットン玉#12太片',
    '片穴コットン玉#14太片', '片穴コットン玉#16太片', '片穴コットン玉 半丸φ15',
    '片穴コットン玉 半丸φ20', '片穴コットン玉 半丸φ25',
    '開頭綿球#40', 'むし綿球', 'サンプル'
];

// DOM Elements
const recordsList = document.getElementById('records-list');
// ...
const datePicker = document.getElementById('current-date-picker');
const dayTotalEl = document.getElementById('day-total-count');
const avgDurationEl = document.getElementById('avg-duration');

// DOM Elements for View Switching
const viewDayBtn = document.getElementById('view-day');
const viewMonthBtn = document.getElementById('view-month');
const dayViewContainer = document.getElementById('day-view-container');
const monthViewContainer = document.getElementById('month-view-container');

// Initialize
function init() {
    // Initialize Flatpickr for better styling control (like weekend colors)
    flatpickr(datePicker, {
        locale: "ja",
        defaultValue: currentDate,
        disableMobile: true, // Force consistent UI on mobile
        onChange: function (selectedDates, dateStr) {
            currentDate = dateStr;
            ensureDayRecords(currentDate);
            renderRecords();
            if (monthViewContainer.style.display === 'block') renderMonthlyRecords();
        },
        onDayCreate: function (dObj, dStr, fp, dayElem) {
            const dateStr = dayElem.dateObj.toLocaleDateString('sv-SE');
            // Sunday = 0, Saturday = 6, plus Holidays
            if (dayElem.dateObj.getDay() === 0 || isJapaneseHoliday(dateStr)) {
                dayElem.classList.add("weekend-sun");
            } else if (dayElem.dateObj.getDay() === 6) {
                dayElem.classList.add("weekend-sat");
            }
        }
    });

    datePicker.value = currentDate;
    ensureDayRecords(currentDate);
    renderRecords();

    // Event Listeners
    viewDayBtn.addEventListener('click', () => switchView('day'));
    viewMonthBtn.addEventListener('click', () => switchView('month'));

    document.getElementById('entry-form').addEventListener('submit', handleAddRecord);
}

function switchView(view) {
    if (view === 'day') {
        viewDayBtn.classList.add('active');
        viewMonthBtn.classList.remove('active');
        dayViewContainer.style.display = 'block';
        monthViewContainer.style.display = 'none';
        renderRecords();
    } else {
        viewDayBtn.classList.remove('active');
        viewMonthBtn.classList.add('active');
        dayViewContainer.style.display = 'none';
        monthViewContainer.style.display = 'block';
        renderMonthlyRecords();
    }
}

function renderMonthlyRecords() {
    const currentMonth = currentDate.substring(0, 7); // YYYY-MM
    const monthRecords = records.filter(r => r.date.startsWith(currentMonth));

    // Monthly Summary By Product
    const productTotals = {};
    const dailyData = {};
    let totalMonthCount = 0;

    monthRecords.forEach(r => {
        if (r.count > 0 || r.product !== '') {
            const p = r.product.trim() || '(未入力)';
            productTotals[p] = (productTotals[p] || 0) + r.count;
            totalMonthCount += r.count;

            if (!dailyData[r.date]) {
                dailyData[r.date] = { total: 0, no6: 0, hanaponS: 0, machines: new Set() };
            }
            dailyData[r.date].total += r.count;
            if (p === 'No.6') dailyData[r.date].no6 += r.count;
            if (p === '鼻ぽん小') dailyData[r.date].hanaponS += r.count;
            if (r.count > 0) dailyData[r.date].machines.add(r.machine);
        }
    });

    // Render Product Totals
    const productListEl = document.getElementById('monthly-product-totals');
    productListEl.innerHTML = Object.entries(productTotals).sort((a, b) => b[1] - a[1]).map(([name, count]) => `
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
            <span style="font-weight: 600;">${name}</span>
            <span style="font-weight: 800; color: var(--primary);">${count.toLocaleString()}</span>
        </div>
    `).join('') || '<p style="color:var(--text-muted)">データがありません</p>';

    // Render Overview Stats
    const statsOverviewEl = document.getElementById('monthly-stats-overview');
    const dayCount = Object.keys(dailyData).length;
    statsOverviewEl.innerHTML = `
        <div style="margin-bottom: 1rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted);">今月の稼働日数</div>
            <div style="font-size: 1.5rem; font-weight: 800;">${dayCount} 日</div>
        </div>
        <div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">総生産数</div>
            <div style="font-size: 2rem; font-weight: 800; color: var(--primary);">${totalMonthCount.toLocaleString()}</div>
        </div>
    `;

    // Render Daily Table
    const dailyListEl = document.getElementById('monthly-daily-list');
    dailyListEl.innerHTML = Object.entries(dailyData).sort((a, b) => b[0].localeCompare(a[0])).map(([date, data]) => `
        <tr>
            <td style="font-weight: 600;">${date.split('-')[1]}/${date.split('-')[2]}</td>
            <td style="text-align: right; font-weight: 700;">${data.total.toLocaleString()}</td>
            <td style="text-align: right;">${data.no6.toLocaleString()}</td>
            <td style="text-align: right;">${data.hanaponS.toLocaleString()}</td>
            <td>
                ${Array.from(data.machines).sort().map(m => `<span class="machine-badge-sm">${m}</span>`).join(' ')}
            </td>
        </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center; padding: 2rem;">記録がありません</td></tr>';

    // Render Full Detailed Monthly List
    const fullDetailedListEl = document.getElementById('monthly-full-detailed-list');
    const sortedRecords = monthRecords
        .filter(r => r.count > 0 || r.product !== '')
        .sort((a, b) => b.date.localeCompare(a.date) || a.machine.localeCompare(b.machine));

    let html = '';
    let lastDate = '';

    sortedRecords.forEach(r => {
        // Add date divider if date changes
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
                <td class="machine-cell"><span class="machine-badge">${r.machine}</span></td>
                <td class="product-cell" style="font-weight: 600;">${r.product || '-'}</td>
                <td class="time-cell">${r.startTime}</td>
                <td class="time-cell">${r.endTime}</td>
                <td style="font-size: 0.85rem; color: var(--text-muted);">
                    ${h}時間 ${m}分
                </td>
                <td style="text-align: right; font-weight: 700; color: var(--primary);">
                    ${r.count.toLocaleString()}
                </td>
            </tr>
        `;
    });

    fullDetailedListEl.innerHTML = html || '<tr><td colspan="7" style="text-align:center; padding: 2rem;">記録がありません</td></tr>';
}

// Handle Quick Entry
function handleAddRecord(e) {
    e.preventDefault();

    const record = {
        id: Date.now() + Math.random(),
        date: currentDate,
        machine: document.getElementById('machine').value,
        product: document.getElementById('product').value,
        startTime: document.getElementById('start-time').value,
        endTime: document.getElementById('end-time').value,
        count: parseInt(document.getElementById('count').value || 0),
        orderCount: 0
    };

    records.push(record);
    saveRecords();
    renderRecords();

    // Partially reset form
    document.getElementById('product').value = '';
    document.getElementById('count').value = '';
}

// Japanese Holiday Calculation
function isJapaneseHoliday(dateStr) {
    const date = new Date(dateStr);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = date.getDay(); // 0:Sun, 1:Mon...

    // 1. Fixed Holidays
    if (m === 1 && d === 1) return true; // 元日
    if (m === 2 && d === 11) return true; // 建国記念の日
    if (m === 2 && d === 23) return true; // 天皇誕生日
    if (m === 4 && d === 29) return true; // 昭和の日
    if (m === 5 && d === 3) return true; // 憲法記念日
    if (m === 5 && d === 4) return true; // みどりの日
    if (m === 5 && d === 5) return true; // こどもの日
    if (m === 8 && d === 11) return true; // 山の日
    if (m === 11 && d === 3) return true; // 文化の日
    if (m === 11 && d === 23) return true; // 勤労感謝の日

    // 2. Happy Monday Holidays
    const nthMonday = Math.floor((d - 1) / 7) + 1;
    if (w === 1) {
        if (m === 1 && nthMonday === 2) return true; // 成人の日 (2nd Mon)
        if (m === 7 && nthMonday === 3) return true; // 海の日 (3rd Mon)
        if (m === 9 && nthMonday === 3) return true; // 敬老の日 (3rd Mon)
        if (m === 10 && nthMonday === 2) return true; // スポーツの日 (2nd Mon)
    }

    // 3. Equinoxes (Approximated)
    const vernalEquinox = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    if (m === 3 && d === vernalEquinox) return true;
    const autumnalEquinox = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    if (m === 9 && d === autumnalEquinox) return true;

    // 4. Substitute Holidays (振替休日)
    // If holiday is Sunday, the next Monday is holiday.
    // To check if date is a substitute holiday, we check if it's Monday and if yesterday was a holiday.
    if (w === 1) {
        const yesterday = new Date(date);
        yesterday.setDate(d - 1);
        const yStr = yesterday.toLocaleDateString('sv-SE');
        if (isJapaneseHoliday(yStr)) return true;
    }

    return false;
}

// Ensure machines A-J exist for a specific date
function ensureDayRecords(date) {
    // Skip if weekend (Saturday=6, Sunday=0) or Holiday
    const dayOfWeek = new Date(date).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6 || isJapaneseHoliday(date)) return;

    const existingMachines = records.filter(r => r.date === date).map(r => r.machine);
    let updated = false;

    // Find previous records sorted by date descending
    const previousRecords = records.filter(r => r.date < date).sort((a, b) => b.date.localeCompare(a.date));

    MACHINES.forEach(m => {
        if (!existingMachines.includes(m)) {
            // Find the last record for this machine that had a product name set
            const lastRecordWithProduct = previousRecords.find(r => r.machine === m && r.product !== '');
            const lastProduct = lastRecordWithProduct ? lastRecordWithProduct.product : '';

            records.push({
                id: Date.now() + Math.random(),
                date: date,
                machine: m,
                product: lastProduct,
                startTime: '08:45',
                endTime: '16:30',
                count: 0,
                orderCount: 0
            });
            updated = true;
        }
    });

    if (updated) saveRecords();
}

// Update a specific field in a record
function updateRecord(id, field, value) {
    const record = records.find(r => r.id == id);
    if (!record) return;

    if (field === 'count' || field === 'orderCount') {
        record[field] = parseInt(value) || 0;
    } else {
        record[field] = value;
    }

    // If product name is changed, propagate this choice to future dates that haven't been "started" yet
    if (field === 'product') {
        const realToday = new Date().toLocaleDateString('sv-SE');
        // Propagation only happens if we are editing today's or a future record
        if (record.date >= realToday) {
            records.forEach(futureRecord => {
                if (futureRecord.date > record.date &&
                    futureRecord.machine === record.machine &&
                    futureRecord.count === 0) {
                    futureRecord.product = value;
                }
            });
        }
    }

    saveRecords();
    calculateAndDisplayStats();
}

// Calculate Duration
function calculateDuration(start, end) {
    if (!start || !end) return { h: 0, m: 0, totalMinutes: 0 };
    const s = start.split(':').map(Number);
    const e = end.split(':').map(Number);
    let diff = (e[0] * 60 + e[1]) - (s[0] * 60 + s[1]);
    if (diff < 0) diff += 24 * 60;

    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return { h, m, totalMinutes: diff };
}

// Save to LocalStorage and Firebase (with enhanced reliability)
function saveRecords() {
    // Always save to localStorage first (immediate backup)
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('LocalStorage save failed:', e);
    }

    // Then sync to Firebase
    if (database) {
        database.ref(DB_PATH).set(records)
            .catch((error) => {
                console.error('Firebase save failed:', error);
                // Data is still safe in localStorage
            });
    }
}

// Render Records
function renderRecords() {
    const dayRecords = records.filter(r => r.date === currentDate)
        .sort((a, b) => a.machine.localeCompare(b.machine));

    recordsList.innerHTML = '';

    dayRecords.forEach(record => {
        const { h, m } = calculateDuration(record.startTime, record.endTime);
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td class="machine-cell"><span class="machine-badge">${record.machine}</span></td>
            <td class="product-cell">
                <select class="inline-input" onchange="updateRecord(${record.id}, 'product', this.value)">
                    ${PRODUCTS.map(p => `<option value="${p}" ${record.product === p ? 'selected' : ''}>${p || '選択してください...'}</option>`).join('')}
                </select>
            </td>
            <td class="time-cell">
                <input type="time" class="inline-input" value="${record.startTime}" 
                       onchange="updateRecord(${record.id}, 'startTime', this.value); this.closest('tr').querySelector('.duration-text').innerText = getDurationLabel('${record.id}', this.value, null)">
            </td>
            <td class="time-cell">
                <input type="time" class="inline-input" value="${record.endTime}" 
                       onchange="updateRecord(${record.id}, 'endTime', this.value); this.closest('tr').querySelector('.duration-text').innerText = getDurationLabel('${record.id}', null, this.value)">
            </td>
            <td class="duration-cell" style="font-size: 0.8rem; color: var(--text-muted);">
                <span class="duration-text">${h}時間 ${m}分</span>
            </td>
            <td class="count-cell">
                <input type="number" class="inline-input" value="${record.count == 0 ? '' : record.count}" 
                       onblur="updateRecord(${record.id}, 'count', this.value)">
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

// Helper to update duration text immediately after time change
window.getDurationLabel = (id, newStart, newEnd) => {
    const record = records.find(r => r.id == id);
    const start = newStart || record.startTime;
    const end = newEnd || record.endTime;
    const { h, m } = calculateDuration(start, end);
    return `${h}時間 ${m}分`;
};

function calculateAndDisplayStats() {
    const dayRecords = records.filter(r => r.date === currentDate);
    let totalCount = 0;
    let totalNo6 = 0;
    let totalHanaponSmall = 0;
    let totalMinutes = 0;
    let activeEntries = 0;

    dayRecords.forEach(r => {
        if (r.count > 0 || r.product !== '') {
            totalCount += r.count;

            // Specific product totals
            const p = r.product.trim();
            if (p === 'No.6') totalNo6 += r.count;
            if (p === '鼻ぽん小') totalHanaponSmall += r.count;

            const { totalMinutes: mins } = calculateDuration(r.startTime, r.endTime);
            totalMinutes += mins;
            activeEntries++;
        }
    });

    dayTotalEl.textContent = totalCount.toLocaleString();
    document.getElementById('no6-total-count').textContent = totalNo6.toLocaleString();
    document.getElementById('hanapon-s-total-count').textContent = totalHanaponSmall.toLocaleString();

    if (activeEntries > 0) {
        const avgMins = totalMinutes / activeEntries;
        const h = Math.floor(avgMins / 60);
        const m = Math.floor(avgMins % 60);
        avgDurationEl.textContent = `${h}h ${m.toString().padStart(2, '0')}m`;
    } else {
        avgDurationEl.textContent = '0h 00m';
    }
}

// Reset a row
function clearRow(id) {
    const record = records.find(r => r.id == id);
    if (!record) return;
    record.product = '';
    record.count = 0;
    saveRecords();
    renderRecords();
}

// Delete a row
function deleteRecord(id) {
    if (confirm('この項目を削除してもよろしいですか？')) {
        records = records.filter(r => r.id != id);
        saveRecords();
        renderRecords();
    }
}


// Expose functions to global scope for inline events
window.updateRecord = updateRecord;
window.deleteRecord = deleteRecord;
window.clearRow = clearRow;
window.getDurationLabel = getDurationLabel;

init();
