const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, 'スノースプリント関係金具等資材在庫.xlsx');
const wb = XLSX.readFile(filePath);

function excelDateToDay(serial) {
    if (typeof serial === 'string') {
        const parts = serial.split('-');
        return parseInt(parts[2]);
    }
    const date = new Date((serial - 25569) * 86400000);
    return date.getDate();
}

function extractTableData(ws, startRow, numCols) {
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const carryRow = data[startRow + 5] || [];
    
    // Build groups
    const numGroups = Math.floor((numCols - 1) / 3);
    const carryovers = [];
    for (let g = 0; g < numGroups; g++) {
        const c = 1 + g * 3;
        const carry = carryRow[c] || 0;
        carryovers.push(typeof carry === 'number' ? carry : 0);
    }
    
    // Extract days data
    const days = {};
    for (let r = startRow + 7; r < data.length; r++) {
        const row = data[r];
        if (!row || !row[0] || row[0] === '') break;
        
        const day = excelDateToDay(row[0]);
        const dayData = {};
        let hasData = false;
        
        for (let g = 0; g < numGroups; g++) {
            const c = 1 + g * 3;
            const arrival = row[c];
            const usage = row[c + 1];
            
            if ((arrival !== '' && arrival !== 0) || (usage !== '' && usage !== 0)) {
                dayData[g] = {};
                if (arrival !== '' && arrival !== 0) dayData[g].arrival = arrival;
                if (usage !== '' && usage !== 0) dayData[g].usage = usage;
                hasData = true;
            }
        }
        
        if (hasData) {
            days[day] = dayData;
        }
    }
    
    return { carryovers, days };
}

const result = { sn: {}, iw: {}, us: {} };

wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) return;
    
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    
    // Determine year/month
    let year, month;
    if (data[0]) {
        for (let c = 0; c < (data[0].length || 0); c++) {
            if (typeof data[0][c] === 'number' && data[0][c] >= 2024 && data[0][c] <= 2030) {
                year = data[0][c];
                month = data[0][c + 1];
                break;
            }
        }
    }
    if (!year) {
        const monthMatch = name.match(/(\d+)月/);
        if (monthMatch) {
            month = parseInt(monthMatch[1]);
            year = month >= 5 ? 2025 : 2026;
        }
    }
    if (!year || !month) return;
    const key = `${year}-${month}`;
    
    const trimName = name.trim();
    
    if (trimName.startsWith('スノースプリントⅡ')) {
        const table1 = extractTableData(ws, 0, 19);
        
        // Find second table
        let secondTableStart = -1;
        for (let r = 38; r < data.length; r++) {
            if (data[r] && data[r][0] === '種類') {
                secondTableStart = r - 3;
                break;
            }
        }
        let table2 = null;
        if (secondTableStart >= 0) {
            table2 = extractTableData(ws, secondTableStart, 19);
        }
        
        result.sn[key] = { table1, table2 };
    } else if (trimName.startsWith('イワツキ用スノースプリント')) {
        const table1 = extractTableData(ws, 0, 22);
        result.iw[key] = { table1 };
    } else if (trimName.startsWith('USスプリント')) {
        const numCols = data[6] ? data[6].length : 31;
        const table1 = extractTableData(ws, 0, numCols);
        result.us[key] = { table1 };
    }
});

// Output in compact form for embedding in JS
console.log('const SNOWSPRINT_INITIAL_DATA = ' + JSON.stringify(result, null, 2) + ';');
