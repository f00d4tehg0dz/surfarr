# SurfArr API

The API SurfArr reads its channels from: a small Node server with MongoDB behind it. This is the same code that runs the public API, so you can host your own, fill it with your own lists, and point SurfArr at it instead of the public one, or alongside it.

Full guide: [Self-hosting the API](https://github.com/f00d4tehg0dz/surfarr/wiki/Self-Hosting-the-API).

## Quick start

```bash
cd api-server
docker compose up -d                                   # API on :3001 + MongoDB
# put your lists in ./yaml (see yaml/README.md), then:
docker compose exec api node scripts/import-yaml.js
```

Then tell SurfArr about it:

```
REMOTE_API_URL=https://retroarr-api.f00d.me,http://<this-machine>:3001
```

One address uses only that API. Several are combined, first one wins.

For SurfArr, the API and MongoDB in a single stack, use `docker/docker-compose.selfhosted.yml`.

## What's here

| Path | What it is |
|---|---|
| `src/` | The API: `/config`, `/videos`, `/playlists`, `/plugins`, `/live`, `/health`, `/maintenance` |
| `src/jobs/maintenance.js` | Daily check for removed and private videos, offline live streams and the house rules |
| `scripts/import-yaml.js` | Imports your lists from `yaml/` |
| `scripts/import-plugins.js` | Imports the community channel packs from `../plugin-repo` |
| `scripts/import-live.js` | Imports 24/7 live streams from `yaml/live-channels.yaml` |
| `yaml/` | Your lists. `yaml/README.md` has the format |
| `.env.example` | Every setting, for installs without Docker |
| `nginx.conf.example` | Reverse proxy example if you put the API on the internet |

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /config` | The lineup: decade channels, themed channels, plugin channels, live channels |
| `GET /videos?decade=90s&category=Cartoons` | Episodes for a decade channel |
| `GET /videos/channel/<slug>` | Episodes for a themed channel |
| `GET /plugins`, `GET /plugins/<id>/videos` | Plugin channels and their episodes |
| `GET /live` | 24/7 live channels |
| `GET /videos/stats` | Playable, excluded and dead counts per channel |
| `GET /health`, `GET /health/deep` | Health checks |
| `PATCH /videos/<id>/dead` | Report a dead video (rate limited) |

## Channel lineup mode

`CHANNEL_GRID_MODE=auto` (the Docker default) turns a channel on as soon as it has playable videos and off when it has none. `static` uses the fixed list in `src/channels/disabled.js`, which is how the public API runs.
