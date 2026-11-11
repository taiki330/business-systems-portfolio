@echo off
cd /d "%~dp0"
python "tool\send_mail.py" %1
echo.
pause
