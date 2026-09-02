@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing the local dependencies once...
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install
  ) else (
    call pnpm install
  )
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist config.json (
  copy config.example.json config.json >nul
)

cls
echo Parks Shuttle Bot
echo.
echo 1^) Parks Canada sign-in/contact/payment setup
echo 2^) Run for the official 8:00 a.m. Mountain Time release
echo 3^) Watch for cancellations
echo 4^) Safe rehearsal - never holds seats
echo 5^) Release preflight - selects the exact cell; never reserves
echo 6^) Checkout rehearsal - holds seats, never purchases
echo 7^) Verify current live booking controls - read-only
echo 8^) Quit
echo.
set "CHOICE="
set /p "CHOICE=Choose 1-8: "

powershell.exe -NoProfile -NonInteractive -Command "if ($env:CHOICE -notmatch '^[1-8]$') { exit 1 }"
if errorlevel 1 (
  echo Invalid choice.
  goto done
)

if "%CHOICE%"=="1" goto run_setup
if "%CHOICE%"=="2" goto dated
if "%CHOICE%"=="3" goto dated
if "%CHOICE%"=="4" goto dated
if "%CHOICE%"=="5" goto dated
if "%CHOICE%"=="6" goto dated
if "%CHOICE%"=="7" goto run_verify
if "%CHOICE%"=="8" exit /b 0
echo Invalid choice.
goto done

:run_setup
node src\assistant.mjs --setup
goto done

:run_verify
node scripts\verify-live-contract.mjs
goto done

:dated
set "TARGET_DATE="
set /p "TARGET_DATE=Trip date YYYY-MM-DD: "

powershell.exe -NoProfile -NonInteractive -Command "if ($env:TARGET_DATE -notmatch '^\d{4}-\d{2}-\d{2}$') { exit 1 }"
if errorlevel 1 (
  echo Invalid date. Use YYYY-MM-DD.
  goto done
)

if "%CHOICE%"=="2" goto run_release
if "%CHOICE%"=="3" goto run_watch
if "%CHOICE%"=="4" goto run_dryrun
if "%CHOICE%"=="5" goto run_preflight
if "%CHOICE%"=="6" goto run_checkouttest
goto done

:run_release
echo.
echo Keep this PC awake: set Power settings to Never sleep while plugged in.
node src\assistant.mjs --date "%TARGET_DATE%"
goto done

:run_watch
node src\assistant.mjs --watch --date "%TARGET_DATE%"
goto done

:run_dryrun
node src\assistant.mjs --dry-run --now --date "%TARGET_DATE%"
goto done

:run_preflight
node src\assistant.mjs --preflight --date "%TARGET_DATE%"
goto done

:run_checkouttest
echo.
echo This creates a temporary cart hold if seats are available.
echo It stops before any payment or final confirmation action.
set "CONFIRM_HOLD="
set /p "CONFIRM_HOLD=Type HOLD to continue: "
powershell.exe -NoProfile -NonInteractive -Command "if ($env:CONFIRM_HOLD -ine 'HOLD') { exit 1 }"
if errorlevel 1 (
  echo Checkout rehearsal cancelled.
  goto done
)
node src\assistant.mjs --checkout-test --date "%TARGET_DATE%"
goto done

:done
echo.
pause
