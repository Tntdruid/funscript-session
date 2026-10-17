@echo off
rem Starter Funscript Session Player og aabner den i browseren.
cd /d "%~dp0"
start "" "http://127.0.0.1:8000"
python server.py
pause
