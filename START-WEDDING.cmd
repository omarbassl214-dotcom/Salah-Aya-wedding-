@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo يرجى تثبيت Node.js 24 أو أحدث ثم تشغيل هذا الملف مجددًا.
  pause
  exit /b 1
)
echo جارٍ تشغيل دعوة زفاف صلاح وآية...
echo http://localhost:3000
node server.mjs
pause
