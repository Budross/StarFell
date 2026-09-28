@echo off
setlocal

rem Run from wherever this .bat file lives (so it serves demo.html / power-flow-widget.js
rem no matter where the folder is placed or the .bat is double-clicked from).
cd /d "%~dp0"

set PORT=8200

rem Find a working Python launcher.
where python >nul 2>nul
if not errorlevel 1 goto haspython

where py >nul 2>nul
if not errorlevel 1 goto haspy

echo Python was not found on PATH.
echo Install it from https://python.org and make sure to check "Add python.exe to PATH" during setup, then try again.
pause
exit /b 1

:haspython
set PYCMD=python
goto runserver

:haspy
set PYCMD=py
goto runserver

:runserver
echo Starting server with %PYCMD% -m http.server %PORT% in "%cd%" ...
start "Power Flow Demo Server" cmd /k %PYCMD% -m http.server %PORT%

rem Give the server a moment to come up before opening the browser.
timeout /t 2 /nobreak >nul

start "" http://localhost:%PORT%/demo.html

echo.
echo Demo opened at http://localhost:%PORT%/demo.html
echo A separate "Power Flow Demo Server" window is now running the server.
echo Close that window ^(or press Ctrl+C in it^) when you're done to stop serving.
echo.
pause
