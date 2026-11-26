@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Cai dat Web Download
cd /d "%~dp0"

echo.
echo ============================================================
echo   CAI DAT WEB DOWNLOAD
echo ============================================================
echo.

REM ---------- 1. Kiem tra Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Khong tim thay Node.js tren may.
  echo.
  echo   Tai va cai dat Node.js tai: https://nodejs.org
  echo   Chon ban LTS, cai xong mo lai file install.bat nay.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODEVER=%%v
echo [OK] Node.js !NODEVER!
echo.

REM ---------- 2. Tao thu muc du lieu ----------
if not exist "data" mkdir "data"
if not exist "data\files" mkdir "data\files"
if not exist "data\tmp" mkdir "data\tmp"
if not exist "public\vendor" mkdir "public\vendor"
echo [OK] Da tao thu muc data\ va public\vendor\
echo.

REM ---------- 3. Tai Bootstrap (chi khi thieu) ----------
set "NEED_BOOTSTRAP="
if not exist "public\vendor\bootstrap.min.css" set "NEED_BOOTSTRAP=1"
if not exist "public\vendor\bootstrap.bundle.min.js" set "NEED_BOOTSTRAP=1"

if defined NEED_BOOTSTRAP (
  echo [..] Dang tai Bootstrap 5...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css' -OutFile 'public/vendor/bootstrap.min.css' -UseBasicParsing -TimeoutSec 60; Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js' -OutFile 'public/vendor/bootstrap.bundle.min.js' -UseBasicParsing -TimeoutSec 60; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo [CANH BAO] Khong tai duoc Bootstrap.
    echo             Kiem tra ket noi mang roi chay lai install.bat.
    echo             Giao dien admin se khong hien thi dung neu thieu file.
  ) else (
    echo [OK] Da tai Bootstrap 5
  )
) else (
  echo [OK] Bootstrap 5 da co san
)
echo.

REM ---------- 4. Tao file .env neu chua co ----------
if not exist ".env" (
  > ".env" (
    echo # ===== Web Download - cau hinh =====
    echo # Doi ten file nay thanh .env va dien gia tri that.
    echo.
    echo # Cong chay web
    echo PORT=3000
    echo.
    echo # Mat khau admin ban dau ^(doi duoc trong trang Quen mat khau^)
    echo ADMIN_PASSWORD=Admin@123456
    echo.
    echo # Email nhan ma OTP khi quen mat khau
    echo ADMIN_EMAIL=tmviet98@gmail.com
    echo.
    echo # Gmail SMTP - bat xac thuc 2 buoc roi tao App Password
    echo # https://myaccount.google.com/apppasswords
    echo SMTP_HOST=smtp.gmail.com
    echo SMTP_PORT=465
    echo SMTP_SECURE=true
    echo SMTP_USER=tmviet98@gmail.com
    echo SMTP_PASS=
    echo MAIL_FROM="Web Download" ^<tmviet98@gmail.com^>
    echo.
    echo # Gioi han file upload ^(MB^)
    echo MAX_UPLOAD_MB=500
  )
  echo [OK] Da tao file .env ^(mo file de dien SMTP_PASS^)
) else (
  echo [OK] File .env da ton tai, giu nguyen cau hinh cu
)
echo.

REM ---------- 5. Kiem tra cu phap code ----------
echo [..] Kiem tra ma nguon...
node --check server.js >nul 2>nul
if errorlevel 1 (
  echo [LOI] server.js co loi cu phap.
  node --check server.js
  pause
  exit /b 1
)
node --check lib\auth.js >nul 2>nul || goto syntax_error
node --check lib\mailer.js >nul 2>nul || goto syntax_error
node --check lib\store.js >nul 2>nul || goto syntax_error
node --check lib\admin-views.js >nul 2>nul || goto syntax_error
node --check lib\pages.js >nul 2>nul || goto syntax_error
node --check lib\geo.js >nul 2>nul || goto syntax_error
node --check lib\i18n.js >nul 2>nul || goto syntax_error
echo [OK] Ma nguon hop le
echo.

echo ============================================================
echo   CAI DAT XONG
echo ============================================================
echo.
echo   Buoc tiep theo:
echo     1. Mo file .env, dien SMTP_PASS ^(App Password Gmail^)
echo     2. Chay start.bat de khoi dong web
echo     3. Vao http://localhost:3000/admin de dang nhap
echo.
echo   Mat khau admin mac dinh: Admin@123456
echo   Email quan tri:          tmviet98@gmail.com
echo.
echo ============================================================
echo.

choice /c YN /n /m "Mo file .env ngay bay gio? [Y/N] "
if errorlevel 2 goto run_now
start "" notepad .env

:run_now
choice /c YN /n /m "Khoi dong web ngay bay gio? [Y/N] "
if errorlevel 2 goto end
start "" cmd /c start.bat

:end
echo.
echo Hoan tat.
timeout /t 3 >nul
exit /b 0

:syntax_error
echo [LOI] Mot file trong lib\ co loi cu phap.
pause
exit /b 1
