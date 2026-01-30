@echo off
chcp 65001 >nul
cd /d c:\Github\ndh-aed-prediction

echo Executing migration...
railway run psql < migrations\004_continuous_learning.sql

echo.
echo Verification...
echo SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE '%%learning%%' OR tablename LIKE '%%weather%%' OR tablename LIKE '%%anomaly%%') ORDER BY tablename; | railway run psql

echo.
pause
