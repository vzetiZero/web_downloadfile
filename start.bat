@echo off
chcp 65001 >nul
title Web tai file ZIP
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Tai va cai dat tai https://nodejs.org
  pause
  exit /b 1
)
node server.js
pause
