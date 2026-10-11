# Installation

SurfArr runs as a single Docker container that includes Node 22, FFmpeg and yt-dlp. It runs on `linux/amd64` and `linux/arm64`, so it works on Synology, Unraid, TrueNAS, Proxmox and a Raspberry Pi 4 or 5.

## Docker (recommended)

Create a `.env` file:

```env
DEVICE_NAME=SurfArr
STREAM_QUALITY=720p
TUNER_COUNT=4
TZ=America/New_York
```

Create a `docker-compose.yml` (or download [`docker/docker-compose.yml`](https://github.com/f00d4tehg0dz/surfarr/blob/main/docker/docker-compose.yml)):

```yaml
services:
  surfarr:
    image: f00d4tehg0dz/surfarr:latest
    container_name: surfarr
    restart: unless-stopped
    network_mode: host          # Linux: needed for Plex/Jellyfin auto-discovery
    # ports:                    # Docker Desktop (Windows/macOS): remove network_mode
    #   - "8888:8888"           #   and use these instead, then add the tuner
    #   - "65001:65001/udp"     #   manually by URL in your media server
    volumes:
      - retroarr-db:/app/server/db
    env_file: .env
    environment:
      - REMOTE_API_URL=https://retroarr-api.f00d.me
      - PORT=8888
      - "HOUSE_RULE_MIN_MINUTES=Cartoons=6,Kids=6,Talk TV=5"

volumes:
  retroarr-db:
```

```bash
docker compose up -d
docker compose logs -f     # watch the first sync fill the channels
```

Open `http://<your-ip>:8888`. The first sync runs in the background, and channels show up in Plex or Jellyfin once they have videos, usually within a minute or two.

### Networking

| Where you run it | What to use |
|---|---|
| Linux / NAS | `network_mode: host`, so media servers discover the tuner automatically |
| Windows / macOS (Docker Desktop) | Host networking isn't available. Remove `network_mode`, uncomment `ports`, and add the tuner by URL |
| Synology Container Manager | *Project → Create* and paste the compose file, or pick **Use the same network as Docker Host**. If DSM already uses UDP 1900, SurfArr logs a warning and discovery still works over UDP 65001 |

Compose refuses to start if you set **both** `network_mode: host` and `ports:`. Pick one.

### Updating

```bash
docker compose pull && docker compose up -d
```

`latest` always points at the newest release. To control when you upgrade, pin a version instead, e.g. `image: f00d4tehg0dz/surfarr:2.0.0`. The same tags are on GitHub Packages as `ghcr.io/f00d4tehg0dz/surfarr`. Each [release](https://github.com/f00d4tehg0dz/surfarr/releases) lists what changed.

yt-dlp updates itself every time the container starts, so a YouTube change is usually fixed with `docker compose restart surfarr`.

## Manual install

You need Node.js 20 or newer (22+ recommended), FFmpeg and yt-dlp. SurfArr finds `ffmpeg`, `ffprobe` and `yt-dlp` on its own if they're on your `PATH` or in `./scripts`, `./bin`, `./server/bin` or `/usr/local/bin`. It also falls back to `python -m yt_dlp`.

```bash
git clone https://github.com/f00d4tehg0dz/surfarr.git
cd surfarr

cd client && npm install && npm run build     # builds the dashboard into server/public
cd ../server
cp .env.example .env                          # edit to taste
npm install
npm start                                     # API, tuner and dashboard on port 8888
```

The boot log lists which FFmpeg and yt-dlp binaries it found.

### Development

```bash
cd server && npm install && npm run dev       # hot-reloading server
cd client && npm install && npm run dev       # Vite dev server, proxies the API on 8888
```

## Coming from RetroArr

It's the same project under a new name, and your data carries over.

1. Change `image: f00d4tehg0dz/retroarr:latest` to `image: f00d4tehg0dz/surfarr:latest`. The old tag still gets updates for now.
2. Keep the `retroarr-db` volume name. That's where your settings live.
3. Run `docker compose up -d`. Plex, Jellyfin and Emby see the same tuner, so there's nothing to set up again.

Next: [Connecting Media Servers](Connecting-Media-Servers)
