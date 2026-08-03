// Firebase Configuration (shared)
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
if (firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
}
database = firebase.database();
if (window.SharedSync) {
    database = SharedSync.guardDatabase(database);
    SharedSync.startVersionGuard();
}

const isProduction = true;
const SECRET_KEY = 'nippo-report-secure-key-2026';
const DB_PATH = `${SECRET_KEY}/${isProduction ? 'saidan_records' : 'saidan_records_dev'}`;
const LS_KEY = isProduction ? 'saidan_records' : 'saidan_records_dev';

const MIN_ROWS = 5; // あらかじめ常時５項目常に表示

console.log(`Saidan App: Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode. Data path: ${DB_PATH}`);

// State
let records = JSON.parse(localStorage.getItem(LS_KEY)) || [];
let currentDate = new Date().toLocaleDateString('sv-SE');
let currentView = 'day'; // 'day' or 'month'
let isFirstLoad = true;
let isFirebaseSynced = false;
let recordsSync = null;

// Real-time sync from Firebase
function normalizeSaidanRecords(value) {
    const list = Array.isArray(value)
        ? value
        : Object.values(value && typeof value === 'object' ? value : {});
    return list.filter(item => item && typeof item === 'object');
}

if (database && window.SharedSync) {
    recordsSync = SharedSync.createPathSync({
        database,
        path: DB_PATH,
        emptyValue: [],
        normalize: normalizeSaidanRecords,
        pendingStorageKey: LS_KEY + '_pending_sync',
        mergeInitial: true,
        serverSnapshotStorageKey: LS_KEY + '_server_snapshot',
        getLocal: () => records,
        setLocal: value => {
            records = normalizeSaidanRecords(value);
            localStorage.setItem(LS_KEY, JSON.stringify(records));
        },
        onRemote: () => {
            isFirebaseSynced = true;
            const activeEl = document.activeElement;
            if (activeEl && activeEl.closest('#saidan-items-container')) return;
            ensureMinRows(currentDate);
            renderRecords();
            if (currentView === 'month') renderMonthlyRecords();
        }
    });
}

// Japanese Holiday Detection
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
    // Happy Monday
    if (month === 1 && d.getDay() === 1 && day >= 8 && day <= 14) return true;
    if (month === 9 && d.getDay() === 1 && day >= 15 && day <= 21) return true;
    if (month === 10 && d.getDay() === 1 && day >= 8 && day <= 14) return true;

    return false;
}

// Time normalization
function normalizeTime(val) {
    val = (val || '').trim();
    if (!val) return '';
    if (/^\d{3,4}$/.test(val)) {
        if (val.length === 3) val = '0' + val;
        return val.substring(0, 2) + ':' + val.substring(2);
    }
    return val;
}

// Ensure at least MIN_ROWS items exist for a given date
function ensureMinRows(date) {
    const dayRecords = records.filter(r => r.date === date);

    // 既存の未入力レコードでデフォルト時間(07:00/16:30)が残っている場合は空文字にリセット
    dayRecords.forEach(r => {
        if ((!r.product || r.product.trim() === '') && (!r.notes || r.notes.trim() === '')) {
            if (r.startTime === '07:00') r.startTime = '';
            if (r.endTime === '16:30') r.endTime = '';
        }
    });

    if (dayRecords.length < MIN_ROWS) {
        const needed = MIN_ROWS - dayRecords.length;
        let updated = false;
        for (let i = 0; i < needed; i++) {
            records.push({
                id: Date.now() + Math.random() + i,
                date: date,
                product: '',
                startTime: '',
                endTime: '',
                worker: '',
                notes: ''
            });
            updated = true;
        }
        if (updated) saveRecords();
    }
}

// Initialization
function init() {
    const datePicker = document.getElementById('current-date-picker');
    datePicker.value = currentDate;

    flatpickr(datePicker, {
        locale: "ja",
        defaultValue: currentDate,
        disableMobile: true,
        onChange: function (selectedDates, dateStr) {
            currentDate = dateStr;
            ensureMinRows(currentDate);
            renderRecords();
            if (currentView === 'month') renderMonthlyRecords();
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

    // Time input normalization
    ['saidan-start-time', 'saidan-end-time'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.setAttribute('onfocus', 'this.select()');
            el.addEventListener('blur', function () {
                this.value = normalizeTime(this.value);
            });
        }
    });

    // Toggle View buttons
    const dayBtn = document.getElementById('saidan-view-day-btn');
    const monthBtn = document.getElementById('saidan-view-month-btn');

    if (dayBtn) dayBtn.addEventListener('click', () => switchSaidanView('day'));
    if (monthBtn) monthBtn.addEventListener('click', () => switchSaidanView('month'));

    // Form submission
    const form = document.getElementById('saidan-entry-form');
    if (form) {
        form.addEventListener('submit', handleAddRecord);
    }

    // Mobile menu
    setupMobileMenu();

    // Initial render
    ensureMinRows(currentDate);
    renderRecords();

}

// Switch between Day view and Monthly view
function switchSaidanView(view) {
    currentView = view;
    const dayViewContainer = document.getElementById('saidan-day-view-container');
    const monthViewContainer = document.getElementById('saidan-month-view-container');
    const dayBtn = document.getElementById('saidan-view-day-btn');
    const monthBtn = document.getElementById('saidan-view-month-btn');

    if (view === 'day') {
        if (dayViewContainer) dayViewContainer.style.display = 'block';
        if (monthViewContainer) monthViewContainer.style.display = 'none';
        if (dayBtn) dayBtn.classList.add('active');
        if (monthBtn) monthBtn.classList.remove('active');
    } else {
        if (dayViewContainer) dayViewContainer.style.display = 'none';
        if (monthViewContainer) monthViewContainer.style.display = 'block';
        if (dayBtn) dayBtn.classList.remove('active');
        if (monthBtn) monthBtn.classList.add('active');
        renderMonthlyRecords();
    }
}

// Note Modal Helpers
function openSaidanNoteModal(text) {
    const modal = document.getElementById('saidan-note-modal');
    const body = document.getElementById('saidan-modal-note-body');
    if (modal && body) {
        body.textContent = text || '備考はありません';
        modal.style.display = 'flex';
    }
}

function closeSaidanNoteModal() {
    const modal = document.getElementById('saidan-note-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Render Monthly Aggregation
function renderMonthlyRecords() {
    const currentMonth = currentDate.substring(0, 7); // YYYY-MM
    const monthRecords = records.filter(r => r.date && r.date.startsWith(currentMonth));
    
    // データが入力されているレコード（製品名が空でない）
    const validRecords = monthRecords.filter(r => r.product && r.product.trim() !== '');

    // 1. 月間サマリー
    const uniqueDays = new Set(validRecords.map(r => r.date));
    const totalCount = validRecords.length;

    // 製品別集計
    const productMap = {};
    validRecords.forEach(r => {
        const p = r.product.trim();
        productMap[p] = (productMap[p] || 0) + 1;
    });

    const productsCount = Object.keys(productMap).length;

    // DOM更新: サマリー
    const daysEl = document.getElementById('saidan-month-days-count');
    const totalEl = document.getElementById('saidan-month-total-count');
    const prodsEl = document.getElementById('saidan-month-products-count');

    if (daysEl) daysEl.textContent = `${uniqueDays.size} 日`;
    if (totalEl) totalEl.textContent = `${totalCount} 件`;
    if (prodsEl) prodsEl.textContent = `${productsCount} 種`;

    // 2. 製品別集計リスト
    const productListContainer = document.getElementById('saidan-monthly-products-list');
    if (productListContainer) {
        if (productsCount === 0) {
            productListContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">今月のデータはありません。</p>';
        } else {
            const sortedProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]);
            productListContainer.innerHTML = sortedProducts.map(([name, count]) => `
                <div class="monthly-product-item">
                    <div class="monthly-product-name" title="${name}">${name}</div>
                    <div class="monthly-product-count">${count} 件</div>
                </div>
            `).join('');
        }
    }

    // 3. 月間日別詳細履歴
    const dailyListContainer = document.getElementById('saidan-monthly-daily-list');
    if (dailyListContainer) {
        if (validRecords.length === 0) {
            dailyListContainer.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">今月の記録はありません</td></tr>';
            return;
        }

        // 日付の新しい順（または古い順）でソート
        const sortedRecords = validRecords.slice().sort((a, b) => b.date.localeCompare(a.date) || (a.startTime || '').localeCompare(b.startTime || ''));

        let html = '';
        let lastDate = '';

        sortedRecords.forEach(r => {
            if (r.date !== lastDate) {
                const dateParts = r.date.split('-');
                const d = new Date(r.date);
                const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
                const dayStr = `${dateParts[0]}年${dateParts[1]}月${dateParts[2]}日（${dayNames[d.getDay()]}）`;

                html += `
                    <tr class="date-group-row">
                        <td colspan="6">${dayStr}</td>
                    </tr>
                `;
                lastDate = r.date;
            }

            const hasNote = r.notes && r.notes.trim() !== '';
            // エスケープ処理して安全に属性に埋め込む
            const safeNote = hasNote ? r.notes.trim().replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '';

            const noteHtml = hasNote ? `
                <div class="month-note-cell-content" onclick="openSaidanNoteModal('${safeNote.replace(/\n/g, '\\n')}')" title="タップして全文を表示">
                    <span class="note-text-snippet">${r.notes.trim()}</span>
                    <span style="font-size: 0.75rem;">🔍</span>
                </div>
            ` : '<span style="color: var(--text-muted);">-</span>';

            html += `
                <tr>
                    <td class="col-date" style="color: var(--text-muted); font-size: 0.85rem;">${r.date}</td>
                    <td style="font-weight: 600; text-align: center;">${r.product}</td>
                    <td style="text-align: center;">${r.startTime || '-'}</td>
                    <td style="text-align: center;">${r.endTime || '-'}</td>
                    <td style="text-align: center;">${r.worker || '-'}</td>
                    <td class="month-note-td">${noteHtml}</td>
                </tr>
            `;
        });

        dailyListContainer.innerHTML = html;
    }
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

    const navItems = sidebar.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => toggleMenu(false));
    });
}

// Add record
function handleAddRecord(e) {
    e.preventDefault();
    const productInput = document.getElementById('saidan-product');
    const startTimeInput = document.getElementById('saidan-start-time');
    const endTimeInput = document.getElementById('saidan-end-time');
    const workerInput = document.getElementById('saidan-worker');
    const noteInput = document.getElementById('saidan-note');

    startTimeInput.value = normalizeTime(startTimeInput.value);
    endTimeInput.value = normalizeTime(endTimeInput.value);

    // If there is an empty row among the minimum rows, use it first or push new
    const dayRecords = records.filter(r => r.date === currentDate);
    const emptyRecord = dayRecords.find(r => (!r.product || r.product.trim() === '') && (!r.notes || r.notes.trim() === ''));

    if (emptyRecord) {
        emptyRecord.product = productInput.value.trim();
        emptyRecord.startTime = startTimeInput.value;
        emptyRecord.endTime = endTimeInput.value;
        emptyRecord.worker = workerInput ? workerInput.value.trim() : '';
        emptyRecord.notes = noteInput ? noteInput.value.trim() : '';
    } else {
        const record = {
            id: Date.now() + Math.random(),
            date: currentDate,
            product: productInput.value.trim(),
            startTime: startTimeInput.value,
            endTime: endTimeInput.value,
            worker: workerInput ? workerInput.value.trim() : '',
            notes: noteInput ? noteInput.value.trim() : ''
        };
        records.push(record);
    }

    saveRecords();
    renderRecords();
    if (currentView === 'month') renderMonthlyRecords();
    productInput.value = '';
    if (workerInput) workerInput.value = '';
    if (noteInput) noteInput.value = '';
}

// Save records
function saveRecords() {
    if (window.SharedSync && !SharedSync.canWrite()) return false;

    try {
        localStorage.setItem(LS_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('LocalStorage save failed:', e);
    }

    if (recordsSync) return recordsSync.save(records);
    return false;
}

// Update record field
function updateRecord(id, field, value) {
    const record = records.find(r => r.id == id);
    if (!record) return;
    record[field] = value;
    saveRecords();
    updateCountDisplay();
    if (currentView === 'month') renderMonthlyRecords();
}

function updateCountDisplay() {
    const dayRecords = records.filter(r => r.date === currentDate);
    const activeCount = dayRecords.filter(r => r.product && r.product.trim() !== '').length;
    const countEl = document.getElementById('saidan-record-count');
    if (countEl) {
        countEl.textContent = `${activeCount} 件`;
    }
}

// Textarea auto-resize helper
function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(42, el.scrollHeight) + 'px';
}

// Render records (Idea C: 2-Row Card Structure)
function renderRecords() {
    ensureMinRows(currentDate);
    const container = document.getElementById('saidan-items-container');
    const dayRecords = records.filter(r => r.date === currentDate);

    updateCountDisplay();

    container.innerHTML = '';

    dayRecords.forEach((record, index) => {
        const itemCard = document.createElement('div');
        itemCard.className = 'saidan-item-card';

        itemCard.innerHTML = `
            <!-- 1段目: 番号, 製品名/稼働内容, 開始, 終了, 作業者 -->
            <div class="saidan-row-top">
                <span class="row-number">${index + 1}</span>
                <input type="text" class="saidan-inline-input" value="${record.product || ''}"
                       placeholder="製品名を入力"
                       onblur="updateRecord(${record.id}, 'product', this.value)">
                <input type="text" class="saidan-inline-input time-input" value="${record.startTime || ''}"
                       placeholder="開始" inputmode="numeric" onfocus="this.select()"
                       onblur="this.value = normalizeTime(this.value); updateRecord(${record.id}, 'startTime', this.value)">
                <input type="text" class="saidan-inline-input time-input" value="${record.endTime || ''}"
                       placeholder="終了" inputmode="numeric" onfocus="this.select()"
                       onblur="this.value = normalizeTime(this.value); updateRecord(${record.id}, 'endTime', this.value)">
                <input type="text" class="saidan-inline-input time-input" value="${record.worker || ''}"
                       placeholder="作業者"
                       onblur="updateRecord(${record.id}, 'worker', this.value)">
            </div>
            <!-- 2段目: 備考欄 (幅100%・文章量に応じて縦に自動で伸びるテキストエリア) -->
            <div class="saidan-row-bottom">
                <span class="notes-label">📝 備考</span>
                <textarea class="saidan-notes-textarea" placeholder="備考・特記事項を入力..."
                          oninput="autoResizeTextarea(this); updateRecord(${record.id}, 'notes', this.value)"
                          onblur="updateRecord(${record.id}, 'notes', this.value)">${record.notes || ''}</textarea>
            </div>
        `;
        container.appendChild(itemCard);

        // Render直後にtextareaの高さを初期調整
        const textarea = itemCard.querySelector('.saidan-notes-textarea');
        if (textarea) {
            setTimeout(() => autoResizeTextarea(textarea), 0);
        }
    });

    renderTrashList();
}

// Trash management
window.toggleSaidanTrash = function () {
    const panel = document.getElementById('saidan-trash-panel');
    const btn = document.getElementById('saidan-trash-toggle');
    if (!panel || !btn) return;
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        btn.innerText = '削除パネルを閉じる';
        renderTrashList();
    } else {
        panel.style.display = 'none';
        btn.innerText = '削除パネルを表示';
    }
};

function renderTrashList() {
    const listContainer = document.getElementById('saidan-trash-list');
    if (!listContainer) return;

    // Show records that have product or notes or worker
    const dayRecords = records.filter(r => r.date === currentDate && ((r.product && r.product.trim() !== '') || (r.notes && r.notes.trim() !== '') || (r.worker && r.worker.trim() !== '')));
    listContainer.innerHTML = '';

    if (dayRecords.length === 0) {
        listContainer.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">削除できる入力済み項目がありません。</p>';
        return;
    }

    dayRecords.forEach(record => {
        const chip = document.createElement('div');
        chip.className = 'saidan-trash-chip';
        chip.innerHTML = `
            <span style="font-weight: 600; color: #c53030;">${record.product || '(未入力)'}</span>
            <span style="color: #718096;">${record.worker ? record.worker + ' / ' : ''}${record.startTime || ''} - ${record.endTime || ''}</span>
            <svg width="12" height="12" fill="#e53e3e" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
        `;
        chip.onclick = () => deleteRecord(record.id);
        listContainer.appendChild(chip);
    });
}

function deleteRecord(id) {
    if (confirm('この項目を削除（リセット）してもよろしいですか？')) {
        const dayRecords = records.filter(r => r.date === currentDate);
        if (dayRecords.length > MIN_ROWS) {
            records = records.filter(r => r.id != id);
        } else {
            const target = records.find(r => r.id == id);
            if (target) {
                target.product = '';
                target.notes = '';
                target.startTime = '';
                target.endTime = '';
                target.worker = '';
            }
        }

        saveRecords();
        renderRecords();
        if (currentView === 'month') renderMonthlyRecords();
    }
}

// Expose functions to global scope
window.updateRecord = updateRecord;
window.deleteRecord = deleteRecord;
window.normalizeTime = normalizeTime;
window.autoResizeTextarea = autoResizeTextarea;
window.switchSaidanView = switchSaidanView;
window.openSaidanNoteModal = openSaidanNoteModal;
window.closeSaidanNoteModal = closeSaidanNoteModal;

init();
