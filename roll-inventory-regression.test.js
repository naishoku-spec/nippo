'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('app.js', 'utf8');
const start = source.indexOf('function normalizeRollDays');
const end = source.indexOf('\n\n;', start);

assert.notStrictEqual(start, -1, 'normalizeRollDays must exist');
assert.notStrictEqual(end, -1, 'roll normalization block must be extractable');

const context = {
    ROLL_TYPES: ['film', 'plain', 'eog', 'plain2']
};
vm.runInNewContext(
    source.slice(start, end) + '\nthis.normalizeRollData = normalizeRollData;',
    context
);

function createMonth(days) {
    return {
        film: { carryover: 0, days },
        plain: { carryover: 0, days: {} },
        eog: { carryover: 0, days: {} },
        plain2: { carryover: 0, days: {} }
    };
}

const firebaseStyleDays = [];
firebaseStyleDays[1] = { delivery: 12, production: 1, _syncUpdatedAt: 100 };
const normalizedArray = context.normalizeRollData({ '2026-9': createMonth(firebaseStyleDays) });

assert.deepStrictEqual(
    JSON.parse(JSON.stringify(normalizedArray['2026-9'].film.days)),
    { '1': { delivery: 12, production: 1, _syncUpdatedAt: 100 } },
    'a Firebase array containing day 1 must not be erased'
);

const allDays = {};
for (let day = 1; day <= 31; day++) {
    allDays[String(day).padStart(2, '0')] = { delivery: day, production: day - 1 };
}
allDays['0'] = { delivery: 999 };
allDays['32'] = { delivery: 999 };

const normalizedAll = context.normalizeRollData({ '2026-10': createMonth(allDays) });
const normalizedDays = normalizedAll['2026-10'].film.days;

assert.strictEqual(Object.keys(normalizedDays).length, 31, 'all valid dates must remain');
for (let day = 1; day <= 31; day++) {
    assert.strictEqual(normalizedDays[String(day)].delivery, day, `day ${day} must remain`);
}
assert.strictEqual(normalizedDays['0'], undefined, 'day 0 must be rejected');
assert.strictEqual(normalizedDays['32'], undefined, 'day 32 must be rejected');

console.log('roll inventory regression tests passed');
