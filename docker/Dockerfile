# SurfArr — Multi-stage Docker build (linux/amd64 + linux/arm64)
#
# Stage 1: Build the React client
# Stage 2: Runtime with Node.js 22, FFmpeg and yt-dlp on Alpine
#
# Build from the repo root:  docker build -f docker/Dockerfile -t surfarr .

# ─────────────────────────────────────────────────────────────────
# Stage 1: React build
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS client-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build
# Build output goes to ../server/public (set in vite.config.js)

# ─────────────────────────────────────────────────────────────────
# Stage 2: Runtime
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL maintainer="SurfArr"
LABEL description="Self-hosted YouTube linear TV server with HDHomeRun emulation"

# System dependencies:
#   ffmpeg          — video transcoding
#   python3         — runs the yt-dlp zipapp
#   curl            — downloads yt-dlp, used by the healthcheck
#   ca-certificates — HTTPS
#   tini            — proper PID 1 so SIGTERM reaches node and zombies are reaped
RUN apk add --no-cache ffmpeg python3 curl ca-certificates tini \
    && rm -rf /var/cache/apk/*

# yt-dlp: the "yt-dlp" release asset is the portable Python zipapp — it runs on
# any architecture with python3 and bundles the EJS scripts modern YouTube
# extraction needs. It can self-update with `yt-dlp -U` (see entrypoint).
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
        -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

# Binary locations are pinned here so a stray .env can never redirect them.
# Node 22 doubles as yt-dlp's JavaScript runtime (--js-runtimes node).
ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    YTDLP_JS_RUNTIME=node \
    YTDLP_AUTO_UPDATE=true \
    PORT=8888 \
    DB_PATH=/app/server/db/db.json \
    PLUGINS_DIR=/app/server/db/plugins \
    COMMERCIALS_DIR=/app/server/data/commercials

WORKDIR /app/server

# Install production dependencies only
COPY server/package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# Copy server source, then make sure no developer .env rides along
COPY server/ ./
RUN rm -f .env .env.* && mkdir -p /app/server/db /app/server/data/commercials

# Bundled community plugin definitions (offline fallback for the plugin store)
COPY plugin-repo/ /app/plugin-repo/

# Compiled React app from stage 1
COPY --from=client-builder /app/server/public ./public

COPY docker/entrypoint.sh /usr/local/bin/surfarr-entrypoint
RUN chmod +x /usr/local/bin/surfarr-entrypoint

# Persist data across container restarts (db.json + installed plugins)
VOLUME ["/app/server/db"]

# HTTP (dashboard, HDHomeRun API, streams)
EXPOSE 8888
# HDHomeRun discovery + SSDP (only meaningful with host networking)
EXPOSE 65001/udp
EXPOSE 1900/udp

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8888}/api/status" || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/surfarr-entrypoint"]
CMD ["node", "src/index.js"]
