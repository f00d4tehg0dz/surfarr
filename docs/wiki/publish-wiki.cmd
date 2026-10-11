@echo off
REM Publishes docs\wiki\*.md to the GitHub wiki (https://github.com/f00d4tehg0dz/surfarr/wiki).
REM One-time setup: GitHub only creates the wiki repo after the first page exists, so open the
REM Wiki tab on GitHub, click "Create the first page", and save it as-is. This script overwrites it.
setlocal
cd /d "%~dp0"
set WIKI=%TEMP%\surfarr.wiki
if exist "%WIKI%\.git" (
  git -C "%WIKI%" pull -q
) else (
  git clone -q https://github.com/f00d4tehg0dz/surfarr.wiki.git "%WIKI%" || (echo Could not clone the wiki. Create the first page on GitHub first. & exit /b 1)
)
copy /y *.md "%WIKI%\" >nul
git -C "%WIKI%" add -A
git -C "%WIKI%" commit -q -m "Update wiki from docs/wiki" || (echo Wiki already up to date. & exit /b 0)
git -C "%WIKI%" push -q && echo Wiki published: https://github.com/f00d4tehg0dz/surfarr/wiki
