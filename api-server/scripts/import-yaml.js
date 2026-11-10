#!/usr/bin/env node
'use strict';

/**
 * SurfArr YAML Importer
 *
 * Reads all curated YAML files from the repo root, expands each YouTube
 * playlist via yt-dlp, and upserts the video metadata into MongoDB.
 *
 * Usage:
 *   node scripts/import-yaml.js [--dry-run] [--file 90s-shows.yaml] [--decade 90s]
 *   (run from api-server/, or: docker compose exec api node scripts/import-yaml.js)
 *
 * Options:
 *   --dry-run    Parse and fetch metadata but do NOT write to MongoDB
 *   --file FILE  Only process a specific YAML file (relative to repo root)
 *   --decade DEC Override the decade for all entries in the file
 *   --force      Re-import playlists even if they were imported today
 *   --no-filter  Skip the content filter (import reactions/reviews/shorts too)
 *   --strict     More aggressive content filter
 *   --verbose    Print every filtered video and why
 *   --loose      Don't require show name / episode number / episode title in titles
 *
 * Requirements:
 *   - yt-dlp must be installed and on PATH
 *   - MONGO_URI env var or api-server/.env
 *   - YAML_DIR (optional): folder with your lists, default api-server/yaml
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load api-server/.env (real environment variables win)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Where the lists live. YAML_DIR / PLUGIN_REPO_DIR override the defaults
// (api-server/yaml, and plugin-repo next to or above api-server).
const API_ROOT = path.resolve(__dirname, '..');
const YAML_DIR = process.env.YAML_DIR ? path.resolve(process.env.YAML_DIR) : path.join(API_ROOT, 'yaml');
const PLUGIN_REPO_DIR = process.env.PLUGIN_REPO_DIR
  ? path.resolve(process.env.PLUGIN_REPO_DIR)
  : [path.join(API_ROOT, 'plugin-repo'), path.join(API_ROOT, '..', 'plugin-repo')].find((d) => fs.existsSync(d)) || path.join(API_ROOT, 'plugin-repo');


const mongoose = require('mongoose');
const contentFilter = require('../src/content/contentFilter');
const archiveLib = require('./lib/archive');

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const decadeOverride = args.includes('--decade') ? args[args.indexOf('--decade') + 1] : null;
const noFilter = args.includes('--no-filter');      // import everything, even obvious fluff
const strictFilter = args.includes('--strict');     // lower the drop threshold (more aggressive)
const verbose = args.includes('--verbose');         // print every dropped video with its reason
const loose = args.includes('--loose');             // don't require show name / episode no. / episode title

// Episode titles fetched from Wikipedia (yaml/episode-titles/<show>.json)
const { cachedEpisodeTitles: episodeTitlesFor } = require('./lib/episodeTitles');

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB models (inline — no circular dependency with api-server)
// ─────────────────────────────────────────────────────────────────────────────
const videoSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    thumbnailUrl: { type: String, default: '' },
    decade: { type: String, required: true },
    category: { type: String, required: true },
    playlistId: { type: String },
    showName: { type: String, default: '' },
    standaloneChannel: { type: String, default: '' },
    isDead: { type: Boolean, default: false },
    // Set by the content filter / audit-content.js: not an episode of the show
    excluded: { type: Boolean, default: false },
    excludedReason: { type: String, default: '' },
    uploader: { type: String, default: '' },
    lastVerified: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const playlistSchema = new mongoose.Schema(
  {
    playlistId: { type: String, required: true, unique: true },
    showName: { type: String, required: true },
    decade: { type: String, required: true },
    category: { type: String, required: true },
    videoCount: { type: Number, default: 0 },
    lastImported: { type: Date, default: null },
  },
  { timestamps: true }
);

const Video = mongoose.model('Video', videoSchema);
const Playlist = mongoose.model('Playlist', playlistSchema);

// ─────────────────────────────────────────────────────────────────────────────
// File → (decade, category) mapping
// Based on filename conventions in the repo
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Blocked YouTube channels — videos from these uploaders are skipped.
// Matches against channel name, channel ID, uploader name, or uploader ID.
// ─────────────────────────────────────────────────────────────────────────────
const BLOCKED_CHANNELS = [
  'OggOne',
  '@OggOne',
];

const FILE_METADATA = {
  // Shows
  '60s-shows.yaml':         { decade: '60s', category: 'Shows' },
  '70s-shows.yaml':         { decade: '70s', category: 'Shows' },
  '80s-shows.yaml':         { decade: '80s', category: 'Shows' },
  '90s-shows.yaml':         { decade: '90s', category: 'Shows' },
  '00s-shows.yaml':         { decade: '00s', category: 'Shows' },
  '10s-shows.yaml':         { decade: '10s', category: 'Shows' },
  '20s-shows.yaml':         { decade: '20s', category: 'Shows' },
  // Sitcoms
  '60s-sitcoms.yaml':         { decade: '60s', category: 'Sitcoms' },
  '70s-sitcoms.yaml':         { decade: '70s', category: 'Sitcoms' },
  '80s-sitcoms.yaml':         { decade: '80s', category: 'Sitcoms' },
  '90s-sitcoms.yaml':         { decade: '90s', category: 'Sitcoms' },
  '00s-sitcoms.yaml':         { decade: '00s', category: 'Sitcoms' },
  '10s-sitcoms.yaml':         { decade: '10s', category: 'Sitcoms' },
  '20s-sitcoms.yaml':         { decade: '20s', category: 'Sitcoms' },
  // Cartoons
  '60s-cartoons.yaml':         { decade: '60s', category: 'Cartoons' },
  '70s-cartoons.yaml':         { decade: '70s', category: 'Cartoons' },
  '80s-cartoons.yaml':         { decade: '80s', category: 'Cartoons' },
  '90s-cartoons.yaml':         { decade: '90s', category: 'Cartoons' },
  '00s-cartoons.yaml':         { decade: '00s', category: 'Cartoons' },
  '10s-cartoons.yaml':         { decade: '10s', category: 'Cartoons' },
  '20s-cartoons.yaml':         { decade: '20s', category: 'Cartoons' },
  // Movies
  '60s-movies.yaml':   { decade: '60s', category: 'Movies' },
  '70s-movies.yaml':   { decade: '70s', category: 'Movies' },
  '80s-movies.yaml':   { decade: '80s', category: 'Movies' },
  '90s-movies.yaml':   { decade: '90s', category: 'Movies' },
  '00s-movies.yaml':   { decade: '00s', category: 'Movies' },
  '10s-movies.yaml':   { decade: '10s', category: 'Movies' },
  '20s-movies.yaml':   { decade: '20s', category: 'Movies' },
  // Commercials
  '60s-commercials.yaml':   { decade: '60s', category: 'Commercials' },
  '70s-commercials.yaml':   { decade: '70s', category: 'Commercials' },
  '80s-commercials.yaml':   { decade: '80s', category: 'Commercials' },
  '90s-commercials.yaml':   { decade: '90s', category: 'Commercials' },
  '00s-commercials.yaml':   { decade: '00s', category: 'Commercials' },
  '10s-commercials.yaml':   { decade: '10s', category: 'Commercials' },
  '20s-commercials.yaml':   { decade: '20s', category: 'Commercials' },
  // Drama
  '60s-drama.yaml':         { decade: '60s', category: 'Drama' },
  '70s-drama.yaml':         { decade: '70s', category: 'Drama' },
  '80s-drama.yaml':         { decade: '80s', category: 'Drama' },
  '90s-drama.yaml':         { decade: '90s', category: 'Drama' },
  '00s-drama.yaml':         { decade: '00s', category: 'Drama' },
  '10s-drama.yaml':         { decade: '10s', category: 'Drama' },
  '20s-drama.yaml':         { decade: '20s', category: 'Drama' },
  // Specials
  '60s-specials.yaml':      { decade: '60s', category: 'Specials' },
  '70s-specials.yaml':      { decade: '70s', category: 'Specials' },
  '80s-specials.yaml':      { decade: '80s', category: 'Specials' },
  '90s-specials.yaml':      { decade: '90s', category: 'Specials' },
  '00s-specials.yaml':      { decade: '00s', category: 'Specials' },
  '10s-specials.yaml':      { decade: '10s', category: 'Specials' },
  '20s-specials.yaml':      { decade: '20s', category: 'Specials' },
  // Theme Songs
  '60s-theme-songs.yaml':   { decade: '60s', category: 'Theme Songs' },
  '70s-theme-songs.yaml':   { decade: '70s', category: 'Theme Songs' },
  '80s-theme-songs.yaml':   { decade: '80s', category: 'Theme Songs' },
  '90s-theme-songs.yaml':   { decade: '90s', category: 'Theme Songs' },
  '00s-theme-songs.yaml':   { decade: '00s', category: 'Theme Songs' },
  '10s-theme-songs.yaml':   { decade: '10s', category: 'Theme Songs' },
  '20s-theme-songs.yaml':   { decade: '20s', category: 'Theme Songs' },
  // Trailers
  '60s-trailers.yaml':      { decade: '60s', category: 'Trailers' },
  '70s-trailers.yaml':      { decade: '70s', category: 'Trailers' },
  '80s-trailers.yaml':      { decade: '80s', category: 'Trailers' },
  '90s-trailers.yaml':      { decade: '90s', category: 'Trailers' },
  '00s-trailers.yaml':      { decade: '00s', category: 'Trailers' },
  '10s-trailers.yaml':      { decade: '10s', category: 'Trailers' },
  '20s-trailers.yaml':      { decade: '20s', category: 'Trailers' },
  // Bumpers
  '60s-promo-bumpers.yaml': { decade: '60s', category: 'Bumpers' },
  '70s-promo-bumpers.yaml': { decade: '70s', category: 'Bumpers' },
  '80s-promo-bumpers.yaml': { decade: '80s', category: 'Bumpers' },
  '90s-promo-bumpers.yaml': { decade: '90s', category: 'Bumpers' },
  '00s-promo-bumpers.yaml': { decade: '00s', category: 'Bumpers' },
  '10s-promo-bumpers.yaml': { decade: '10s', category: 'Bumpers' },
  '20s-promo-bumpers.yaml': { decade: '20s', category: 'Bumpers' },
  // Kids
  '60s-kids.yaml':          { decade: '60s', category: 'Kids' },
  '70s-kids.yaml':          { decade: '70s', category: 'Kids' },
  '80s-kids.yaml':          { decade: '80s', category: 'Kids' },
  '90s-kids.yaml':          { decade: '90s', category: 'Kids' },
  '00s-kids.yaml':          { decade: '00s', category: 'Kids' },
  '10s-kids.yaml':          { decade: '10s', category: 'Kids' },
  '20s-kids.yaml':          { decade: '20s', category: 'Kids' },
  // Documentary
  '60s-documentary.yaml':   { decade: '60s', category: 'Documentary' },
  '70s-documentary.yaml':   { decade: '70s', category: 'Documentary' },
  '80s-documentary.yaml':   { decade: '80s', category: 'Documentary' },
  '90s-documentary.yaml':   { decade: '90s', category: 'Documentary' },
  '00s-documentary.yaml':   { decade: '00s', category: 'Documentary' },
  '10s-documentary.yaml':   { decade: '10s', category: 'Documentary' },
  '20s-documentary.yaml':   { decade: '20s', category: 'Documentary' },
  // Talk TV
  '60s-talk-tv.yaml':       { decade: '60s', category: 'Talk TV' },
  '70s-talk-tv.yaml':       { decade: '70s', category: 'Talk TV' },
  '80s-talk-tv.yaml':       { decade: '80s', category: 'Talk TV' },
  '90s-talk-tv.yaml':       { decade: '90s', category: 'Talk TV' },
  '00s-talk-tv.yaml':       { decade: '00s', category: 'Talk TV' },
  '10s-talk-tv.yaml':       { decade: '10s', category: 'Talk TV' },
  '20s-talk-tv.yaml':       { decade: '20s', category: 'Talk TV' },
  // Extra (auto-discovered) playlists, kept separate from manually curated lists
  '90s-shows-extra.yaml':      { decade: '90s', category: 'Shows' },
  '90s-sitcoms-extra.yaml':    { decade: '90s', category: 'Sitcoms' },
  '90s-cartoons-extra.yaml':   { decade: '90s', category: 'Cartoons' },
  '90s-kids-extra.yaml':       { decade: '90s', category: 'Kids' },
  '00s-shows-extra.yaml':      { decade: '00s', category: 'Shows' },
  '00s-sitcoms-extra.yaml':    { decade: '00s', category: 'Sitcoms' },
  '00s-cartoons-extra.yaml':   { decade: '00s', category: 'Cartoons' },
  '00s-kids-extra.yaml':       { decade: '00s', category: 'Kids' },
  // Output of scripts/vet-playlists.js (checked playlists only)
  '90s-cartoons-vetted.yaml':  { decade: '90s', category: 'Cartoons' },
  // Standalone channels
  'classic-nickelodeon.yaml':  { decade: '90s', category: 'Cartoons',    standalone: 'classic-nickelodeon' },
  'saturday-morning.yaml':     { decade: '80s', category: 'Cartoons',    standalone: 'saturday-morning' },
  'unsolved-mysteries.yaml':   { decade: '80s', category: 'Shows',       standalone: 'unsolved-mysteries' },
  'fox-kids.yaml':             { decade: '90s', category: 'Cartoons',    standalone: 'fox-kids' },
  'cartoon-cartoons.yaml':     { decade: '90s', category: 'Cartoons',    standalone: 'cartoon-cartoons' },
  'pbs-kids-classic.yaml':     { decade: '90s', category: 'Kids',        standalone: 'pbs-kids-classic' },
  'mst3k.yaml':                { decade: '90s', category: 'Shows',       standalone: 'mst3k' },
  'sci-fi-originals.yaml':     { decade: '80s', category: 'Shows',       standalone: 'sci-fi-originals' },
  'infomercials.yaml':         { decade: '90s', category: 'Commercials', standalone: 'infomercials' },
  'late-night-classics.yaml':  { decade: '80s', category: 'Talk TV',     standalone: 'late-night-classics' },
  'classic-game-shows.yaml':   { decade: '70s', category: 'Shows',       standalone: 'classic-game-shows' },
  'kids-wb.yaml':              { decade: '90s', category: 'Cartoons',    standalone: 'kids-wb' },
  'disney-afternoon.yaml':     { decade: '90s', category: 'Cartoons',    standalone: 'disney-afternoon' },
  'nick-at-nite.yaml':         { decade: '70s', category: 'Sitcoms',     standalone: 'nick-at-nite' },
  '80s-90s-commercials.yaml':  { decade: '80s', category: 'Commercials', standalone: '80s-90s-commercials' },
  'g4.yaml':                   { decade: '00s', category: 'Shows',       standalone: 'g4' },
  'reality-tv.yaml':           { decade: '00s', category: 'Shows',       standalone: 'reality-tv' },
};

// Work out decade + category from a file name that isn't listed above:
// "90s-cartoons-mine.yaml" → 90s / Cartoons, "80s-talk-tv-extra.yaml" → 80s / Talk TV
const CATEGORY_SLUGS = {
  shows: 'Shows', sitcoms: 'Sitcoms', cartoons: 'Cartoons', movies: 'Movies', commercials: 'Commercials',
  drama: 'Drama', specials: 'Specials', 'theme-songs': 'Theme Songs', trailers: 'Trailers',
  'promo-bumpers': 'Bumpers', bumpers: 'Bumpers', kids: 'Kids', documentary: 'Documentary', 'talk-tv': 'Talk TV',
};
function metaFromFilename(filename) {
  const m = String(filename).toLowerCase().match(/^(\d{2}s)-(.+)\.ya?ml$/);
  if (!m) return null;
  const slug = Object.keys(CATEGORY_SLUGS).sort((a, b) => b.length - a.length).find((s) => m[2] === s || m[2].startsWith(`${s}-`));
  return slug ? { decade: m[1], category: CATEGORY_SLUGS[slug] } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract a YouTube video ID from any URL format
// Handles: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID,
//          youtube.com/v/ID, m.youtube.com/watch?v=ID, youtube.com/shorts/ID
// ─────────────────────────────────────────────────────────────────────────────
function extractVideoId(url) {
  // Standard ?v= or &v= parameter
  const vParam = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (vParam) return vParam[1];

  // youtu.be/ID (with optional query params)
  const shortUrl = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (shortUrl) return shortUrl[1];

  // /embed/ID or /v/ID or /shorts/ID
  const pathMatch = url.match(/youtube\.com\/(?:embed|v|shorts)\/([A-Za-z0-9_-]{11})/);
  if (pathMatch) return pathMatch[1];

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a "YAML" file line by line
// Format: "{year/name} - {Show Name} - {YouTube URL}"
//         or just "{Label} - {YouTube URL}"
// ─────────────────────────────────────────────────────────────────────────────
function parseYamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    // Commented-out lines (incl. "# disabled <date> …" written by clean-yaml.js)
    // must never be imported
    if (line.startsWith('#')) continue;
    // Accept both http:// and https:// YouTube URLs
    if (!line || !line.match(/https?:\/\//)) continue;

    // Extract URL (last token after last ' - ')
    const urlMatch = line.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) continue;

    const url = urlMatch[0];
    const beforeUrl = line.replace(url, '').replace(/\s*-\s*$/, '').trim();

    // Internet Archive item / collection / search (scripts/lib/archive.js)
    if (/archive\.org\//i.test(url)) {
      const ident = archiveLib.parseArchiveUrl(url);
      const q = (url.match(/[?&]query=([^&#\s]+)/) || [])[1];
      const key = ident ? `ia:${ident}` : q ? `ia-search:${decodeURIComponent(q)}` : null;
      if (!key) continue;
      entries.push({ url, playlistId: key, videoId: null, isPlaylist: true, isArchive: true,
        showName: beforeUrl.replace(/^\d{4}s?\s*-\s*/, '').replace(/^[-\s]+/, '').trim() || 'Unknown' });
      continue;
    }

    // Extract playlist ID
    const listMatch = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
    // Extract video ID from any URL format
    const videoId = extractVideoId(url);

    if (!listMatch && !videoId) continue;

    const playlistId = listMatch ? listMatch[1] : null;

    // Parse show name from "1990s - Batman TAS" or "Batman TAS" or "Theme Songs"
    let showName = beforeUrl;
    // Remove leading year/decade prefix like "1990 - " or "1990s - "
    showName = showName.replace(/^\d{4}s?\s*-\s*/, '').trim();

    entries.push({
      url,
      playlistId,
      videoId,
      isPlaylist: !!playlistId,
      showName: showName || 'Unknown',
    });
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run yt-dlp to get video metadata for a playlist or single video
// Returns an array of { id, title, description, duration, thumbnailUrl }
//
// For playlists: uses --flat-playlist (fast, lists all entries)
// For single videos: uses --skip-download (gets full metadata incl. duration)
// ─────────────────────────────────────────────────────────────────────────────
function fetchPlaylistMetadata(url, showName, isPlaylist) {
  return new Promise((resolve, reject) => {
    const label = isPlaylist ? 'playlist' : 'video';
    console.log(`  ↳ Fetching ${label}: ${showName} (${url.substring(0, 60)}...)`);

    // Prefer the yt-dlp bundled next to the scripts (kept current with -U) over whatever is on PATH
    const ytdlpPath = [process.env.YTDLP_PATH, ...(process.platform === 'win32' ? [path.join(__dirname, 'yt-dlp_x86.exe'), path.join(__dirname, 'yt-dlp.exe')] : [])]
      .find((p) => p && fs.existsSync(p)) || 'yt-dlp';
    const cookiesPath = process.env.YTDLP_COOKIES || '';

    const cookieArgs = cookiesPath ? ['--cookies', cookiesPath] : [];

    // Use --flat-playlist for both playlists and single videos.
    // For single videos it outputs one JSON entry with metadata
    // without ever attempting format resolution — avoids
    // "Requested format is not available" errors entirely.
    // Same JS runtime the vetting script uses; without it YouTube playlist
    // paging can stop early
    const jsArgs = process.env.YTDLP_JS_RUNTIME === 'none' ? []
      : ['--js-runtimes', parseInt(process.versions.node, 10) >= 22 ? `node:${process.execPath}` : 'node'];
    const ytdlpArgs = [
      ...cookieArgs,
      ...jsArgs,
      '--flat-playlist',
      '--dump-json',            // metadata only; implies --simulate (--print-json downloads!)
      '--ignore-no-formats-error',
      '--no-warnings',
      '--ignore-errors',
      '--sleep-interval', '1',
      url,
    ];

    const proc = spawn(ytdlpPath, ytdlpArgs);

    const videos = [];
    let buffer = '';
    let errorOutput = '';
    let skippedBlocked = 0;

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // yt-dlp outputs one JSON object per line
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          // Only include actual video entries (not playlist headers)
          if (data.id && data._type !== 'playlist') {
            // Skip videos from blocked channels
            const ch = (data.channel || data.uploader || '').toLowerCase();
            const chId = (data.channel_id || data.uploader_id || '').toLowerCase();
            const isBlocked = BLOCKED_CHANNELS.some((b) => {
              const bl = b.toLowerCase().replace(/^@/, '');
              return ch === bl || chId === bl || ch.includes(bl);
            });
            if (isBlocked) {
              skippedBlocked++;
              continue;
            }

            // Skip age-restricted videos (require sign-in to watch)
            if (data.age_limit && data.age_limit >= 18) {
              continue;
            }

            videos.push({
              id: data.id,
              title: data.title || 'Untitled',
              description: (data.description || '').substring(0, 500),
              duration: data.duration || 0,
              thumbnailUrl:
                data.thumbnail ||
                (data.thumbnails && data.thumbnails[0]?.url) ||
                '',
              uploader: data.uploader || data.channel || '',
              channelId: data.channel_id || data.uploader_id || '',
              liveStatus: data.live_status || null,
            });
          }
        } catch {
          // Non-JSON line — skip
        }
      }
    });

    proc.stderr.on('data', (d) => (errorOutput += d.toString()));

    proc.on('close', (code) => {
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.id && data._type !== 'playlist') {
            const ch = (data.channel || data.uploader || '').toLowerCase();
            const chId = (data.channel_id || data.uploader_id || '').toLowerCase();
            const isBlocked = BLOCKED_CHANNELS.some((b) => {
              const bl = b.toLowerCase().replace(/^@/, '');
              return ch === bl || chId === bl || ch.includes(bl);
            });
            if (!isBlocked && !(data.age_limit && data.age_limit >= 18)) {
              videos.push({
                id: data.id,
                title: data.title || 'Untitled',
                description: (data.description || '').substring(0, 500),
                duration: data.duration || 0,
                thumbnailUrl: data.thumbnail || '',
                uploader: data.uploader || data.channel || '',
                channelId: data.channel_id || data.uploader_id || '',
                liveStatus: data.live_status || null,
              });
            } else {
              skippedBlocked++;
            }
          }
        } catch {}
      }

      if (skippedBlocked > 0) {
        console.log(`     ⛔ Skipped ${skippedBlocked} videos from blocked channels`);
      }

      if (videos.length > 0) {
        console.log(`     ✓ Found ${videos.length} videos`);
        resolve(videos);
      } else if (code !== 0) {
        // yt-dlp failed — check if it's a recoverable error for a single video
        const errLower = errorOutput.toLowerCase();
        const isDrm = errLower.includes('drm protected');
        const isAgeRestricted = errLower.includes('sign in') || errLower.includes('age');
        const isUnavailable = errLower.includes('not available') || errLower.includes('private') || errLower.includes('removed');
        const isFormatIssue = errLower.includes('requested format');

        if (isDrm || isAgeRestricted || isUnavailable) {
          // Genuinely unplayable — skip silently
          console.warn(`     ⊘ Skipped (${isDrm ? 'DRM' : isAgeRestricted ? 'age-restricted' : 'unavailable'})`);
          resolve([]);
        } else if (isFormatIssue && !isPlaylist) {
          // Format issue on a single video — extract ID from URL and create a minimal entry.
          // The video is playable via YouTube embed, just yt-dlp can't resolve a download format.
          const idMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
          if (idMatch) {
            console.warn(`     ⚠ Format issue — adding with metadata from URL`);
            videos.push({
              id: idMatch[1],
              title: showName || 'Untitled',
              description: '',
              duration: 0,
              thumbnailUrl: `https://i.ytimg.com/vi/${idMatch[1]}/hqdefault.jpg`,
            });
            resolve(videos);
          } else {
            console.error(`     ✗ yt-dlp error (code ${code})`);
            resolve([]);
          }
        } else {
          console.error(`     ✗ yt-dlp error (code ${code})`);
          resolve([]);
        }
      } else {
        console.warn(`     ⚠ No videos found (playlist may be empty or private)`);
        resolve([]);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert videos into MongoDB
// Uses bulkWrite with upsert so re-running the importer is safe
// ─────────────────────────────────────────────────────────────────────────────
async function upsertVideos(videos, { decade, category, playlistId, showName, standalone }) {
  if (!videos.length) return 0;

  const ops = videos.map((v) => ({
    updateOne: {
      filter: { id: v.id, isDead: { $ne: true }, excluded: { $ne: true } },
      update: {
        $set: {
          id: v.id,
          title: v.title,
          description: v.description,
          duration: v.duration,
          thumbnailUrl: v.thumbnailUrl,
          uploader: v.uploader || '',
          decade,
          category,
          playlistId,
          showName,
          ...(standalone ? { standaloneChannel: standalone } : {}),
          lastVerified: new Date(),
        },
        $setOnInsert: {
          isDead: false,
          excluded: false,
        },
      },
      upsert: true,
    },
  }));

  try {
    const result = await Video.bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
  } catch (err) {
    // Videos already marked dead/excluded don't match the filter, so the
    // upsert tries to insert a duplicate id → E11000. That is expected: keep
    // the existing flag and count what did go through.
    if (err && err.code === 11000 && err.result) {
      const r = err.result;
      const skipped = (err.writeErrors || []).length;
      if (skipped) console.log(`     ⏭  ${skipped} videos kept as dead/excluded (not revived)`);
      return (r.upsertedCount || r.nUpserted || 0) + (r.modifiedCount || r.nModified || 0);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process a single YAML file
// ─────────────────────────────────────────────────────────────────────────────
async function processFile(filePath, fileMeta) {
  const filename = path.basename(filePath);
  const { decade, category } = fileMeta;

  console.log(`\n📂 Processing: ${filename} → ${decade} / ${category}`);

  const entries = parseYamlFile(filePath);
  const playlists = entries.filter((e) => e.isPlaylist).length;
  const singles = entries.length - playlists;
  console.log(`   Found ${entries.length} entries (${playlists} playlists, ${singles} single videos)`);

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalFiltered = 0;

  for (const entry of entries) {
    const { url, playlistId, videoId, isPlaylist, isArchive, showName } = entry;

    // For single videos, build canonical youtube.com/watch?v=ID URL
    // (handles youtu.be, m.youtube.com, embed, etc.)
    const fetchUrl = (!isPlaylist && videoId)
      ? `https://www.youtube.com/watch?v=${videoId}`
      : url;

    // Skip entries already imported today (unless --force or --dry-run)
    const entryId = playlistId || videoId || showName;
    if (!isDryRun && !isForce) {
      const existing = await Playlist.findOne({ playlistId: entryId });
      if (existing && existing.lastImported) {
        const ageMs = Date.now() - existing.lastImported.getTime();
        if (ageMs < 23 * 3600 * 1000) { // < 23 hours
          console.log(`  ⏭  Skipping ${showName} (imported ${Math.floor(ageMs / 3600000)}h ago)`);
          totalSkipped++;
          continue;
        }
      }
    }

    try {
      let videos = isArchive
        ? await archiveLib.listArchive(url, showName, contentFilter).then((v) => { console.log(`  ↳ Internet Archive: ${showName} — ${v.length} episode files`); return v; })
        : await fetchPlaylistMetadata(fetchUrl, showName, isPlaylist);

      // Keep the playlist to the show: drop reactions, reviews, top-10s,
      // Shorts, trailers, fan edits… (see api-server/src/content/contentFilter.js)
      if (!noFilter && videos.length > 0) {
        const { kept, dropped } = contentFilter.filterVideos(videos, {
          category,
          showName,
          strict: strictFilter,
          blockedUploaders: BLOCKED_CHANNELS,
          // Every video must name the show, have an episode number, or match
          // a known episode title (yaml/episode-titles/<show>.json)
          requireShowMatch: !loose,
          episodeTitles: episodeTitlesFor(showName),
        });
        if (dropped.length) {
          console.log(`     🧹 Filtered ${dropped.length}/${videos.length} non-show videos`);
          if (verbose) for (const d of dropped) console.log(`        - ${d.id} "${d.title}" → ${d.filterReason}`);
          totalFiltered += dropped.length;
        }
        videos = kept;
      }

      if (!isDryRun && videos.length > 0) {
        const count = await upsertVideos(videos, {
          decade,
          category,
          playlistId: entryId,
          showName,
          standalone: fileMeta.standalone || null,
        });

        // Update/create playlist record
        await Playlist.findOneAndUpdate(
          { playlistId: entryId },
          {
            playlistId: entryId,
            showName,
            decade,
            category,
            videoCount: videos.length,
            lastImported: new Date(),
          },
          { upsert: true, new: true }
        );

        totalImported += count;
        console.log(`     ✓ Upserted ${count} videos to MongoDB`);
      } else if (isDryRun && videos.length > 0) {
        console.log(`     [DRY RUN] Would upsert ${videos.length} videos`);
        totalImported += videos.length;
      }
    } catch (err) {
      console.error(`     ✗ Failed: ${err.message}`);
      totalErrors++;
    }

    // Polite delay between playlists to avoid hammering YouTube
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (totalFiltered) console.log(`   🧹 ${totalFiltered} videos filtered out of ${filename}`);
  return { totalImported, totalSkipped, totalErrors, totalFiltered };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🎬 SurfArr YAML Importer');
  console.log(`   Mode: ${isDryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  console.log(`   Force re-import: ${isForce}`);

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/retroarr';

  if (!isDryRun) {
    console.log(`\n🔌 Connecting to MongoDB: ${mongoUri.replace(/\/\/[^@/]*@/, '//***@')}`);
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('   Connected.\n');
    } catch (err) {
      console.error('❌ MongoDB connection failed:', err.message);
      console.error('   Set MONGO_URI (api-server/.env or the environment) or use --dry-run to test without DB');
      process.exit(1);
    }
  }

  // Find YAML files to process
  const repoRoot = API_ROOT;
  let filesToProcess = [];

  // YAML files live in repo root, yaml/, or plugin-repo/
  const yamlDir = YAML_DIR;
  const pluginRepoDir = PLUGIN_REPO_DIR;
  const yamlSearchDirs = [];
  if (fs.existsSync(yamlDir)) yamlSearchDirs.push(yamlDir);
  if (fs.existsSync(pluginRepoDir)) yamlSearchDirs.push(pluginRepoDir);

  if (fileArg) {
    // --file may be a path, or just a file name inside the yaml folder
    const absPath = [path.resolve(fileArg), path.resolve(yamlDir, fileArg), path.resolve(repoRoot, fileArg)].find((p) => fs.existsSync(p)) || path.resolve(yamlDir, fileArg);
    if (!fs.existsSync(absPath)) {
      console.error(`❌ File not found: ${absPath}`);
      process.exit(1);
    }
    const basename = path.basename(absPath);
    // "<name>-vetted.yaml" / "<name>-extra.yaml" inherit <name>.yaml's decade/category/standalone
    const baseMeta = FILE_METADATA[basename.replace(/-(vetted|extra)\.yaml$/, '.yaml')];
    const meta = { ...(FILE_METADATA[basename] || baseMeta || metaFromFilename(basename) || { decade: decadeOverride || '90s', category: 'General' }) };
    if (decadeOverride) meta.decade = decadeOverride;
    filesToProcess = [{ filePath: absPath, meta }];
  } else {
    // Process all known YAML files (check both repo root and yaml/ dir)
    for (const [filename, meta] of Object.entries(FILE_METADATA)) {
      let filePath = null;
      for (const dir of yamlSearchDirs) {
        const candidate = path.join(dir, filename);
        if (fs.existsSync(candidate)) { filePath = candidate; break; }
      }
      if (filePath) {
        const effectiveMeta = { ...meta };
        if (decadeOverride) effectiveMeta.decade = decadeOverride;
        filesToProcess.push({ filePath, meta: effectiveMeta });
      }
    }

    // "<name>-vetted.yaml" files (output of vet-playlists.js) inherit <name>.yaml's metadata
    for (const dir of yamlSearchDirs) {
      for (const f of fs.readdirSync(dir).filter((x) => /-vetted\.yaml$/.test(x) && !FILE_METADATA[x])) {
        const baseMeta = FILE_METADATA[f.replace(/-vetted\.yaml$/, '.yaml')];
        if (!baseMeta) continue;
        const effectiveMeta = { ...baseMeta };
        if (decadeOverride) effectiveMeta.decade = decadeOverride;
        filesToProcess.push({ filePath: path.join(dir, f), meta: effectiveMeta });
      }
    }

    // Also discover any unlisted *.yaml files matching decade pattern
    for (const dir of yamlSearchDirs) {
      const allYamlFiles = fs.readdirSync(dir).filter(
        (f) => f.endsWith('.yaml') && !FILE_METADATA[f] && !FILE_METADATA[f.replace(/-(vetted|extra)\.yaml$/, '.yaml')]
      );
      for (const f of allYamlFiles) {
        // "<decade>-<category>-anything.yaml" (e.g. 90s-cartoons-mine.yaml)
        const named = metaFromFilename(f);
        if (named) {
          const effectiveMeta = { ...named };
          if (decadeOverride) effectiveMeta.decade = decadeOverride;
          filesToProcess.push({ filePath: path.join(dir, f), meta: effectiveMeta });
          continue;
        }
        const decadeMatch = f.match(/^(\d{2}s)/);
        if (decadeMatch) {
          console.warn(`⚠  Auto-detecting: ${f} → decade: ${decadeMatch[1]}, category: General`);
          filesToProcess.push({
            filePath: path.join(dir, f),
            meta: { decade: decadeMatch[1], category: 'General' },
          });
        }
      }
    }
  }

  if (!filesToProcess.length) {
    console.log('\n⚠  No YAML files found to process.');
    console.log(`   Put your lists in ${YAML_DIR} (see yaml/README.md) or use --file.`);
    process.exit(0);
  }

  console.log(`\n📋 Files to process: ${filesToProcess.length}`);

  let grandTotal = 0;
  let grandErrors = 0;
  let grandFiltered = 0;

  for (const { filePath, meta } of filesToProcess) {
    const { totalImported, totalErrors, totalFiltered } = await processFile(filePath, meta);
    grandTotal += totalImported;
    grandErrors += totalErrors;
    grandFiltered += totalFiltered || 0;
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`✅ Import complete`);
  console.log(`   Videos processed: ${grandTotal}`);
  console.log(`   Errors: ${grandErrors}`);
  console.log(`   Filtered as non-show content: ${grandFiltered}${noFilter ? ' (filter disabled)' : ''}`);
  if (isDryRun) {
    console.log('   (Dry run — nothing was written to MongoDB)');
  }

  if (!isDryRun) {
    await mongoose.disconnect();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});