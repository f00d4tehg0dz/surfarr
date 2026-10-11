# Channels

## How the schedule works

Every channel runs on a **virtual clock**. Each day's episode order is built from a seeded shuffle, so the schedule is the same no matter who tunes in or when. Switch to a channel at 8:13 PM and you join whatever started at 8:00, part-way through, just like real TV. When an episode ends, the next one starts right away.

The XMLTV guide is generated from the same clock and covers the next 24 hours. It's refreshed every hour.

## Channel numbers

| Numbers | What they are |
|---|---|
| 1 to 91 | **Decade channels**: 7 decades (60s to 20s) × 13 genres |
| 92 to 108 | **Themed channels** that span decades or networks |
| 200+ | **Live channels**: 24/7 YouTube live streams |
| 600+ | **Plugin channels** you install or create |

### Decade channels

The genres are Shows, Sitcoms, Cartoons, Movies, Commercials, Drama, Specials, Theme Songs, Trailers, Bumpers, Kids, Documentary and Talk TV. A decade channel only goes on the air once it has enough curated content, so these are live right now:

| Decade | On the air |
|---|---|
| 60s | Movies |
| 70s | Sitcoms, Cartoons, Drama, Kids |
| 80s | Sitcoms, Cartoons, Drama, Kids |
| 90s | Shows, Sitcoms, Cartoons, Commercials, Bumpers, Kids |
| 00s | Sitcoms, Cartoons, Drama, Kids |
| 10s | Cartoons, Kids |
| 20s | Shows |

More are switched on as the library grows. A sync picks them up automatically.

### Themed channels

| # | Channel | # | Channel |
|---|---|---|---|
| 92 | Classic Nickelodeon | 101 | Late Night Classics |
| 93 | Saturday Morning Cartoons | 102 | Classic Game Shows |
| 94 | Unsolved Mysteries | 103 | Kids WB |
| 95 | Fox Kids | 104 | Disney Afternoon |
| 96 | Cartoon Cartoons | 105 | Nick at Nite |
| 97 | PBS Kids Classic | 106 | 80s/90s Commercials |
| 98 | MST3K | 107 | G4 |
| 99 | Sci-Fi Originals | 108 | Reality TV |
| 100 | Infomercials | | |

### Live channels

24/7 YouTube live streams appear as channels 200 and up. They have no schedule: they're simply on. SurfArr relays them with FFmpeg stream copy, which uses almost no CPU, and only transcodes if a player can't take the stream as it is. When a stream ends and the broadcaster starts a new one, the next sync or tune-in finds the new stream automatically.

To add your own live channel, drop a JSON file in your `plugins/` folder:

```json
{ "name": "Toon Town 24/7", "channelNumber": 250, "live": "https://www.youtube.com/live/XXXXXXXXXXX" }
```

## Where the content comes from

The lineup comes from the **SurfArr API** (`REMOTE_API_URL`). SurfArr syncs it at startup and every night at 3 AM. You can also press **Sync Now** in [Settings](Dashboard#settings).

- **YouTube** full-episode playlists make up most channels.
- **Internet Archive**: shows YouTube doesn't have stream straight from archive.org, mixed into the same channels. Many shows have both sources.
- **Bucketed by show**: a show with several playlists or sources doesn't get extra airtime because of it.

### House rules

Everything in the lineup is checked when it's imported and again on every sync:

- English only
- No compilations, reaction videos, reviews, top-10s, Shorts, trailers or fan edits (except on the channels made for them)
- Nothing under 15 minutes. Cartoons and Kids allow 6 minutes and Talk TV allows 5. You can change these limits with `HOUSE_RULE_MIN_MINUTES` (see [Configuration](Configuration)).

### Dead videos

When YouTube reports a video as removed or private, SurfArr marks it dead and skips it. Short-lived failures are skipped for 30 minutes and then retried. A cleanup at 4 AM every night removes videos that are confirmed dead. You can flag a bad video yourself from the [Report](Dashboard#report) page.

## Per-channel settings

Open any channel in the dashboard to:

- **Turn the channel on or off.** Off channels disappear from the M3U, the guide and your media server.
- **Shuffle**: mix up the episode order every day.
- **Commercial breaks**: play your own commercial clips between episodes. See [Commercials](Commercials).
