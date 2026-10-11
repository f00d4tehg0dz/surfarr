# Dashboard

The dashboard lives at `http://<your-ip>:8888`. The sidebar has six pages.

## On Now

The home page shows what's playing on every channel right now, grouped into decade channels, curated (themed) channels, live channels and your own custom channels. You can filter by decade or genre.

The **Hook up your TV app** box has copy buttons for the Tuner, Guide (XMLTV) and M3U URLs, ready to paste into Plex, Jellyfin, Emby or an IPTV player.

Click a channel to open its page, which has:

- the episode playing now and what's coming up
- **Watch now**, to play it right in the browser
- **Turn channel on/off**
- the **Shuffle** and **Commercial breaks** switches
- the channel's stream URL, for testing in VLC

## TV Guide

This is a classic grid guide of the next 24 hours across every channel. Click a listing to see its details and stream URL, or to tune in.

## TV Mode

TV Mode is a full-screen, CRT-style TV in the browser, also available at `http://<your-ip>:8888/tv`. It's the quickest way to channel-surf.

| Key | Does |
|---|---|
| ↑ / Page Up | Channel up |
| ↓ / Page Down | Channel down |
| 0 to 9 | Type a channel number, like a remote |

You can also narrow the dial to a single decade. In the browser, YouTube episodes play through YouTube's embedded player and Internet Archive episodes play directly. Your media server uses the tuner instead.

## Plugins

Plugins is the add-on store: community channel packs you can install with one click. Search, click **Install**, and the channel joins your lineup straight away (channels 600+). See [Plugins](Plugins).

## Settings

- **Access**: enter your admin key here if you've set `ADMIN_TOKEN` (see [Configuration](Configuration#security)).
- **Status**: when the last sync ran and how many channels are active.
- **Remote API URL**: where the lineup comes from (default `https://retroarr-api.f00d.me`).
- **Device Name**: the tuner name your media server shows.
- **Stream Quality**: 360p, 480p, 720p or 1080p.
- **Tuner Count**: how many channels can stream at once.
- **Data Sync**: **Sync Now** pulls the latest lineup immediately instead of waiting for the nightly sync.

## Report

Found a broken, geo-blocked or wrong video? Paste its YouTube link or ID, optionally pick the channel, add a reason, and submit. Reported videos are re-checked during the nightly cleanup and removed if they're really dead.
