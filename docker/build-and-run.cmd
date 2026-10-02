@echo off
REM SurfArr — build the Docker image from this repo and (re)start the container.
REM Double-click or run from any prompt. Output is mirrored to docker\last-build.log.
REM
REM Windows/macOS Docker Desktop has no host networking, so the container is
REM started in bridge mode with the ports published. Add the tuner in
REM Plex/Jellyfin manually with http://<this-pc-ip>:8888 (auto-discovery only
REM works with host networking on Linux).

setlocal
set REPO=%~dp0..
set LOG=%~dp0last-build.log
set IMAGE=f00d4tehg0dz/surfarr:latest
set NAME=surfarr

cd /d "%REPO%"
echo ===== SurfArr build %date% %time% ===== > "%LOG%"

docker version >> "%LOG%" 2>&1
if errorlevel 1 (
  echo Docker is not running. Start Docker Desktop and re-run. >> "%LOG%"
  echo Docker is not running. Start Docker Desktop and re-run.
  pause
  exit /b 1
)

echo. >> "%LOG%"
echo [1/3] docker build -f docker/Dockerfile -t %IMAGE% . >> "%LOG%"
docker build -f docker/Dockerfile -t %IMAGE% . >> "%LOG%" 2>&1
if errorlevel 1 (
  echo BUILD FAILED — see docker\last-build.log >> "%LOG%"
  echo BUILD FAILED — see docker\last-build.log
  pause
  exit /b 1
)

echo. >> "%LOG%"
echo [2/3] replacing container %NAME% >> "%LOG%"
docker rm -f %NAME% >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [3/3] docker run >> "%LOG%"
docker run -d --name %NAME% --restart unless-stopped ^
  -p 8888:8888 -p 65001:65001/udp -p 1900:1900/udp ^
  -v retroarr-db:/app/server/db ^
  -e REMOTE_API_URL=https://retroarr-api.f00d.me ^
  -e DEVICE_NAME=SurfArr -e STREAM_QUALITY=720p -e TUNER_COUNT=4 -e TZ=America/New_York ^
  %IMAGE% >> "%LOG%" 2>&1
if errorlevel 1 (
  echo RUN FAILED — see docker\last-build.log >> "%LOG%"
  pause
  exit /b 1
)

echo. >> "%LOG%"
echo Waiting for the server to come up... >> "%LOG%"
timeout /t 25 /nobreak > nul
docker logs --tail 60 %NAME% >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo ----- /api/status ----- >> "%LOG%"
curl -s http://localhost:8888/api/status >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo ----- /api/debug/binaries ----- >> "%LOG%"
curl -s http://localhost:8888/api/debug/binaries >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo ----- /api/debug/resolve/dQw4w9WgXcQ (yt-dlp reachability) ----- >> "%LOG%"
curl -s -m 90 http://localhost:8888/api/debug/resolve/dQw4w9WgXcQ >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo ----- 20s stream sample from /stream/ch-fox-kids ----- >> "%LOG%"
curl -s -m 20 http://localhost:8888/stream/ch-fox-kids -o "%~dp0stream-sample.ts"
for %%A in ("%~dp0stream-sample.ts") do echo stream-sample.ts bytes: %%~zA >> "%LOG%"
docker logs --tail 25 %NAME% >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo DONE — dashboard at http://localhost:8888 >> "%LOG%"
echo DONE — dashboard at http://localhost:8888 (details in docker\last-build.log)
endlocal
