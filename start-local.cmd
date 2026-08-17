@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required to start the local app.
    pause
    exit /b 1
)

start "2F Nippo local server" /min cmd /k node "%~dp0local-server.js"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765/index.html"

endlocal
