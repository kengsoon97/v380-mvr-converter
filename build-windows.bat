@echo off
setlocal
cd /d "%~dp0"
if not exist "resources\ffmpeg\ffmpeg.exe" (
  echo Missing resources\ffmpeg\ffmpeg.exe. Restore the bundled FFmpeg executable before building.
  exit /b 1
)
call npm install
if errorlevel 1 exit /b 1
call npm run dist:win
if errorlevel 1 exit /b 1
echo.
echo Installer is in the release folder.
