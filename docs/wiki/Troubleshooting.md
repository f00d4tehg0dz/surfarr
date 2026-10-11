# Troubleshooting

### Plex doesn't find the tuner

Auto-discovery needs `network_mode: host`, which only works on Linux. Otherwise, add the tuner by hand: *Settings → Live TV & DVR → Set up → Don't see your device?* and enter `http://<your-ip>:8888`. In Docker bridge mode, also set `ADVERTISE_IP` to your LAN IP.

### Channels play in the browser but not in Plex, Jellyfin or TiviMate

The browser plays YouTube's embedded player (or the archive.org file directly), but media servers go through yt-dlp → FFmpeg → MPEG-TS. Open `http://<your-ip>:8888/api/debug/binaries`: both `ffmpeg.ok` and `ytdlp.ok` must be `true`. The boot log prints the same check.

### "Sign in to confirm you're not a bot", or videos resolve but nothing plays

YouTube rate-limits datacenter and some NAS IP addresses. Export your browser's YouTube cookies to a `cookies.txt` (for example with the *Get cookies.txt LOCALLY* extension), put it on the db volume, and set:

```
YTDLP_COOKIES=/app/server/db/cookies.txt
```

### Playback broke after weeks of working fine

YouTube changed something, so yt-dlp needs updating. Docker updates it on every start: run `docker compose restart surfarr`. For a manual install, run `yt-dlp -U` or `pip install -U yt-dlp`.

### `Failed to spawn yt-dlp: spawn C:/... ENOENT` on Linux

An old image picked up a Windows path. Update to the current image: SurfArr now ignores paths that don't exist on the running OS and finds the binaries itself.

### One video keeps failing

SurfArr skips videos YouTube reports as removed or private, and retries short-lived failures after 30 minutes. `/api/debug/stream/<channel-id>` shows the dead counts. The nightly cleanup removes confirmed-dead videos, and you can speed things up from the [Report](Dashboard#report) page.

### A channel is empty or missing

- Check that it's turned on: open it from **On Now** in the dashboard.
- Run **Settings → Sync Now** and watch `docker compose logs -f`.
- Some decade/genre combinations aren't on the air yet. See [Channels](Channels#decade-channels).

### Compose won't start: "network_mode and ports"

Use either `network_mode: host` or a `ports:` list, not both.

### Still stuck?

Open an [issue](https://github.com/f00d4tehg0dz/surfarr/issues) with your platform, the boot log, and the output of `/api/debug/binaries`.
