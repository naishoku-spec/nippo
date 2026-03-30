const xlsx = require('xlsx');

// Read the file
const wb = xlsx.readFile('1階 日報.xlsx');
const sheetName = '一階検品機 日報';
const ws = wb.Sheets[sheetName];

// We want to find unique values in columns:
// 納入先 (likely Col C or so)
// 種類(設定) (likely Col D)
// 作業者 (likely Col P)
// Based on typical layout:
// 日(A), 納入先(B/C merged), 種類(D/E merged?), etc.
// Let's just scan all rows and pull data based on headers.

const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

// Find header row
let headerRowIdx = -1;
for (let i = 0; i < 20; i++) {
    if (data[i] && data[i].includes('納入先')) {
        headerRowIdx = i;
        break;
    }
}

if (headerRowIdx !== -1) {
    const headers = data[headerRowIdx];
    const customerIdx = headers.indexOf('納入先');
    // For 種類(設定), the exact string might be '種類(設定)'
    const typeIdx = headers.findIndex(h => h && h.toString().includes('種類'));
    const operatorIdx = headers.findIndex(h => h && h.toString().includes('作業者'));

    const customers = new Set();
    const types = new Set();
    const operators = new Set();

    for (let i = headerRowIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        if (customerIdx !== -1 && row[customerIdx]) customers.add(row[customerIdx].toString().trim());
        if (typeIdx !== -1 && row[typeIdx]) types.add(row[typeIdx].toString().trim());
        if (operatorIdx !== -1 && row[operatorIdx]) operators.add(row[operatorIdx].toString().trim());
    }

    console.log('Customers:', Array.from(customers).filter(x => x && x !== '/').sort());
    console.log('Types:', Array.from(types).filter(x => x && x !== '/').sort());
    console.log('Operators:', Array.from(operators).filter(x => x && x !== '/').sort());
} else {
    console.log('Header not found');
}
