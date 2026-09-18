@echo off
title MediaHub NFC Station Kiosk
echo ===================================================
echo   MediaHub NFC Station - Dedicated Laptop Kiosk
echo ===================================================
echo.
echo Launching NFC Station in dedicated app window...

:: Target URL - change this if your site is hosted on a remote server/domain
set STATION_URL=http://localhost:3000/dashboard/nfc

:: Launch in Microsoft Edge application mode
start msedge.exe --app=%STATION_URL%
if %ERRORLEVEL% neq 0 (
  start chrome.exe --app=%STATION_URL%
)

exit
