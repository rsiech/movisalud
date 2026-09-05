@echo off
title MOVISALUD - Servidor de Salud a Domicilio
color 0b
echo ========================================================
echo        INICIANDO PLATAFORMA MOVISALUD SANTIAGO
echo ========================================================
echo.

set PATH=C:\Users\rsiec\.tools\node;%PATH%

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js no encontrado.
    pause
    exit /b 1
)

echo Iniciando servidor Express...
echo Abriendo navegador en http://localhost:3000
start http://localhost:3000
node server.js

pause
