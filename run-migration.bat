@echo off
REM Railway Migration Runner
REM 執行 004_continuous_learning.sql migration

echo ====================================
echo  Railway Migration Runner
echo ====================================
echo.

cd /d "%~dp0"

echo Checking Railway CLI...
railway version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Railway CLI not found
    echo Please install: npm install -g @railway/cli
    pause
    exit /b 1
)

echo.
echo Running migration...
echo.

railway run node run-migration.js

echo.
echo ====================================
echo If no errors shown above, check:
echo https://railway.app/project/YOUR-PROJECT-ID
echo ====================================
echo.
pause
