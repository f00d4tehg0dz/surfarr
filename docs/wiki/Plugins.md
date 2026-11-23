# Plugins

Plugins add channels beyond the built-in lineup. Each one is a YAML list of YouTube and Internet Archive sources plus a small JSON config, and gets its own channel number from 600 up.

## Installing

Open **Plugins** in the dashboard, search, and click **Install**. The channel shows up in your lineup straight away and fills in on the next sync. Installed plugins are stored in `PLUGINS_DIR`, which is on the db volume in Docker, so they survive updates.

## Making your own

You need two files in your `plugins/` folder (or in `plugin-repo/` if you're submitting one).

### 1. The playlist file: `my-channel.yaml`

Put one source per line in the format `Year - Show Name - URL`. Anything yt-dlp can list works, including playlists, whole channels (their uploads are used) and single videos:

```
1984 - Show Name - https://www.youtube.com/playlist?list=PLxxxxxxxxx
1992 - Another Show - https://www.youtube.com/watch?v=xxxxxxxxxxx
1995 - A Channel - https://www.youtube.com/@SomeChannel
```

**Internet Archive works too.** Use it for your own uploads, or for shows YouTube doesn't have or hides behind an age check:

```
1994 - My Public Access Show - https://archive.org/details/my-item-identifier
1994 - My Public Access Show - https://archive.org/details/my-collection
1994 - My Public Access Show - https://archive.org/search?query=title%3A(%22My%20Show%22)
```

- An **item** gives one episode per video file in it.
- A **collection** gives one episode per item in the collection.
- A **search** gives one episode per matching item.

Only MP4 is played: the item's own `.mp4`, or the h.264 copy the Archive makes of other uploads. Files with no length in the Archive's metadata are skipped, because the schedule needs to know how long each episode runs. You can mix YouTube and Archive lines in one file.

Short clips are cut by the house rules. If your channel is made of short pieces, add `"category": "Commercials"` (or `Bumpers`, `Theme Songs`, `Trailers`) to the config file, or lower the minimum with `HOUSE_RULE_MIN_MINUTES`.

### 2. The config file: `my-channel.json`

```json
{
  "name": "My Channel",
  "channelNumber": 605,
  "yamlFile": "my-channel.yaml",
  "enabled": true,
  "settings": { "shuffle": true }
}
```

Run a sync (*Settings → Sync Now*) and the channel appears.

Plugin channels follow the same house rules as everything else: English only, no compilations, and a minimum length (see [Channels](Channels#house-rules)).

## Sharing a plugin

To get your channel into the community store, open a pull request that adds three things to [`plugin-repo/`](https://github.com/f00d4tehg0dz/surfarr/tree/main/plugin-repo):

1. `your-channel.yaml`
2. `your-channel.json`
3. a new entry in `plugin-repo/manifest.json`:

```json
{
  "id": "your-channel",
  "name": "Your Channel Name",
  "description": "Brief description of the channel content.",
  "author": "your-github-username",
  "channelNumber": 605,
  "yamlFile": "your-channel.yaml",
  "configFile": "your-channel.json",
  "tags": ["genre", "decade", "type"],
  "icon": "📺"
}
```

Guidelines:

- Only link to publicly available content.
- Use playlists where you can, since they're easier to maintain.
- Pick a channel number **600 or higher** that isn't already taken in `manifest.json`. Everything below 600 is reserved.
- Keep descriptions short.
- Submit one channel per pull request.

Commercial and bumper packs are especially welcome.
