@echo off
setlocal EnableExtensions

REM ============================================================
REM  dsh-quota-widget -> DeepSeek Harness Desktop installer
REM
REM  Usage:
REM    1. Fully quit DeepSeek Harness Desktop first
REM       (tray icon -> Quit DeepSeek Harness)
REM    2. Double-click this script
REM    3. Reopen DeepSeek Harness Desktop
REM
REM  Optional: if Desktop is NOT installed at D:\DeepSeek Harness,
REM  set DSH_DESKTOP_DIR to its install directory first.
REM ============================================================

set "PLUGIN_DIR=%~dp0"
set "PLUGIN_NAME=dsh-quota-widget"
set "PLUGIN_VERSION=0.1.0"

if defined DSH_DESKTOP_DIR (
  set "DSH_CLI=%DSH_DESKTOP_DIR%\resources\runtime\cli\bin\dsh.cmd"
) else (
  set "DSH_CLI=D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
)

echo [1/4] Checking desktop dsh CLI...
if not exist "%DSH_CLI%" (
  echo.
  echo [ERROR] Desktop dsh CLI not found:
  echo         %DSH_CLI%
  echo         Make sure DeepSeek Harness Desktop is installed at D:\DeepSeek Harness,
  echo         or set DSH_DESKTOP_DIR to its install directory.
  goto :fail
)

echo [2/4] Checking whether DeepSeek Harness.exe is running...
tasklist 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo.
  echo [ERROR] DeepSeek Harness.exe is currently running.
  echo         Fully quit the desktop app first.
  echo         Tray icon -^> Quit DeepSeek Harness.
  echo         The desktop profile is locked while the app is running.
  goto :fail
)

echo [3/4] Packing the plugin tarball with npm...
pushd "%PLUGIN_DIR%"
call npm pack --pack-destination "%PLUGIN_DIR%"
if errorlevel 1 (
  echo.
  echo [ERROR] npm pack failed.
  echo         Install Node.js/npm and add it to PATH, then retry.
  echo.
  echo         Alternative without npm, install from the directory:
  echo         "%DSH_CLI%" plugin --profile desktop add "file:%PLUGIN_DIR%"
  popd
  goto :fail
)
popd

set "TGZ=%PLUGIN_DIR%%PLUGIN_NAME%-%PLUGIN_VERSION%.tgz"
if not exist "%TGZ%" (
  echo.
  echo [ERROR] Tarball was not created:
  echo         %TGZ%
  goto :fail
)

echo [4/4] Installing into desktop profile...
call "%DSH_CLI%" plugin --profile desktop add "file:%TGZ%"
if errorlevel 1 (
  echo.
  echo [ERROR] dsh plugin add failed. See output above.
  goto :fail
)

echo.
echo ============================================================
echo  SUCCESS!
echo  Reopen DeepSeek Harness Desktop.
echo  The quota widget should appear at the bottom-right corner.
echo  Settings entry: Settings -^> Opencode Quota
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo  INSTALL FAILED. See the messages above.
echo ============================================================
pause
exit /b 1