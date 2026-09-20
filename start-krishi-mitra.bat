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

:: 2. Ensure Tailscale Serve is active on http://localhost:3000
echo [INFO] Ensuring Tailscale Serve is active on http://localhost:3000...
tailscale serve --bg http://localhost:3000 >nul 2>&1

:: 3. Print Tailscale Serve status and access URL
echo.
echo ====================================================
echo 🌾 KRISHI MITRA IS READY!
echo ====================================================
tailscale serve status
echo.
for /f "tokens=1" %%a in ('tailscale serve status ^| findstr /i "https://"') do (
    echo Access via: %%a/
)
echo ====================================================
echo.

endlocal
