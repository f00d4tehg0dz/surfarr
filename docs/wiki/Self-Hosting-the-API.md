# Self-hosting the API

SurfArr gets its channels from an API. Out of the box that's the public SurfArr API, and most people never need anything else.

You can also run the API yourself. It's the same server the public one runs: a small Node app with MongoDB behind it. Do this if you want channels built from your own lists, want to enable decades or genres the public lineup doesn't carry, or just want everything on your own hardware.

SurfArr can read the public API, your API, or **both at once**.

## Pick your sources

`REMOTE_API_URL` takes one address or several, separated by commas:

| You want | `REMOTE_API_URL` |
|---|---|
| The public lineup (default) | `https://retroarr-api.f00d.me` |
| Only your own channels | `http://127.0.0.1:3001` |
| Both | `https://retroarr-api.f00d.me,http://127.0.0.1:3001` |

You can also change the list in **Settings → Channel sources**, one address per line. A list saved there replaces `REMOTE_API_URL` until you clear the box.

With more than one source:

- Channels from every API are combined into one lineup.
- A channel that exists on both (say 90s Cartoons) plays episodes from both.
- The first API wins when two disagree. If two different channels ask for the same number, the later one moves to 700 or above.
- If one API is down, its channels stay on with what was last synced. The others keep updating.

## Run it with Docker

The quickest way is the all-in-one compose file: SurfArr, the API and MongoDB together. Download [`docker/docker-compose.selfhosted.yml`](https://github.com/f00d4tehg0dz/surfarr/blob/main/docker/docker-compose.selfhosted.yml), then:

```bash
docker compose -f docker-compose.selfhosted.yml up -d
```

It starts with both sources on, so you get the public lineup right away and your own channels as you add them.

Already running SurfArr and only want the API? Use [`api-server/docker-compose.yml`](https://github.com/f00d4tehg0dz/surfarr/blob/main/api-server/docker-compose.yml) (API and MongoDB only) and add its address to `REMOTE_API_URL`.

On Docker Desktop (Windows or macOS), SurfArr can't use host networking. Put it on the same Docker network as the API and use `http://surfarr-api:3001`. The compose file has the lines to uncomment.

## Add your channels

Lists are plain text files in the `yaml` folder next to your compose file. The file name picks the channel:

| File | Channel |
|---|---|
| `90s-cartoons.yaml` | 90s Cartoons |
| `80s-sitcoms.yaml` | 80s Sitcoms |
| `60s-shows.yaml` | 60s Shows |
| `fox-kids.yaml` | Fox Kids |

One show per line:

```
1992 - Show Name - https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx
1990 - Another Show - https://archive.org/details/some-item-identifier
```

A source can be a YouTube playlist, a single video, or an Internet Archive item, collection or search. The full format is in [`api-server/yaml/README.md`](https://github.com/f00d4tehg0dz/surfarr/blob/main/api-server/yaml/README.md).

Import them:

```bash
docker compose -f docker-compose.selfhosted.yml exec api node scripts/import-yaml.js
```

Then press **Sync Now** in Settings. A channel turns on as soon as it has episodes and turns off again if it has none.

| Command (after `exec api`) | What it does |
|---|---|
| `node scripts/import-yaml.js` | Import every list |
| `node scripts/import-yaml.js --file 90s-cartoons.yaml` | Import one list |
| `node scripts/import-yaml.js --dry-run --verbose` | Show what would be imported and what the filter drops |
| `node scripts/import-plugins.js` | Import the community channel packs from `plugin-repo/` |
| `node scripts/import-live.js` | Import 24/7 live streams from `live-channels.yaml` |
| `node src/jobs/maintenance.js --dry-run` | Check for removed and private videos without changing anything |

The same [house rules](Channels#house-rules) apply to your imports: English only, no compilations, and a minimum episode length you can change with `HOUSE_RULE_MIN_MINUTES`.

If imports stop with *"Sign in to confirm you're not a bot"*, mount a `cookies.txt` and set `YTDLP_COOKIES`, the same as for SurfArr itself. See [Troubleshooting](Troubleshooting).

## Settings

| Variable | Default | What it does |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017/surfarr` | MongoDB connection string. Atlas works too |
| `PORT` | `3001` | Port the API listens on |
| `CHANNEL_GRID_MODE` | `auto` in Docker | `auto`: any channel with episodes is on. `static`: the built-in channel list |
| `HOUSE_RULE_MIN_MINUTES` | | Minimum episode length per genre, e.g. `Cartoons=6,Kids=6,Talk TV=5`. Anything else uses 15 |
| `HOUSE_RULE_PURGE_DAYS` | `7` | Days before videos cut by the house rules are deleted. `0` keeps them flagged |
| `MAINTENANCE_ENABLED` | `true` | Daily check for removed or private videos and offline live streams |
| `MAINTENANCE_HOUR` | `4` | Hour (UTC) the daily check runs |
| `RATE_LIMIT_MAX_REQUESTS` | `200` | Requests per IP per 15 minutes. One SurfArr sync is about 60 |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy |
| `YAML_DIR` | `./yaml` | Where your lists are |
| `YTDLP_COOKIES` | | A Netscape `cookies.txt` for the importers |

## Good to know

- **MongoDB isn't exposed.** In the compose files only the API container can reach it. If you publish port 27017, turn on authentication first.
- **The API is read-only apart from one thing:** anyone who can reach it can report a video as dead. Keep it on your LAN, or put it behind a reverse proxy if you share it. There's an example in [`api-server/nginx.conf.example`](https://github.com/f00d4tehg0dz/surfarr/blob/main/api-server/nginx.conf.example).
- **Without Docker:** install Node 22, MongoDB and yt-dlp, copy `api-server/.env.example` to `.env`, then run `npm install` and `npm start` in `api-server/`. The importers are `npm run import`, `npm run import:plugins` and `npm run import:live`.
- **Your own schedule.** Channels that only exist on your API follow your API's episode list, so they won't match what other SurfArr users see on that channel number.
