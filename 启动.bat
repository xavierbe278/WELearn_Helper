@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist "Desktop\php\php.exe" goto :launch
where php >nul 2>nul
if %errorlevel%==0 goto :launch

echo.
echo 未找到 PHP，尝试下载便携版 PHP...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "Desktop\setup_php.ps1"
if errorlevel 1 (
  echo.
  echo 便携版 PHP 安装失败，请手动安装 PHP 7.4+。
  echo https://windows.php.net/download/
  pause
)

:launch
if exist "Desktop\wlearn_helper.py" (
  where python >nul 2>nul
  if %errorlevel%==0 (
    python "Desktop\wlearn_helper.py"
    goto :eof
  )
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 "Desktop\wlearn_helper.py"
    goto :eof
  )
)

if exist "Web\start.bat" (
  call "Web\start.bat"
  goto :eof
)

echo.
echo 未找到可用的启动方式。
echo 请安装 Python 3.10+ 或 PHP 7.4+。
echo Python: https://www.python.org/downloads/windows/
echo PHP:    https://windows.php.net/download/
echo.
pause
