# Commercials

SurfArr can play your own commercial clips between episodes, like a real station break.

## Setup

1. Put video files (`.mp4`, `.mkv`, `.avi`, `.ts`, `.mov` or `.wmv`) in a folder.
2. Make the folder available to SurfArr.
   - **Docker:** the image already looks in `/app/server/data/commercials`, so just mount your folder there:

     ```yaml
     volumes:
       - retroarr-db:/app/server/db
       - /path/to/your/commercials:/app/server/data/commercials:ro
     ```

   - **Manual install:** put the clips in `server/data/commercials`, or set `COMMERCIALS_DIR` to your folder.

3. In the dashboard, open a channel and turn on **Commercial breaks**.

## How it works

- Each break runs about 2½ minutes between episodes.
- Clips are picked with the same seeded shuffle as the schedule, so the guide stays accurate and every viewer sees the same break.
- SurfArr checks the folder for new or removed clips every 5 minutes, with no restart needed.
- Breaks only play through the tuner and M3U streams (Plex, Jellyfin, Emby, IPTV players), not in the browser player.

Want commercials as a channel of their own instead? Tune to **106 80s/90s Commercials**, **100 Infomercials** or **44 90s Commercials**.
