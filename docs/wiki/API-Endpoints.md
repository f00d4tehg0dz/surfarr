# API endpoints

All of these are served on `http://<your-ip>:8888`.

## For players and media servers

| Endpoint | What it is |
|---|---|
| `/discover.json` | HDHomeRun device identity |
| `/lineup.json` | Channel lineup (JSON, HDHomeRun format) |
| `/lineup.m3u` or `/playlist.m3u` | Channel lineup as an M3U playlist |
| `/epg.xml` | XMLTV guide for the next 24 hours |
| `/tv` | The browser TV mode |

## For checking on things

| Endpoint | What it is |
|---|---|
| `/api/status` | Health check |
| `/api/debug/binaries` | Which yt-dlp and FFmpeg the server found and whether they work |
| `/api/debug/stream/<channel-id>` | Everything a channel needs to tune in, what's missing, and its dead-video counts |
| `/api/debug/resolve/<youtube-id>` | Runs yt-dlp on one video. It's the quickest way to see whether YouTube is blocking you |

If `ADMIN_TOKEN` is set, the debug endpoints need the admin key. Otherwise they only work from your local network. See [Configuration](Configuration#security).
