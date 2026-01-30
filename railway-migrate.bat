@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================
echo  Railway Migration
echo ====================================
echo.

echo Step 1: Linking to PostgreSQL service...
railway link
echo.

echo Step 2: Running migration...
type migrations\004_continuous_learning.sql | railway run psql
echo.

echo ====================================
echo  Done! Check results above.
echo ====================================
echo.
pause
