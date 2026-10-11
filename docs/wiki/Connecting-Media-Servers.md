# Connecting media servers

SurfArr emulates an HDHomeRun network tuner. It answers both the HDHomeRun discovery protocol (UDP 65001) and SSDP, so media servers on your network find it the same way they find real Silicondust hardware, as long as the container uses host networking.

You'll use two URLs:

| | URL |
|---|---|
| Tuner | `http://<your-ip>:8888` |
| Guide (XMLTV) | `http://<your-ip>:8888/epg.xml` |

## Plex

1. Open **Settings → Live TV & DVR**.
2. Plex should list **SurfArr** as a tuner. Click it to set it up.
   - If it doesn't appear (common on Windows or macOS without host networking), click **Don't see your device?** and enter `http://<your-ip>:8888`.
3. When asked for a guide, choose **Add Guide with XMLTV** and enter `http://<your-ip>:8888/epg.xml`.
4. The channel scan picks up every channel: decade, themed and live.

## Jellyfin

1. Open **Dashboard → Live TV**.
2. Click **Add Tuner Device**, choose **HD Homerun**, and enter `http://<your-ip>:8888`.
3. Under **TV Guide Data Providers**, add **XMLTV** with `http://<your-ip>:8888/epg.xml`.

## Emby

1. Open **Settings → Live TV**.
2. Click **Add Tuner**, choose **HD Homerun**, and enter `http://<your-ip>:8888`.
3. Add an XMLTV guide source: `http://<your-ip>:8888/epg.xml`.

## IPTV players (VLC, TiviMate, IPTV Smarters…)

Point the player at the M3U playlist:

```
http://<your-ip>:8888/lineup.m3u
```

`/playlist.m3u` serves the same file. For a guide, add `http://<your-ip>:8888/epg.xml` as the EPG source.

## Browser

Open `http://<your-ip>:8888/tv` for SurfArr's built-in TV mode. See [Dashboard](Dashboard#tv-mode).

## Tips

- **Tuner count**: `TUNER_COUNT` (default 4) is how many channels can stream at once across all your devices.
- **Picture quality**: `STREAM_QUALITY` can be `360p`, `480p`, `720p` (default) or `1080p`. Higher settings use more bandwidth and CPU.
- **New channels**: after enabling channels or installing a plugin, run a channel scan again (Plex) or refresh the guide (Jellyfin and Emby).

If a channel tunes in the browser but not in your media server, see [Troubleshooting](Troubleshooting).
