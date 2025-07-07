@echo off
cd /d "%~dp0"

:: Install Modules
npm install async undici fast-json-stringify >nul 2>&1

:: Run the Sniper
node jsniper.js

pause
