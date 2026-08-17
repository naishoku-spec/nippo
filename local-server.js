'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8765);
const ROOT = path.resolve(__dirname);

const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function isInsideRoot(filePath) {
    const relative = path.relative(ROOT, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function send(response, statusCode, body, contentType) {
    response.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': contentType
    });
    if (response.req.method !== 'HEAD') response.end(body);
    else response.end();
}

const server = http.createServer((request, response) => {
    if (request.url === '/__local-health') {
        send(response, 200, 'ok', 'text/plain; charset=utf-8');
        return;
    }

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
    } catch (error) {
        send(response, 400, 'Bad Request', 'text/plain; charset=utf-8');
        return;
    }

    const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
    const filePath = path.resolve(ROOT, relativePath);
    if (!isInsideRoot(filePath)) {
        send(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
            send(response, 404, 'Not Found', 'text/plain; charset=utf-8');
            return;
        }

        fs.readFile(filePath, (readError, body) => {
            if (readError) {
                send(response, 500, 'Internal Server Error', 'text/plain; charset=utf-8');
                return;
            }
            const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()]
                || 'application/octet-stream';
            send(response, 200, body, contentType);
        });
    });
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Local server is already running at http://${HOST}:${PORT}`);
        process.exit(0);
    }
    console.error(error);
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    console.log(`Local app: http://${HOST}:${PORT}/index.html`);
    console.log('Close this window to stop the local server.');
});
