const fs = require('fs');

const initialData = JSON.parse(fs.readFileSync('snowsprint_data.json', 'utf8'));

let mData = initialData['2025-5'];
const ROLL_DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const STOCK_LOW_THRESHOLD = 5;
const snowsprintCurrentYear = 2026;
const snowsprintCurrentMonth = 3;

function isRollHoliday() { return false; }

function getSnowsprintBalance(dataObj, maxDay) {
    let rem = dataObj.carryover || 0;
    for (let i = 1; i <= maxDay; i++) {
        const d = dataObj.days[i];
        if (d) {
            rem += (d.arrival || 0) - (d.usage || 0);
        }
    }
    return rem;
}

let logs = [];

function renderSnowsprintGeneric(headId, bodyId, footId, configGroups, category) {
    logs.push("Start render: " + headId);
    
    let trMain = '<tr class="header-main-stock"><th rowspan="3" class="date-col-stock">日付</th>';
    let trSub1 = '<tr class="header-sub-stock">';
    let trSub2 = '<tr class="header-sub-stock">';
    
    // Simulate setting head.innerHTML
    logs.push("Head built for " + headId);

    if (!mData) return;
    const secData = mData[category] || {};

    const getObj = (t1, t2) => {
        if (!secData[t1]) secData[t1] = {};
        if (!secData[t1][t2]) secData[t1][t2] = { carryover: 0, days: {} };
        return secData[t1][t2];
    };

    let carryRow = '<tr><td>前月繰越</td>';
    try {
        configGroups.forEach(group => {
            group.items.forEach(item => {
                const dataObj = getObj(group.id, item.id);
                carryRow += `<td>carry...</td>`;
            });
        });
        carryRow += '</tr>';
        
        const daysInMonth = new Date(snowsprintCurrentYear, snowsprintCurrentMonth, 0).getDate();
        let bodyRows = '';
        
        for (let d = 1; d <= daysInMonth; d++) {
            const isHoliday = isRollHoliday(snowsprintCurrentYear, snowsprintCurrentMonth, d);
            const dObj = new Date(snowsprintCurrentYear, snowsprintCurrentMonth - 1, d);
            const dayOfWeek = dObj.getDay();
            
            bodyRows += `<tr data-day="${d}"><td>${d}</td>`;
                
            configGroups.forEach(group => {
                group.items.forEach(item => {
                    const dataObj = getObj(group.id, item.id);
                    const dayData = (dataObj.days && dataObj.days[d]) || {};
                    const arr = dayData.arrival || '';
                    const bal = getSnowsprintBalance(dataObj, d);
                    
                    bodyRows += `<td>test string ${bal}</td>`;
                });
            });
            bodyRows += '</tr>';
        }
        logs.push("Body Rows formed successfully! Length: " + bodyRows.length);
    } catch(err) {
        logs.push("Error caught: " + err.stack);
    }
}

// 1
renderSnowsprintGeneric('snHeadTable1', 'snBodyTable1', 'snFootTable1', [
    { id: 'small', title: '小', bg: '#bae6fd', color: '#0369a1', items: [
        { id: 'metal', title: '金具', bg: '#e0f2fe' },
        { id: 'inner_box', title: '中箱', bg: '#e0f2fe' },
        { id: 'outer_box', title: '外箱', bg: '#e0f2fe' }
    ]},
    { id: 'medium', title: '中', bg: '#7dd3fc', color: '#0c4a6e', items: [
        { id: 'metal', title: '金具', bg: '#e0f2fe' },
        { id: 'inner_box', title: '中箱', bg: '#e0f2fe' },
        { id: 'outer_box', title: '外箱', bg: '#e0f2fe' }
    ]}
], 'sn2');

fs.writeFileSync('test_render_log.txt', logs.join('\n'));
