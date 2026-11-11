@echo off
cd /d "%~dp0"
if exist "backup.exe" (
  "backup.exe" %1
) else (
  python "tool\backup.py" %1
)
echo.
pause
