@echo off
cd /d "%~dp0"
python --version >nul 2>&1
if errorlevel 1 (
  echo Python is not installed or is not on PATH.
  echo Please install Python 3.12 first, then run this file again.
  echo https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
echo Installing required library...
echo.
python -m pip install openpyxl
if errorlevel 1 (
  echo Installation failed. Check the internet connection and try again.
  pause
  exit /b 1
)
echo.
echo Done. Next: run environment check.
echo.
pause
