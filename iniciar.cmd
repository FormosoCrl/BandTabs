@echo off
rem Doble clic para instalar lo necesario y abrir BandTabs en modo desarrollo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
if errorlevel 1 pause
