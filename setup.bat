@echo off
cd /d "%~dp0"

:: Gerekli modülleri kur
npm install async undici fast-json-stringify >nul 2>&1

:: sniper.js dosyasını çalıştır
node jsniper.js

pause
