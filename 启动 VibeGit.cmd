@echo off
set "VIBEGIT_NODE_BIN=C:\Users\34178\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "VIBEGIT_PNPM=C:\Users\34178\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

if not exist "%VIBEGIT_NODE_BIN%\node.exe" goto missing_node
if not exist "%VIBEGIT_PNPM%" goto missing_pnpm

set "PATH=%VIBEGIT_NODE_BIN%;%PATH%"
cd /d "%~dp0"
echo [VibeGit] Starting local browser mode. Please wait...
echo [VibeGit] Keep this window open while using the app.
call "%VIBEGIT_PNPM%" preview:browser
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo [VibeGit] Node.js runtime was not found.
echo Install Node.js 24 or update VIBEGIT_NODE_BIN in this launcher.
pause
exit /b 1

:missing_pnpm
echo [VibeGit] pnpm runtime was not found.
pause
exit /b 1

:failed
echo.
echo [VibeGit] Startup failed. Keep this window open and share the error above.
pause
exit /b 1
