@echo off
REM TorrentSearch Web one-click startup script (Windows)
REM Usage: double-click or run: start.cmd [dev|prod|build]
REM   no arg = dev mode
REM   prod   = production mode (build then start)
REM   build  = build only

setlocal
cd /d "%~dp0webapp"
if errorlevel 1 (
  echo [ERROR] webapp directory not found
  pause
  exit /b 1
)

REM Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 20+.
  echo         Download: https://nodejs.org/
  pause
  exit /b 1
)

REM Install dependencies on first run
if not exist "node_modules" (
  echo [INFO] First run, installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed
    pause
    exit /b 1
  )
)

REM Pick mode
set "MODE=%1"
if "%MODE%"=="" set "MODE=dev"

if /i "%MODE%"=="dev" (
  echo [START] Dev mode (frontend :5173 / backend :3001)
  call npm run dev
  goto :end
)

if /i "%MODE%"=="build" (
  echo [BUILD] Production build...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
  )
  echo [OK] Build complete.
  goto :end
)

if /i "%MODE%"=="prod" (
  echo [BUILD] Production build...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
  )
  echo [START] Production mode (single port :3000)
  call npm start
  goto :end
)

echo [ERROR] Unknown argument: %MODE%
echo Usage: start.cmd [dev^|prod^|build]

:end
echo.
echo [INFO] Script finished. Press any key to close this window.
pause >nul
endlocal
