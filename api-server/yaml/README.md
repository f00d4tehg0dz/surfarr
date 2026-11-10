# Your channel lists

Drop your lists in this folder, then run the importer. Each file feeds one channel, picked from the file name.

## Decade channels

Name the file `<decade>-<category>.yaml`:

| File | Channel |
|---|---|
| `90s-cartoons.yaml` | 90s Cartoons |
| `80s-sitcoms.yaml` | 80s Sitcoms |
| `70s-movies.yaml` | 70s Movies |
| `90s-talk-tv.yaml` | 90s Talk TV |

Decades: `60s 70s 80s 90s 00s 10s 20s`. Categories: `shows sitcoms cartoons movies commercials drama specials theme-songs trailers promo-bumpers kids documentary talk-tv`.

Anything after the category is yours to use, so `90s-cartoons-mine.yaml` and `90s-cartoons-vetted.yaml` both land on 90s Cartoons.

## Themed channels

These file names feed the themed channels (92 and up): `classic-nickelodeon`, `saturday-morning`, `unsolved-mysteries`, `fox-kids`, `cartoon-cartoons`, `pbs-kids-classic`, `mst3k`, `sci-fi-originals`, `infomercials`, `late-night-classics`, `classic-game-shows`, `kids-wb`, `disney-afternoon`, `nick-at-nite`, `80s-90s-commercials`, `g4`, `reality-tv` (each with `.yaml`).

For a brand new themed channel of your own, write a plugin pack (see the Plugins wiki page) and import it with `node scripts/import-plugins.js`.

## Line format

One show per line. Lines starting with `#` are skipped.

```
1992 - Show Name - https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxx
1994 - Another Show - https://www.youtube.com/watch?v=xxxxxxxxxxx
1990 - Archive Show - https://archive.org/details/some-item-identifier
```

The year is optional. The show name matters: the content filter uses it to keep episodes and drop reactions, reviews, trailers and clips. A source can be a YouTube playlist, a single YouTube video, or an Internet Archive item, collection or search URL.

## Live channels

`live-channels.yaml` holds 24/7 YouTube live streams:

```
200 - Channel Name - https://www.youtube.com/live/xxxxxxxxxxx
```

Number and name are optional. Import with `node scripts/import-live.js`.

## Importing

```bash
# Docker
docker compose exec api node scripts/import-yaml.js
docker compose exec api node scripts/import-yaml.js --file 90s-cartoons.yaml
docker compose exec api node scripts/import-yaml.js --dry-run --verbose

# Manual install (from api-server/)
npm run import
```

Then press **Sync Now** in SurfArr's Settings. With `CHANNEL_GRID_MODE=auto` a channel turns on as soon as it has videos.
