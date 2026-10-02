#!/bin/sh
# SurfArr container entrypoint.
#
# YouTube changes constantly and yt-dlp ships fixes weekly. Refreshing the
# bundled yt-dlp at container start keeps playback working without waiting for
# a new image. Set YTDLP_AUTO_UPDATE=false to disable (e.g. offline hosts).
set -e

if [ "${YTDLP_AUTO_UPDATE:-true}" != "false" ] && [ "${YTDLP_AUTO_UPDATE:-true}" != "0" ]; then
  echo "[entrypoint] Checking for yt-dlp updates (YTDLP_AUTO_UPDATE=false to skip)..."
  # Never let a slow GitHub block startup for more than a minute.
  if command -v timeout >/dev/null 2>&1; then
    timeout 60 "${YTDLP_PATH:-yt-dlp}" -U 2>&1 | tail -n 2 || echo "[entrypoint] yt-dlp update skipped (offline or failed) — using bundled version"
  else
    "${YTDLP_PATH:-yt-dlp}" -U 2>&1 | tail -n 2 || echo "[entrypoint] yt-dlp update skipped (offline or failed) — using bundled version"
  fi
fi

echo "[entrypoint] yt-dlp $("${YTDLP_PATH:-yt-dlp}" --version 2>/dev/null || echo 'NOT FOUND')  ffmpeg $(ffmpeg -version 2>/dev/null | head -n1 | cut -d' ' -f3 || echo 'NOT FOUND')"

exec "$@"
