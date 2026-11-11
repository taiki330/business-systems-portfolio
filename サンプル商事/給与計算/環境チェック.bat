@echo off
cd /d "%~dp0"
if exist "check_env.exe" (
  "check_env.exe"
) else (
  python "tool\check_env.py"
)
echo.
pause
