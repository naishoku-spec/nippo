const XLSX = require('xlsx');
const wb = XLSX.readFile('鼻ぽん在庫管理　.xlsx');

const sheetsToRead = wb.SheetNames;
const products = [
    { key: 'anaaki_s', name: '穴あき小さめ', caseCol: 18, pcsCol: 19 }
];

const multipliers = {};

sheetsToRead.forEach(function(s) {
    const ws = wb.Sheets[s];
    if (!ws || !ws['!ref']) return;
    
    products.forEach(function(p) {
        for (let r = 3; r <= 35; r++) {
            const caseCell = ws[XLSX.utils.encode_cell({r:r, c:p.caseCol})];
            const pcsCell = ws[XLSX.utils.encode_cell({r:r, c:p.pcsCol})];
            
            if (caseCell && pcsCell) {
                const cases = Number(caseCell.v);
                const pcs = Number(pcsCell.v);
                if (cases > 0 && pcs > 0 && !multipliers[p.key]) {
                    multipliers[p.key] = pcs / cases;
                    console.log('Found in sheet:', s, 'Multi:', multipliers[p.key]);
                }
            }
        }
    });
});

console.log('Multipliers (pcs per case):', multipliers);
