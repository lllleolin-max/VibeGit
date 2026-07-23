@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 goto missing_pnpm

echo [VibeGit] Starting the desktop app. Please wait...
echo [VibeGit] Keep this window open while using the app.
call pnpm preview:desktop
if errorlevel 1 goto failed
exit /b 0

:missing_pnpm
echo [VibeGit] pnpm was not found.
echo Install Node.js 24+ and pnpm, run pnpm install in this folder, then try again.
pause
exit /b 1

:failed
echo.
echo [VibeGit] Startup failed. Keep this window open and share the error above.
pause
exit /b 1
