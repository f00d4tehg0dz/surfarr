# SurfArr API: channel lineup + video metadata from MongoDB (linux/amd64 + linux/arm64)
#
# Build from the REPO ROOT so the community plugin packs are included:
#   docker build -f api-server/Dockerfile -t surfarr-api .
# (api-server/Dockerfile.dockerignore decides what goes into the build.)

FROM node:22-alpine

LABEL org.opencontainers.image.title="SurfArr API" \
      org.opencontainers.image.description="Self-hosted SurfArr API: channel lineup and video metadata from MongoDB" \
      org.opencontainers.image.source="https://github.com/f00d4tehg0dz/surfarr" \
      org.opencontainers.image.licenses="GPL-3.0"

# curl: healthcheck + yt-dlp download. python3: runs the yt-dlp zipapp, which
# the importers use to read playlists. tini: clean shutdown.
RUN apk add --no-cache curl ca-certificates python3 tini \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /app

COPY api-server/package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY api-server/ ./
COPY plugin-repo/ ./plugin-repo/

# No developer secrets in the image, ever
RUN rm -f .env .env.* nginx.conf \
    && mkdir -p /app/yaml /app/backups \
    && chown -R node:node /app/yaml /app/backups

ENV NODE_ENV=production \
    PORT=3001 \
    CHANNEL_GRID_MODE=auto \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    YAML_DIR=/app/yaml \
    PLUGIN_REPO_DIR=/app/plugin-repo

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-3001}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
