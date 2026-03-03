@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Renesance v2.0 - Asset Recovery

REM Включаем поддержку ANSI цветов и вставки в консоли (Windows 10+)
reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 1 /f >nul 2>&1

node renesance-app.js
pause
