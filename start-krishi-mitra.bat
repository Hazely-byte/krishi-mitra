@echo off
setlocal
cd /d "%~dp0"

echo ====================================================
echo Starting Krishi Mitra (Server + Tailscale HTTPS)
echo ====================================================

:: 1. Check if Node server is already running on port 3000
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Node server is already running on port 3000.
) else (
    echo [INFO] Starting Node server in background...
    start "Krishi Mitra Server" node server.js
    timeout /t 2 /nobreak >nul 2>&1 || ping 127.0.0.1 -n 3 >nul
)

:: 2. Ensure Tailscale is running
tailscale status >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Starting Tailscale...
    tailscale up
    timeout /t 2 /nobreak >nul 2>&1
)

:: 3. Activate Tailscale Serve (HTTPS proxy to local HTTP server)
::    This gives tablet/mobile a real https:// origin for getUserMedia (mic access)
echo [INFO] Ensuring Tailscale Serve is active on http://localhost:3000...
tailscale serve --bg http://localhost:3000 >nul 2>&1

:: 4. Print status and access URLs
echo.
echo ====================================================
echo   KRISHI MITRA IS READY!
echo ====================================================
echo.
echo   Local:     http://localhost:3000/
echo   Tailscale: https://desktop-j1b4dl2.tail9c124d.ts.net/
echo.
echo   The Tailscale URL provides real HTTPS, which is
echo   required for microphone access on mobile devices.
echo.
tailscale serve status 2>nul
echo ====================================================
echo.

endlocal
