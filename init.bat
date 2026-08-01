@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 is required.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required.
  exit /b 1
)

if not "%~1"=="" if /I not "%~1"=="--non-interactive" (
  echo Usage: init.bat [--non-interactive]
  exit /b 1
)

node scripts\init-environment.mjs
if errorlevel 1 exit /b 1
call npm ci
if errorlevel 1 exit /b 1

if /I "%~1"=="--non-interactive" (
  call npm run db:init
) else (
  call npm run db:init -- --interactive
)
if errorlevel 1 exit /b 1

echo booking.jc initialization complete. Run "npm run dev" to start development.
endlocal
