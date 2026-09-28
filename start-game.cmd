@echo off
setlocal
cd /d "%~dp0"

echo Serving Habitat 05 at http://127.0.0.1:8000/
echo Open that address in your browser. Press Ctrl+C to stop.
python -m http.server 8000 --bind 127.0.0.1

pause
