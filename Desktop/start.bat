@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  python wlearn_helper.py
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3 wlearn_helper.py
  ) else (
    echo.
    echo 未找到 Python 3。
    echo 请安装 Python 3.10+：https://www.python.org/downloads/windows/
    echo.
    pause
  )
)
if errorlevel 1 pause
