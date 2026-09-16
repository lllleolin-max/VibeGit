@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto missing_node

where git >nul 2>&1
if errorlevel 1 goto missing_git

where pnpm >nul 2>&1
if errorlevel 1 goto missing_pnpm

if not exist "node_modules\electron\package.json" goto missing_dependencies

echo [VibeGit] Starting the desktop app. Please wait...
echo [VibeGit] Keep this window open while using the app.
call pnpm preview:desktop
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo [VibeGit] Node.js 24 or newer is required.
echo Install Node.js 24+, reopen this launcher, and try again.
pause
exit /b 1

:missing_git
echo [VibeGit] Git was not found in PATH.
echo Install Git, reopen this launcher, and try again.
pause
exit /b 1

:missing_pnpm
echo [VibeGit] pnpm was not found.
echo Install Node.js 24+ and pnpm, run pnpm install in this folder, then try again.
pause
exit /b 1

:missing_dependencies
echo [VibeGit] Project dependencies have not been installed.
echo Run pnpm install in this folder, then try again.
pause
exit /b 1

:failed
echo.
echo [VibeGit] Startup failed. Keep this window open and share the error above.
pause
exit /b 1
