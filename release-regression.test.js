'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { PAGE_FILES, SOURCE_FILES, prepareRelease } = require('./prepare-release');

test('release preparation aligns all entries and assets without altering data and is repeatable', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nippo-release-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.match(path.basename(root), /^nippo-release-/);
        fs.rmSync(root, { recursive: true, force: true });
    });
    for (const file of SOURCE_FILES) {
        const destination = path.join(root, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(__dirname, file), destination);
    }
    fs.writeFileSync(path.join(root, 'app-version.json'), JSON.stringify({ buildId: 'old', buildNumber: 2026102055 }));
    fs.writeFileSync(path.join(root, 'existing-data.json'), '{"count":12345}');
    const date = new Date('2026-10-22T02:00:00Z');
    const first = prepareRelease(root, { date });
    assert.ok(first.buildNumber > 2026102055);
    assert.equal(prepareRelease(root, { check: true }).changed, false);
    assert.equal(prepareRelease(root, { date }).changed, false);
    for (const file of PAGE_FILES) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        assert.ok(html.includes(`<meta name="app-build-id" content="${first.buildId}">`));
        for (const [, , asset] of html.matchAll(/\b(src|href)="([^"]+)"/g)) {
            if (/^(?:https?:|\/\/)/.test(asset)) continue;
            const url = new URL(asset, 'http://localhost/');
            if (/\.(js|css)$/.test(url.pathname)) assert.equal(url.searchParams.get('v'), first.buildId, file + ': ' + asset);
        }
    }
    const beforeCheck = fs.readFileSync(path.join(root, 'app-version.json'), 'utf8');
    fs.appendFileSync(path.join(root, '1f-app.js'), '\n// changed input behavior\n');
    assert.throws(() => prepareRelease(root, { check: true }), /out of date/);
    assert.equal(fs.readFileSync(path.join(root, 'app-version.json'), 'utf8'), beforeCheck);
    const second = prepareRelease(root, { date });
    assert.equal(second.buildNumber, first.buildNumber + 1);
    assert.equal(prepareRelease(root, { check: true }).changed, false);
    assert.equal(fs.readFileSync(path.join(root, 'existing-data.json'), 'utf8'), '{"count":12345}');
});
