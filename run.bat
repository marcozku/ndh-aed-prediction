@echo off
chcp 65001 >nul
cd /d c:\Github\ndh-aed-prediction

echo Running migration...
type migrations\004_continuous_learning.sql | railway run psql

echo.
echo Done!
pause
