'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const PAGE_FILES = ['index.html', '1f.html', '1f-kenpin.html', 'saidan.html', '\u30b7\u30d5\u30c8\u8868 - \u30b3\u30d4\u30fc/index.html'];
const SOURCE_FILES = [
    ...PAGE_FILES,
    'app.js', 'shared-sync.js', 'firebase-storage.js', '1f-app.js', '1f-kenpin-app.js', 'saidan-app.js', 'local-entry.js',
    'style.css', '1f-style.css', '\u30b7\u30d5\u30c8\u8868 - \u30b3\u30d4\u30fc/styles.css'
];

function renderBuild(fileName, source, buildId, buildNumber) {
    if (fileName === 'shared-sync.js' || fileName === 'firebase-storage.js') {
        source = source.replace(/(const BUILD_ID = ')[^']+(';)/, (_, start, end) => start + buildId + end)
            .replace(/(const BUILD_NUMBER = )\d+(;)/, (_, start, end) => start + buildNumber + end);
    } else if (fileName === 'app.js') {
        source = source.replace(/(const APP_BUILD_ID = ')[^']+(';)/, (_, start, end) => start + buildId + end)
            .replace(/(const APP_BUILD_NUMBER = )\d+(;)/, (_, start, end) => start + buildNumber + end);
    }

    if (!PAGE_FILES.includes(fileName)) return source;
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    for (const [name, value] of [['app-build-id', buildId], ['app-build-number', buildNumber]]) {
        const tag = `<meta name="${name}" content="${value}">`;
        const existing = new RegExp(`<meta\\b[^>]*\\bname=["']${name}["'][^>]*>`, 'i');
        if (existing.test(source)) source = source.replace(existing, tag);
        else source = source.replace(/(<meta\s+charset=[^>]+>)/i, `$1${newline}    ${tag}`);
    }

    return source.replace(/\b(src|href)=(["'])([^"']+)\2/g, (match, attribute, quote, value) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return match;
        const url = new URL(value, 'https://release.invalid/');
        if (!/\.(js|css)$/i.test(url.pathname)) return match;
        url.searchParams.set('v', buildId);
        const relativePath = value.match(/^[^?#]*/)[0];
        return `${attribute}=${quote}${relativePath}?${url.searchParams}${url.hash}${quote}`;
    });
}

function sourceHash(sources) {
    const hash = createHash('sha256');
    for (const [fileName, source] of sources) {
        hash.update(fileName + '\0');
        hash.update(renderBuild(fileName, source, '__BUILD_ID__', 0).replace(/\r\n/g, '\n'));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function releaseDate(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.year + values.month + values.day;
}

function prepareRelease(root = __dirname, { check = false, date = new Date() } = {}) {
    const metadataPath = path.join(root, 'app-version.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, ''));
    const sources = new Map(SOURCE_FILES.map(fileName => [fileName, fs.readFileSync(path.join(root, fileName), 'utf8')]));
    const fingerprint = sourceHash(sources);
    const aligned = [...sources].every(([fileName, source]) =>
        source === renderBuild(fileName, source, metadata.buildId, metadata.buildNumber));
    if (metadata.sourceHash === fingerprint && aligned) return { changed: false, ...metadata };
    if (check) throw new Error('Release files are out of date. Run npm run release:prepare before publishing.');

    const stamp = releaseDate(date);
    const buildNumber = Math.max((Number(metadata.buildNumber) || 0) + 1, Number(stamp + '01'));
    const buildId = `${stamp}-release-${buildNumber}`;
    const next = { ...metadata, buildId, buildNumber, sourceHash: fingerprint };
    for (const [fileName, source] of sources) {
        const rendered = renderBuild(fileName, source, buildId, buildNumber);
        if (source !== rendered) fs.writeFileSync(path.join(root, fileName), rendered);
    }
    fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2) + '\n');
    return { changed: true, ...next };
}

if (require.main === module) {
    try {
        const result = prepareRelease(__dirname, { check: process.argv.includes('--check') });
        console.log(`${result.changed ? 'Prepared' : 'Checked'} release ${result.buildId}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { PAGE_FILES, SOURCE_FILES, renderBuild, prepareRelease };
