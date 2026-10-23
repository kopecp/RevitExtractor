@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Wymagany jest Node.js 24 lub nowszy.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
  echo Wymagany jest Node.js 24 lub nowszy.
  pause
  exit /b 1
)
if not exist "node_modules\pdfjs-dist\build\pdf.mjs" (
  call npm ci --omit=optional --ignore-scripts
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.mjs --open
if errorlevel 1 pause
