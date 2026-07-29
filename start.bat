@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo 需要先安装 Node.js 18+ 和 npm。
  pause
  exit /b 1
)

if not exist "node_modules" call npm install
if not exist "frontend\node_modules" call npm --prefix frontend install

call npm run dev
