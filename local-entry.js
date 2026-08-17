(function () {
    'use strict';

    // file:// pages do not share the same browser origin as the deployed app.
    // Always move an active local page to the local HTTP server first.
    if (window.location.protocol !== 'file:') return;

    const activePages = new Set(['index.html', '1f.html', '1f-kenpin.html', 'saidan.html']);
    const fileName = decodeURIComponent(window.location.pathname.split(/[\\/]/).pop() || 'index.html');
    const page = activePages.has(fileName) ? fileName : 'index.html';
    const target = new URL(`http://127.0.0.1:8765/${page}`);
    target.search = window.location.search;
    target.hash = window.location.hash;

    window.location.replace(target.href);
})();
