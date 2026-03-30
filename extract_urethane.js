const fs = require('fs');
const XLSX = require('xlsx');

const appJsFile = 'app.js';
let appJsContent = fs.readFileSync(appJsFile, 'utf8');

const stratStr = 'const SNOWSPRINT_INITIAL_DATA = {';
const startIdx = appJsContent.indexOf(stratStr);
const endIdx = appJsContent.indexOf('};\n\nfunction initSnowsprint', startIdx);

if (startIdx === -1 || endIdx === -1) {
    console.error('Could not find SNOWSPRINT_INITIAL_DATA in app.js');
    process.exit(1);
}

const objStr = appJsContent.substring(startIdx + stratStr.length - 1, endIdx + 1);

let data;
try {
    data = eval('(' + objStr + ')');
} catch (e) {
    console.error('Failed to parse SNOWSPRINT_INITIAL_DATA:', e);
    process.exit(1);
}

const wb = XLSX.readFile('スノースプリント関係金具等資材在庫.xlsx');
const months = ['5月 ', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

function dateFromExcel(d) {
    if (typeof d === 'number') {
        return new Date(Math.round((d - 25569) * 86400 * 1000));
    }
    return new Date(d);
}

months.forEach((mStr, idx) => {
    let year = 2025;
    let numMonth = 5 + idx;
    if (numMonth > 12) { year++; numMonth -= 12; }
    
    let jsonKey = `${year}-${numMonth}`;
    
    if (!data[jsonKey]) data[jsonKey] = { sn2: {}, iwatsuki: {}, us: {} };
    if (!data[jsonKey].us) data[jsonKey].us = {};
    
    ['small', 'medium', 'large'].forEach(size => {
        if (!data[jsonKey].us[size]) data[jsonKey].us[size] = {};
        if (!data[jsonKey].us[size].urethane_thick) data[jsonKey].us[size].urethane_thick = { carryover: 0, days: {} };
        if (!data[jsonKey].us[size].urethane_thin) data[jsonKey].us[size].urethane_thin = { carryover: 0, days: {} };
    });

    const sheetName = 'USスプリント' + mStr;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    
    const rows = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: ''});
    
    let hasUrethane = false;
    for(let c=10; c<30; c++) {
        if (rows[3] && String(rows[3][c]).includes('ウレタン')) {
            hasUrethane = true; break;
        }
    }
    if (!hasUrethane) return;

    const cols = [
        { size: 'small', type: 'urethane_thick', c: 13 },
        { size: 'small', type: 'urethane_thin', c: 16 },
        { size: 'medium', type: 'urethane_thick', c: 19 },
        { size: 'medium', type: 'urethane_thin', c: 22 },
        { size: 'large', type: 'urethane_thick', c: 25 },
        { size: 'large', type: 'urethane_thin', c: 28 },
    ];
    
    cols.forEach(map => {
        let val = rows[4][map.c];
        if (typeof val === 'number') data[jsonKey].us[map.size][map.type].carryover = val;
    });

    for(let r=6; r<rows.length; r++) {
        let dateVal = rows[r][0];
        if (!dateVal || String(dateVal).includes('合計')) continue;
        
        let d = dateFromExcel(dateVal);
        if (isNaN(d.getTime())) continue;
        let dayNum = d.getDate();
        
        cols.forEach(map => {
            let arr = rows[r][map.c];
            let use = rows[r][map.c + 1];
            
            if (typeof arr === 'number' || typeof use === 'number') {
                if (!data[jsonKey].us[map.size][map.type].days[dayNum]) {
                    data[jsonKey].us[map.size][map.type].days[dayNum] = {};
                }
                if (typeof arr === 'number') data[jsonKey].us[map.size][map.type].days[dayNum].arrival = arr;
                if (typeof use === 'number') data[jsonKey].us[map.size][map.type].days[dayNum].usage = use;
            }
        });
    }
});

const newJsonStr = JSON.stringify(data, null, 2);
appJsContent = appJsContent.substring(0, startIdx) + `const SNOWSPRINT_INITIAL_DATA = ${newJsonStr};` + appJsContent.substring(endIdx + 1);

fs.writeFileSync(appJsFile, appJsContent, 'utf8');
console.log('Successfully updated SNOWSPRINT_INITIAL_DATA in app.js with US Urethane data!');
