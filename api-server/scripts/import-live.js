#!/usr/bin/env node
'use strict';

/**
 * SurfArr Live Channel Importer
 *
 * Reads yaml/live-channels.yaml (24/7 YouTube live streams), resolves each
 * stream's title / YouTube channel / thumbnail / online status with yt-dlp and
 * upserts it into MongoDB as a LiveChannel. The API then serves them from
 * /live and /config.liveChannels, and every SurfArr instance picks them up
 * on its next sync.
 *
 * Usage:
 *   node scripts/import-live.js                 # import + refresh all
 *   node scripts/import-live.js --dry-run       # resolve only, no DB writes
 *   node scripts/import-live.js --check         # only refresh isOnline/videoId of existing channels
 *   node scripts/import-live.js --file other.yaml
 *
 * When a stream has ended and the YAML entry (or the stored channel) carries
 * the YouTube channel handle, the importer looks for that channel's current
 * live stream (<channel>/live) and swaps the video ID automatically.
 *
 * Requirements: yt-dlp, MONGO_URI in api-server/.env or the environment
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

const YTDLP_PATH = [process.env.YTDLP_PATH, ...(process.platform === 'win32' ? [path.join(__dirname, 'yt-dlp_x86.exe'), path.join(__dirname, 'yt-dlp.exe')] : []), 'yt-dlp']
  .find((p) => p && (p === 'yt-dlp' || fs.existsSync(p)));
// Modern YouTube needs a JS runtime; without it yt-dlp fails format selection
// and every stream looked "offline".
const NODE_MAJOR = parseInt(process.versions.node, 10);
const JS_RUNTIME = process.env.YTDLP_JS_RUNTIME === 'none' ? []
  : ['--js-runtimes', NODE_MAJOR >= 22 ? `node:${process.execPath}` : 'node'];
const COOKIES_PATH = process.env.YTDLP_COOKIES || '';
const API_ROOT = path.resolve(__dirname, '..');
const YAML_DIR = process.env.YAML_DIR ? path.resolve(process.env.YAML_DIR) : path.join(API_ROOT, 'yaml');
const YAML_PATH = fileArg
  ? [path.resolve(fileArg), path.resolve(YAML_DIR, fileArg)].find((p) => fs.existsSync(p)) || path.resolve(YAML_DIR, fileArg)
  : path.join(YAML_DIR, 'live-channels.yaml');
const FIRST_CHANNEL_NUMBER = 200;

const liveChannelSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    videoId: { type: String, required: true },
    url: { type: String, default: '' },
    youtubeChannel: { type: String, default: '' },
    channelNumber: { type: Number, required: true, unique: true },
    category: { type: String, default: 'Live' },
    tags: [String],
    icon: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },
    uploader: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    isOnline: { type: Boolean, default: true },
    lastChecked: { type: Date, default: null },
  },
  { timestamps: true }
);
const LiveChannel = mongoose.model('LiveChannel', liveChannelSchema);

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function extractVideoId(url) {
  const m =
    url.match(/\/live\/([A-Za-z0-9_-]{11})/) ||
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    url.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// "200 - Name - URL" | "Name - URL" | "URL"
function parseLiveYaml(filePath) {
  const entries = [];
  let nextNumber = FIRST_CHANNEL_NUMBER;
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const urlMatch = line.match(/https?:\/\/\S+/);
    if (!urlMatch) continue;
    const url = urlMatch[0];
    let before = line.slice(0, line.indexOf(url)).replace(/\s*-\s*$/, '').trim();
    let channelNumber = null;
    const num = before.match(/^(\d{3,4})\s*(?:-\s*)?/);
    if (num) {
      channelNumber = parseInt(num[1], 10);
      before = before.slice(num[0].length).trim();
    }
    if (channelNumber === null) channelNumber = nextNumber;
    nextNumber = Math.max(nextNumber, channelNumber + 1);

    const videoId = extractVideoId(url);
    const isChannelUrl = !videoId && /youtube\.com\/(@|channel\/|c\/|user\/)/.test(url);
    if (!videoId && !isChannelUrl) {
      console.warn(`  ⚠ skipping unrecognised URL: ${url}`);
      continue;
    }
    entries.push({ url, videoId, isChannelUrl, name: before || null, channelNumber });
  }
  return entries;
}

function runYtdlp(url) {
  return new Promise((resolve) => {
    const cookieArgs = COOKIES_PATH ? ['--cookies', COOKIES_PATH] : [];
    const proc = spawn(YTDLP_PATH, [
      ...cookieArgs,
      ...JS_RUNTIME,
      '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings',
      // metadata only — never fail because no format matched
      '--ignore-no-formats-error',
      url,
    ], { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => proc.kill(), 90000);
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) return resolve({ ok: false, error: err.trim().split('\n').pop() || `exit ${code}` });
      try {
        resolve({ ok: true, info: JSON.parse(out) });
      } catch {
        resolve({ ok: false, error: 'unparseable JSON' });
      }
    });
  });
}

// Resolve a stream: returns { videoId, title, uploader, channelHandle, thumbnail, isLive, description }
async function resolveStream(url) {
  const r = await runYtdlp(url);
  if (!r.ok) return { ok: false, error: r.error };
  const info = r.info;
  const handle = info.uploader_id && info.uploader_id.startsWith('@') ? info.uploader_id : info.channel_url || '';
  return {
    ok: true,
    videoId: info.id,
    title: info.title || '',
    uploader: info.channel || info.uploader || '',
    channelHandle: handle,
    channelUrl: info.channel_url || (handle ? `https://www.youtube.com/${handle}` : ''),
    thumbnail: info.thumbnail || '',
    isLive: info.live_status === 'is_live' || info.is_live === true,
    liveStatus: info.live_status || (info.is_live ? 'is_live' : 'unknown'),
    description: (info.description || '').slice(0, 300),
  };
}

// A channel's "/live" URL redirects to its current stream (if any)
async function findCurrentStream(channelUrl) {
  if (!channelUrl) return null;
  const r = await resolveStream(channelUrl.replace(/\/+$/, '') + '/live');
  return r.ok && r.isLive ? r : null;
}

async function main() {
  console.log(`📡 SurfArr live channel importer — ${isDryRun ? 'DRY RUN' : checkOnly ? 'CHECK' : 'IMPORT'}`);
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/retroarr';
  if (!isDryRun) await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  let entries = [];
  if (checkOnly) {
    const existing = isDryRun ? [] : await LiveChannel.find({}).lean();
    entries = existing.map((l) => ({
      url: l.url || `https://www.youtube.com/live/${l.videoId}`,
      videoId: l.videoId,
      name: l.name,
      channelNumber: l.channelNumber,
      slug: l.slug,
      youtubeChannel: l.youtubeChannel,
      prevOnline: l.isOnline,
    }));
  } else {
    if (!fs.existsSync(YAML_PATH)) {
      console.error(`❌ ${YAML_PATH} not found`);
      process.exit(1);
    }
    entries = parseLiveYaml(YAML_PATH);
  }
  if (!checkOnly && !isDryRun) {
    const prev = new Map((await LiveChannel.find({}).lean()).map((l) => [l.channelNumber, l.isOnline]));
    for (const e of entries) e.prevOnline = prev.get(e.channelNumber);
  }
  console.log(`   yt-dlp: ${YTDLP_PATH}`);
  console.log(`   ${entries.length} live channel(s) to process\n`);

  let online = 0;
  for (const e of entries) {
    console.log(`▶ CH ${e.channelNumber} ${e.name || e.url}`);
    let resolved = await resolveStream(e.isChannelUrl ? e.url.replace(/\/+$/, '') + '/live' : e.url);

    if (!resolved.ok) {
      console.log(`   ✗ yt-dlp: ${resolved.error} — status unknown, keeping previous state`);
    } else if (!resolved.isLive) {
      console.log(`   ⚠ stream is not live (${resolved.liveStatus}) — looking for the channel's current stream`);
      const current = await findCurrentStream(resolved.channelUrl || e.youtubeChannel);
      if (current) {
        console.log(`   ↪ found current stream ${current.videoId} "${current.title}"`);
        resolved = current;
      }
    }

    const name = e.name || (resolved.ok ? resolved.uploader || resolved.title : null) || `Live ${e.channelNumber}`;
    const slug = e.slug || slugify(name);
    const doc = {
      slug,
      name,
      description: resolved.ok ? resolved.title : '',
      videoId: resolved.ok ? resolved.videoId : e.videoId,
      url: `https://www.youtube.com/live/${resolved.ok ? resolved.videoId : e.videoId}`,
      youtubeChannel: resolved.ok ? resolved.channelUrl : e.youtubeChannel || '',
      channelNumber: e.channelNumber,
      thumbnailUrl: resolved.ok ? resolved.thumbnail : '',
      uploader: resolved.ok ? resolved.uploader : '',
      // Only an explicit "not live" from YouTube marks a channel offline. A
      // yt-dlp failure (network, bot check, old binary) says nothing about the
      // stream, so keep the previous state (default: online).
      isOnline: resolved.ok ? resolved.isLive : (e.prevOnline !== false),
      lastChecked: new Date(),
    };
    if (doc.isOnline) online++;
    console.log(`   ${doc.isOnline ? '🟢 LIVE' : '🔴 offline'}  ${doc.name}  [${doc.videoId}]  ${doc.uploader ? '— ' + doc.uploader : ''}`);

    if (!doc.videoId) {
      console.log('   ✗ no video id — skipped');
      continue;
    }
    if (!isDryRun) {
      // The channel number in live-channels.yaml is the identity: update the
      // doc on that number (its slug may date from an older name) and keep its
      // slug so client channel IDs stay stable. A new channel whose slug is
      // already taken by another number gets the number appended.
      const existing = await LiveChannel.findOne({ channelNumber: e.channelNumber }).lean();
      if (existing) {
        doc.slug = existing.slug;
      } else if (await LiveChannel.exists({ slug })) {
        doc.slug = `${slug}-${e.channelNumber}`;
      }
      await LiveChannel.findOneAndUpdate(
        { channelNumber: e.channelNumber },
        { $set: doc, $setOnInsert: { enabled: true, category: 'Live', tags: [] } },
        { upsert: true, new: true }
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\n✅ ${entries.length} live channels processed, ${online} currently online${isDryRun ? ' (dry run — nothing written)' : ''}`);
  if (!isDryRun) await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
