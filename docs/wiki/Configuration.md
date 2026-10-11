# Configuration

SurfArr is configured with environment variables, set in your compose file, a `.env` file, or `server/.env` for manual installs. Real environment variables always win over the `.env` file.

## Basics

| Variable | Default | What it does |
|---|---|---|
| `DEVICE_NAME` | `SurfArr` | Tuner name shown in Plex, Jellyfin and Emby |
| `STREAM_QUALITY` | `720p` | `360p`, `480p`, `720p` or `1080p` |
| `TUNER_COUNT` | `4` | How many channels can stream at once |
| `TZ` | `America/New_York` | Timezone for the guide and the nightly jobs |
| `PORT` | `8888` | HTTP port for the dashboard, tuner and playlists |
| `REMOTE_API_URL` | `https://retroarr-api.f00d.me` | Where the channel lineup comes from |
| `CACHE_REFRESH_HOURS` | `24` | How often to refresh from the API |

## Content

| Variable | Default | What it does |
|---|---|---|
| `HOUSE_RULE_MIN_MINUTES` | | Minimum episode length in minutes, per genre. Anything not listed uses 15. The compose file ships `Cartoons=6,Kids=6,Talk TV=5` |
| `COMMERCIALS_DIR` | `./data/commercials` | Folder of your own commercial clips. See [Commercials](Commercials) |
| `PLUGINS_DIR` | `./plugins` | Where installed plugins are stored (in Docker, on the db volume) |
| `DB_PATH` | `./db/db.json` | SurfArr's local database file |

## Discovery

| Variable | Default | What it does |
|---|---|---|
| `DEVICE_ID` | *auto* | 8-hex-character HDHomeRun ID. It's generated once and saved, so only set it to pin it. Changing it makes Plex see a "new" tuner |
| `ADVERTISE_IP` | *auto* | LAN IP announced to media servers. Set it when you use Docker bridge networking |
| `ENABLE_HDHR_DISCOVERY` | `true` | HDHomeRun discovery responder (UDP 65001) |
| `ENABLE_SSDP` | `true` | SSDP responder (UDP 1900) |

## yt-dlp and FFmpeg

| Variable | Default | What it does |
|---|---|---|
| `YTDLP_PATH` | *auto* | Path to yt-dlp. A path that doesn't exist on this OS is ignored with a warning |
| `FFMPEG_PATH` / `FFPROBE_PATH` | *auto* | Paths to FFmpeg and FFprobe |
| `YTDLP_COOKIES` | | A Netscape `cookies.txt` for YouTube. Fixes *"Sign in to confirm you're not a bot"* and age-restricted videos |
| `YTDLP_EXTRA_ARGS` | | Extra arguments added to every yt-dlp call |
| `YTDLP_JS_RUNTIME` | `auto` | JS runtime for YouTube challenges: `auto` (Node 22+), `deno`, `node` or `none` |
| `YTDLP_AUTO_UPDATE` | `true` | *(Docker)* run `yt-dlp -U` every time the container starts |
| `YTDLP_PLAYLIST_LIMIT` | `1000` | Most videos pulled per playlist or channel during a plugin sync |
| `YTDLP_TIMEOUT_MS` | `90000` | Kill a stuck yt-dlp call after this long |

## Security

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_TOKEN` | | Admin key for anything that changes the server: settings, channels, plugins, sync, reports and `/api/debug`. When it's unset, changes are only allowed from your local network. **Set it if the dashboard can be reached from the internet**, then enter it under *Settings → Access*. `PLUGIN_ADMIN_KEY` also works |
| `TRUST_PROXY` | | Set it (e.g. `1`) when SurfArr is behind a reverse proxy, so it sees the real client IP. Without it, proxied requests can't make changes unless they use `ADMIN_TOKEN` |

Watching, the guide and the M3U are always open. The admin key only guards changes.
