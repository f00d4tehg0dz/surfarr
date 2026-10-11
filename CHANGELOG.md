# Changelog

All notable changes to SurfArr. Docker images: `f00d4tehg0dz/surfarr:<version>` on Docker Hub and `ghcr.io/f00d4tehg0dz/surfarr:<version>`.

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
