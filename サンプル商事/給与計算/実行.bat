@echo off
cd /d "%~dp0"
if exist "payroll.exe" (
  "payroll.exe" %1
) else (
  python "tool\payroll.py" %1
)
if errorlevel 1 (
  echo.
  echo  *** STOPPED - please read the message above. ***
)
echo.
pause
