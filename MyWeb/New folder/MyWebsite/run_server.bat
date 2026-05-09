@echo off
title Company Web Server (Do Not Close)

REM สั่งให้ไป Drive D
D:
cd "D:\MyWebsite"

echo ---------------------------------------
echo 1. Migrating Database...
"D:\MyWebsite\php\php.exe" artisan migrate --force

echo ---------------------------------------
echo 2. Linking Storage...
"D:\MyWebsite\php\php.exe" artisan storage:link

echo ---------------------------------------
echo 3. Server Starting...
echo.
echo URL for this machine: http://localhost:8080
echo.
echo DO NOT CLOSE THIS WINDOW (You can minimize it)
echo ---------------------------------------

"D:\MyWebsite\php\php.exe" artisan serve --host=0.0.0.0 --port=8080

pause