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

const isProduction = true; // 常に本番データ（Web）と同期するためにtrueに変更
const SECRET_KEY = 'nippo-report-secure-key-2026';
const DB_PATH = `${SECRET_KEY}/${isProduction ? '1f_kenpin_records' : '1f_kenpin_records_dev'}`;
const LS_KEY = isProduction ? '1f_kenpin_records' : '1f_kenpin_records_dev';

// How many blank rows to show (like Excel)
const BLANK_ROWS = 10;

// State
let records = JSON.parse(localStorage.getItem(LS_KEY)) || [];
let currentDate = new Date().toLocaleDateString('sv-SE');
let isFirstLoad = true;
let activeRecordId = null;
let recordsSync = null;

// Sync
function normalizeKenpinRecords(value) {
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
        normalize: normalizeKenpinRecords,
        pendingStorageKey: LS_KEY + '_pending_sync',
        mergeInitial: true,
        serverSnapshotStorageKey: LS_KEY + '_server_snapshot',
        getLocal: () => records,
        setLocal: value => {
            records = normalizeKenpinRecords(value);
            localStorage.setItem(LS_KEY, JSON.stringify(records));
        },
        onRemote: () => {
            const activeEl = document.activeElement;
            if (!activeEl || !activeEl.closest('#records-list-kenpin')) renderRecords();
        }
    });
}



function isJapaneseHoliday(dateStr) {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    const fixedHolidays = {
        '1-1': true, '2-11': true, '2-23': true, '4-29': true,
        '5-3': true, '5-4': true, '5-5': true, '7-21': true,
        '8-11': true, '9-23': true, '10-14': true, '11-3': true, '11-23': true
    };
    if (fixedHolidays[`${month}-${day}`]) return true;
    if (month === 3) {
        const vernalDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        if (day === vernalDay) return true;
    }
    if (month === 1 && d.getDay() === 1 && day >= 8 && day <= 14) return true;
    if (month === 9 && d.getDay() === 1 && day >= 15 && day <= 21) return true;
    if (month === 10 && d.getDay() === 1 && day >= 8 && day <= 14) return true;
    return false;
}

function init() {
    const datePicker = document.getElementById('current-date-picker');
    datePicker.value = currentDate;

    flatpickr(datePicker, {
        locale: "ja",
        defaultValue: currentDate,
        onChange: (selectedDates, dateStr) => {
            currentDate = dateStr;
            renderRecords();
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

    document.getElementById('add-row-btn').addEventListener('click', addBlankRow);
        
    // Add delete row binding
    const delBtn = document.getElementById('delete-row-btn');
    if (delBtn) delBtn.addEventListener('click', deleteSelectedRow);

    const notesTextarea = document.getElementById('notes-textarea');
    if (notesTextarea) {
        notesTextarea.addEventListener('change', function() {
            if (activeRecordId) {
                updateField(activeRecordId, 'notes', this.value);
            }
        });
    }

    // Sidebar
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const closeBtn = document.getElementById('sidebar-close-btn');

    hamburgerBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        overlay.style.display = 'block';
    });

    const closeMenu = () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    };

    closeBtn.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);

    renderRecords();
}

function deleteSelectedRow() {
    if (!activeRecordId) {
        alert('削除する行をクリックして選択してください。');
        return;
    }
    if (confirm('選択中の行を削除しますか？')) {
        records = records.filter(r => r.id !== activeRecordId);
        activeRecordId = null;
        save();
        renderRecords();
        
        // Hide panel if it was open
        const panel = document.getElementById('notes-panel');
        if (panel) panel.classList.remove('active');
    }
}

function calculateDuration(start, end) {
    if (!start || !end) return "：";
    const s = start.split(':').map(Number);
    const e = end.split(':').map(Number);
    let diff = (e[0] * 60 + e[1]) - (s[0] * 60 + s[1]);
    if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}：${m.toString().padStart(2, '0')}`;
}

function calculateDefectRate(r) {
    const totalReject = (r.rejectUp || 0) + (r.rejectDown || 0) + (r.rejectA || 0) + (r.rejectB || 0) + (r.rejectSide || 0);
    if (!r.productCount) return '';
    return ((totalReject / r.productCount) * 100).toFixed(2);
}

function addBlankRow() {
    const record = {
        id: Date.now() + Math.random(),
        date: currentDate,
        customer: '',
        type: '',
        lot: '',
        startTime: '',
        endTime: '',
        orderCount: 0,
        productCount: 0,
        rejectUp: 0,
        rejectDown: 0,
        rejectA: 0,
        rejectB: 0,
        rejectSide: 0,
        operator: '',
        notes: ''
    };
    records.push(record);
    save();
    renderRecords();
}

function selectRecord(id) {
    activeRecordId = id;
    
    // Highlight correct row without re-rendering to prevent focus loss
    document.querySelectorAll('#kenpin-spreadsheet tr').forEach(row => row.classList.remove('active-row'));
    const rowEl = document.querySelector(`tr[data-id="${id}"]`);
    if (rowEl) rowEl.classList.add('active-row');
    
    const r = records.find(x => x.id == id);
    if (!r) return;
    
    const panel = document.getElementById('notes-panel');
    if (panel) {
        panel.classList.add('active');
        document.getElementById('notes-panel-title').innerText = r.customer || '(納入先未設定)';
        document.getElementById('notes-textarea').value = r.notes || '';
    }
}

function renderRecords() {
    const list = document.getElementById('records-list-kenpin');
    const dayRecords = records.filter(r => r.date === currentDate);
    list.innerHTML = '';

    const dateParts = currentDate.split('-');
    const dayLabel = `${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;

    // Render existing records
    dayRecords.forEach((r, idx) => {
        const rate = calculateDefectRate(r);
        const duration = calculateDuration(r.startTime, r.endTime);

        const tr = document.createElement('tr');
        tr.setAttribute('data-id', r.id);
        if (activeRecordId === r.id) tr.classList.add('active-row');
        
        // Use mousedown instead of click to prevent input focus race condition issues
        tr.addEventListener('mousedown', () => {
            if (activeRecordId !== r.id) selectRecord(r.id);
        });

        tr.innerHTML = `
            <td class="cell-day">${idx === 0 ? dayLabel : '/'}</td>
            <td><input type="text" class="cell-input" list="customersList" value="${r.customer || ''}" title="${r.customer || ''}" onblur="updateField(${r.id}, 'customer', this.value)"></td>
            <td><input type="text" class="cell-input" list="typesList" value="${r.type || ''}" title="${r.type || ''}" onblur="updateField(${r.id}, 'type', this.value)"></td>
            <td><input type="text" class="cell-input" value="${r.lot || ''}" title="${r.lot || ''}" onblur="updateField(${r.id}, 'lot', this.value)"></td>
            <td><input type="time" class="cell-input" value="${r.startTime || ''}" onchange="updateField(${r.id}, 'startTime', this.value)"></td>
            <td><input type="time" class="cell-input" value="${r.endTime || ''}" onchange="updateField(${r.id}, 'endTime', this.value)"></td>
            <td class="cell-readonly">${duration}</td>
            <td><input type="number" class="cell-input" value="${r.orderCount || ''}" onblur="updateField(${r.id}, 'orderCount', this.value)"></td>
            <td><input type="number" class="cell-input" value="${r.productCount || ''}" onblur="updateField(${r.id}, 'productCount', this.value)"></td>
            <td><input type="number" class="cell-input" value="${r.rejectUp || ''}" onblur="updateField(${r.id}, 'rejectUp', this.value)"></td>
            <td><input type="number" class="cell-input" value="${r.rejectDown || ''}" onblur="updateField(${r.id}, 'rejectDown', this.value)"></td>
            <td><input type="number" class="cell-input" value="${r.rejectA || ''}" onblur="updateField(${r.id}, 'rejectA', this.value)"></td>
            <td><input type="number" class="cell-input" value="${r.rejectB || ''}" onblur="updateField(${r.id}, 'rejectB', this.value)"></td>
            <td><input type="number" class="cell-input" value="${r.rejectSide || ''}" onblur="updateField(${r.id}, 'rejectSide', this.value)"></td>
            <td class="cell-rate">${rate ? rate + '%' : ''}</td>
            <td><input type="text" class="cell-input" list="operatorsList" value="${r.operator || ''}" onblur="updateField(${r.id}, 'operator', this.value)"></td>
        `;
        list.appendChild(tr);
    });

    // Add blank rows to fill out spreadsheet (like Excel)
    const blankNeeded = Math.max(0, BLANK_ROWS - dayRecords.length);
    for (let i = 0; i < blankNeeded; i++) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="cell-day">/</td>
            <td><input type="text" class="cell-input blank-input" data-field="customer" list="customersList"></td>
            <td><input type="text" class="cell-input blank-input" data-field="type" list="typesList"></td>
            <td><input type="text" class="cell-input blank-input" data-field="lot"></td>
            <td><input type="time" class="cell-input blank-input" data-field="startTime"></td>
            <td><input type="time" class="cell-input blank-input" data-field="endTime"></td>
            <td class="cell-readonly">：</td>
            <td><input type="number" class="cell-input blank-input" data-field="orderCount"></td>
            <td><input type="number" class="cell-input blank-input" data-field="productCount"></td>
            <td><input type="number" class="cell-input blank-input" data-field="rejectUp"></td>
            <td><input type="number" class="cell-input blank-input" data-field="rejectDown"></td>
            <td><input type="number" class="cell-input blank-input" data-field="rejectA"></td>
            <td><input type="number" class="cell-input blank-input" data-field="rejectB"></td>
            <td><input type="number" class="cell-input blank-input" data-field="rejectSide"></td>
            <td class="cell-rate"></td>
            <td><input type="text" class="cell-input blank-input" data-field="operator" list="operatorsList"></td>
        `;
        // Auto-create record on input in blank row
        const inputs = tr.querySelectorAll('.blank-input');
        inputs.forEach(input => {
            input.addEventListener('blur', function() {
                if (this.value.trim()) {
                    createRecordFromBlank(this);
                }
            });
        });
        list.appendChild(tr);
    }
}

function createRecordFromBlank(inputEl) {
    const record = {
        id: Date.now() + Math.random(),
        date: currentDate,
        customer: '',
        type: '',
        lot: '',
        startTime: '',
        endTime: '',
        orderCount: 0,
        productCount: 0,
        rejectUp: 0,
        rejectDown: 0,
        rejectA: 0,
        rejectB: 0,
        rejectSide: 0,
        operator: '',
        notes: ''
    };
    const field = inputEl.getAttribute('data-field');
    record[field] = inputEl.value;
    records.push(record);
    save();
    renderRecords();
}

function updateField(id, field, val) {
    const r = records.find(x => x.id == id);
    if (!r) return;
    
    let parsedVal = val;
    if (['productCount', 'rejectUp', 'rejectDown', 'rejectA', 'rejectB', 'rejectSide', 'orderCount'].includes(field)) {
        parsedVal = parseInt(val) || 0;
    }
    
    // Prevent redundant saves/renders if nothing actually changed
    if (String(r[field]) === String(parsedVal)) return;

    r[field] = parsedVal;
    save();
    renderRecords();
}

function deleteRec(id) {
    if (!confirm('削除しますか？')) return;
    records = records.filter(x => x.id != id);
    save();
    renderRecords();
}

function save() {
    if (window.SharedSync && !SharedSync.canWrite()) return false;

    localStorage.setItem(LS_KEY, JSON.stringify(records));

    if (recordsSync) return recordsSync.save(records);
    return false;
}

let isKeyboardNavigating = false;
let lastMouseX = -1;
let lastMouseY = -1;

// Global listener for auto-focus on intentional mouse movement only
document.addEventListener('mousemove', function(e) {
    if (Math.abs(e.clientX - lastMouseX) > 3 || Math.abs(e.clientY - lastMouseY) > 3) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        isKeyboardNavigating = false; // Mouse actively moved, unlock hover focus
    }
    
    if (!isKeyboardNavigating && e.target && e.target.classList && e.target.classList.contains('cell-input')) {
        if (document.activeElement !== e.target) {
            e.target.focus();
        }
    }
});

// Excel-style Keyboard Navigation
document.addEventListener('keydown', function(e) {
    isKeyboardNavigating = true; // Lock out mouse-hover while using keyboard
    
    if (!e.target || !e.target.classList || !e.target.classList.contains('cell-input')) return;
    
    // Ignore IME composition (Kanji conversion) so we don't jump cells while typing Japanese
    if (e.isComposing || e.keyCode === 229) return;
    
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;
    
    e.preventDefault(); // Stop natural scroll or cursor wrap
    
    const input = e.target;
    const tr = input.closest('tr');
    if (!tr) return;
    
    const tbody = tr.parentElement;
    const rows = Array.from(tbody.children);
    const rowIndex = rows.indexOf(tr);
    
    const rowInputs = Array.from(tr.querySelectorAll('.cell-input'));
    const colIndex = rowInputs.indexOf(input);
    
    let targetRowIndex = rowIndex;
    let targetColIndex = colIndex;
    
    if (e.key === 'ArrowUp') targetRowIndex--;
    if (e.key === 'ArrowDown') targetRowIndex++;
    if (e.key === 'ArrowLeft') targetColIndex--;
    if (e.key === 'ArrowRight') targetColIndex++;
    if (e.key === 'Enter') {
        // Enter moves Right, and wraps to next row when at the end
        targetColIndex++;
        if (targetColIndex >= rowInputs.length) {
            targetColIndex = 0;
            targetRowIndex++;
        }
    }
    
    if (targetRowIndex >= 0 && targetRowIndex < rows.length) {
        const targetRow = rows[targetRowIndex];
        const targetInputs = Array.from(targetRow.querySelectorAll('.cell-input'));
        if (targetColIndex >= 0 && targetColIndex < targetInputs.length) {
            targetInputs[targetColIndex].focus();
        }
    }
});

window.updateField = updateField;
window.deleteRec = deleteRec;

init();
