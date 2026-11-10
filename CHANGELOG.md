# Changelog

All notable changes to SurfArr. Docker images: `f00d4tehg0dz/surfarr:<version>` on Docker Hub and `ghcr.io/f00d4tehg0dz/surfarr:<version>`.

## [Unreleased]

### Added
- **Self-hosted API.** The API server that feeds SurfArr its channels is now in this repo under `api-server/`, with MongoDB and Docker. Run your own, drop your playlist lists in a folder, import them, and a channel turns on as soon as it has episodes. Image: `f00d4tehg0dz/surfarr-api`.
- **More than one channel source.** `REMOTE_API_URL` takes several addresses separated by commas, so you can use the public API, your own, or both at once. Lineups and episodes are combined, the first address wins when two disagree, and if one API is down its channels stay on with what was last synced.
- **Channel sources in Settings.** Edit the list in the dashboard, one address per line, and see which sources are online. Saving a new list starts a sync.
- `docker/docker-compose.selfhosted.yml` runs SurfArr, the API and MongoDB as one stack.
- A wiki page: Self-Hosting the API.

### Changed
- Plugin channels that live on an API are picked up on every sync, not only at startup.
- **Sync Now** always asks the API again. Before, a second sync within a day could reuse the earlier answer for the decade channels.

### Fixed
- The API address in Settings was saved but never used. It works now.

## [2.1.0] - 2026-11-07

### Added
- **Reverse proxy support.** Set `ADVERTISE_URL` (for example `https://surfarr.example.com`) and the tuner's discovery, lineup, M3U playlist and SSDP / HDHomeRun announcements all point at that address instead of `http://<LAN IP>:8888`. Leave it unset to keep the old behavior. Thanks [@shopsD](https://github.com/shopsD) (#2).
- **70s Movies and 80s Movies** channels are on.

### Fixed
- HDHomeRun UDP discovery replies advertised `undefined` as the base URL after the reverse proxy change; they now use the same address as `discover.json`.
- A trailing `/` on `ADVERTISE_URL` no longer produces `//` in stream and lineup URLs.

## [2.0.0] - 2026-10-11

The first tagged release, and the first under the SurfArr name (formerly RetroArr).

### Upgrading from RetroArr
- Change your image to `f00d4tehg0dz/surfarr:latest` (or pin `:2.0.0`). The old `retroarr:latest` tag still gets updates for now.
- Keep the `retroarr-db` volume name. Your settings, channels and tuner ID carry over, and Plex / Jellyfin / Emby see the same tuner.

### Added
- **Internet Archive episodes** play alongside YouTube on the same channels, so shows YouTube doesn't have can still air.
- **Seven more decade channels**: 70s Sitcoms, 70s Drama, 70s Kids, 80s Sitcoms, 80s Drama, 90s Sitcoms and 00s Drama.
- **Themed channels**: G4 (107) and Reality TV (108), alongside Nick at Nite, Fox Kids, Kids WB, Disney Afternoon, MST3K and more.
- **House rules** for the whole lineup: English only, no compilations, nothing under 15 minutes (Cartoons and Kids 6, Talk TV 5; adjustable with `HOUSE_RULE_MIN_MINUTES`).
- **Redesigned dashboard** with TV Guide / cable-box styling, a CRT-style TV mode, and the version number on the Settings page.
- **Rate limits** on plugin installs, the debug tools and dashboard page loads. Streams, the M3U, the guide and the tuner are never throttled.
- **A wiki** covering installation, media servers, channels, the dashboard, plugins, commercials, configuration and troubleshooting.

### Changed
- Renamed from RetroArr to SurfArr, with a new logo, and a short README that points to the wiki.
- Smarter content filtering: better show-name and episode matching, long "Full Episodes" uploads treated as compilations, and English dubs kept.
- Live channels re-check on tune instead of trusting a stale offline flag.
- React Router 7 and the newest Vite build tooling for the dashboard.
- Background jobs (3 AM sync, 4 AM cleanup, hourly guide refresh) run on a small built-in scheduler.
- `npm run dev` uses Node's built-in `--watch` instead of nodemon.

### Security
- Every state-changing API call needs your local network or `ADMIN_TOKEN`.
- Dependency cleanup: axios, node-cron, nodemon and uuid removed, all other dependencies updated. `npm audit` on the server reports 0 vulnerabilities.
- The CI workflow runs with read-only repository permissions.

### Fixed
- [Private video] and [Deleted video] placeholders are never cached.
- Settings → Sync Now shows how many channels were updated again.

## [1.1.0] - 2026-09-14

Linux/Docker fixes, live channels, the first content filter, and the lineup driven by the SurfArr API.

[2.0.0]: https://github.com/f00d4tehg0dz/surfarr/releases/tag/v2.0.0
[1.1.0]: https://github.com/f00d4tehg0dz/surfarr/commit/HEAD
