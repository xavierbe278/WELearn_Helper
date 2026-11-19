@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PHP=php"
if exist "..\Desktop\php\php.exe" set "PHP=..\Desktop\php\php.exe"
if exist "..\Desktop\php\php.exe" goto :run

where php >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo 未找到 PHP。
  echo 请安装 PHP 7.4+，或把便携版 PHP 放到 Desktop\php\php.exe。
  echo.
  pause
  exit /b 1
)

:run
if not exist "data" mkdir "data"
set "PORT=5566"
echo.
echo WELearn Helper Web
echo http://127.0.0.1:%PORT%/
echo.
start "" "http://127.0.0.1:%PORT%/"
"%PHP%" -S 127.0.0.1:%PORT% -t .
pause
