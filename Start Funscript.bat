@echo off
rem Starter Funscript Session Player og aabner den i browseren.
rem Findes python\ i mappen (portabel udgave, se make-portable.ps1), bruges den; ellers den installerede Python.
cd /d "%~dp0"
set "PY=python"
if exist "%~dp0python\python.exe" (
  set "PY=%~dp0python\python.exe"
  rem kun pakkerne i python\, ikke dem der er installeret til PC'ens egen Python
  set "PYTHONNOUSERSITE=1"
)
start "" "http://127.0.0.1:8000"
"%PY%" server.py
pause
