@echo off
rem Double-click this file to start Agent Chat.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
if errorlevel 1 (
  echo.
  echo Agent Chat stopped. Read the message above.
  pause
)
