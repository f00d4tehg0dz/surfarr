'use strict';

// Daily database maintenance for the SurfArr API.
//
// Runs inside the API process once a day (MAINTENANCE_HOUR, UTC) and can be
// run by hand:  node src/jobs/maintenance.js [--dry-run] [--limit 2000]
//
//   1. Title sweep (DB only): exclude "[Private video]" / "[Deleted video]"
//      placeholders, make-money spam and baby/toddler uploads everywhere.
//   2. Availability check: a rotating slice of videos (oldest lastVerified
//      first) is checked against YouTube's oEmbed endpoint. 404 = removed /
//      unavailable, 401/403 = private or embedding blocked (confirmed on the
//      watch page before marking). Anything else (429, 5xx, network) is
//      "unknown" and never marks a video dead. The whole library is covered
//      every few weeks at MAINTENANCE_CHECKS_PER_RUN per day.
//   3. Live channels: re-check each stream; follow the YouTube channel's
//      /live page when a stream ID has rotated. Only an explicit "not live"
//      marks a channel offline.
//   4. Playlists: recount playable videos per playlist.
//
// Safety valves: a run stops checking when YouTube starts refusing (several
// unknown results in a row) or when an implausible share of videos come back
// dead (that means YouTube is blocking us, not that the videos are gone).
//
// Env: MAINTENANCE_ENABLED (default true), MAINTENANCE_HOUR (default 4, UTC),
//      MAINTENANCE_CHECKS_PER_RUN (default 15000 ≈ 35 min), MAINTENANCE_CONCURRENCY (3)

// CLI runs load .env before the content filter reads HOUSE_RULE_MIN_MINUTES
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Video, PluginVideo, Playlist, LiveChannel } = require('../db/mongodb');
const { isArchiveId, archiveFileUrl } = require('../content/mediaSource');
const { SPAM_TITLE_RE, TODDLER_TITLE_RE, TODDLER_UPLOADERS, COMPILATION_RE, MIN_EPISODE_SECONDS, SHORT_FORM_CATEGORIES, MIN_SECONDS_OVERRIDES, nonEnglishReason, houseRule } = require('../content/contentFilter');

const log = (...a) => console.log('[Maintenance]', ...a);
// A normal browser UA: YouTube serves a stripped page (no player data) to bots
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const PLACEHOLDER_RE = /^\s*\[(private|deleted) video\]\s*$/i;

let running = false;
let lastRun = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.8',
        // skip the EU/consent interstitial so the real watch page comes back
        Cookie: 'CONSENT=YES+cb; SOCS=CAI',
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ── 1. title sweep ──────────────────────────────────────────────────────────
function mongoRegex(re) { return { $regex: re.source, $options: 'i' }; }

async function titleSweep(dryRun) {
  const toddlerUploader = new RegExp(TODDLER_UPLOADERS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const rules = [
    { reason: 'private/deleted video', filter: { title: mongoRegex(PLACEHOLDER_RE) } },
    { reason: 'spam (make-money / channel-growth)', filter: { title: mongoRegex(SPAM_TITLE_RE) } },
    { reason: 'toddler/baby content', filter: { $or: [{ title: mongoRegex(TODDLER_TITLE_RE) }, { uploader: mongoRegex(toddlerUploader) }] } },
    // House rules (see contentFilter.houseRule) — short-form channels exempt
    { reason: 'compilation', filter: { category: { $nin: SHORT_FORM_CATEGORIES }, title: mongoRegex(COMPILATION_RE) } },
    // Default 15 min; categories in HOUSE_RULE_MIN_MINUTES get their own minimum.
    // The reason text stays 'under 15 min' so houseRuleReport can find/undo it.
    { reason: 'under 15 min', filter: { $or: [
      { category: { $nin: [...SHORT_FORM_CATEGORIES, ...Object.keys(MIN_SECONDS_OVERRIDES)] }, duration: { $gt: 0, $lt: MIN_EPISODE_SECONDS } },
      ...Object.entries(MIN_SECONDS_OVERRIDES).filter(([c]) => !SHORT_FORM_CATEGORIES.includes(c))
        .map(([c, sec]) => ({ category: c, duration: { $gt: 0, $lt: sec } })),
    ] } },
  ];
  const out = {};
  for (const Model of [Video, PluginVideo]) {
    for (const r of rules) {
      const q = { excluded: { $ne: true }, ...r.filter };
      const n = dryRun
        ? await Model.countDocuments(q)
        : (await Model.updateMany(q, { $set: { excluded: true, excludedReason: `${r.reason} (daily sweep)`, excludedAt: new Date() } })).modifiedCount;
      out[`${Model.modelName}:${r.reason}`] = n;
    }
    // English only — needs the JS detector (scripts, stop words), so scan titles
    const ids = [];
    const multi = [];
    for await (const v of Model.find({ excluded: { $ne: true } }).select('_id title language uploader duration category').lean().cursor()) {
      if (nonEnglishReason(v.title, v.language, v.uploader)) ids.push(v._id);
      else if (houseRule(v.title, v.duration, v.category) === 'compilation') multi.push(v._id);
    }
    // Multi-episode uploads ("Full Episodes | 1 Hour") count as compilations
    if (!dryRun && multi.length) {
      for (let i = 0; i < multi.length; i += 1000) {
        await Model.updateMany({ _id: { $in: multi.slice(i, i + 1000) } },
          { $set: { excluded: true, excludedReason: 'compilation (daily sweep)', excludedAt: new Date() } });
      }
    }
    out[`${Model.modelName}:multi-episode compilation`] = multi.length;
    if (!dryRun && ids.length) {
      for (let i = 0; i < ids.length; i += 1000) {
        await Model.updateMany({ _id: { $in: ids.slice(i, i + 1000) } },
          { $set: { excluded: true, excludedReason: 'non-English (daily sweep)', excludedAt: new Date() } });
      }
    }
    out[`${Model.modelName}:non-English`] = ids.length;
  }
  // House-rule hits (compilation / too short) are deleted outright once they
  // have sat excluded for HOUSE_RULE_PURGE_DAYS (default 7; 0 = never). The
  // grace period means a missing/misconfigured HOUSE_RULE_MIN_MINUTES can be
  // fixed with houseRuleReport --resync before anything is gone for good.
  const days = parseFloat(process.env.HOUSE_RULE_PURGE_DAYS ?? '7');
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86400000);
    for (const Model of [Video, PluginVideo]) {
      const q = { excluded: true, excludedReason: { $in: ['compilation (daily sweep)', 'under 15 min (daily sweep)', 'non-English (daily sweep)'] }, excludedAt: { $lte: cutoff } };
      out[`${Model.modelName}:purged (house rule, >${days}d)`] = dryRun ? await Model.countDocuments(q) : (await Model.deleteMany(q)).deletedCount;
    }
  }
  return out;
}

// ── 2. availability ─────────────────────────────────────────────────────────
// Second opinion from yt-dlp when YouTube hides the watch page from us.
// → 'ok' | 'dead:<reason>' | 'unknown:<why>' | null (no yt-dlp on this server)
function ytdlpVerdict(id) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const bin = process.env.YTDLP_PATH || 'yt-dlp';
    const args = ['--skip-download', '--no-playlist', '--no-warnings', '--ignore-no-formats-error', '--print', 'id'];
    if (parseInt(process.versions.node, 10) >= 22) args.push('--js-runtimes', `node:${process.execPath}`);
    if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
    let err = '';
    let p;
    try { p = spawn(bin, [...args, `https://www.youtube.com/watch?v=${id}`]); } catch { return resolve(null); }
    const t = setTimeout(() => p.kill(), 60000);
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) return resolve('ok');
      if (/private video/i.test(err)) return resolve('dead:private video');
      if (/confirm you.re not a bot|sign in to confirm|429|too many requests/i.test(err)) return resolve('unknown:yt-dlp bot check');
      if (/age|inappropriate/i.test(err)) return resolve('unknown:age-restricted');
      if (/video unavailable|has been removed|terminated|copyright|does not exist|no longer available/i.test(err)) return resolve('dead:unavailable (removed or does not exist)');
      resolve(`unknown:yt-dlp ${code}`);
    });
  });
}

// → 'ok' | 'dead:<reason>' | 'unknown:<why>'
// Internet Archive file: a 1 KB range request says whether it still downloads
async function checkArchiveFile(id) {
  try {
    const res = await fetch(archiveFileUrl(id), { headers: { Range: 'bytes=0-1023', 'User-Agent': 'SurfArr/1.1' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    try { await res.body?.cancel(); } catch { /* ignore */ }
    if (res.status === 200 || res.status === 206) return 'ok';
    if (res.status === 404 || res.status === 410) return 'dead:removed from the Internet Archive';
    if (res.status === 401 || res.status === 403) return 'dead:access restricted on the Internet Archive';
    return `unknown:archive http ${res.status}`;
  } catch (e) {
    return `unknown:archive ${e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'network'}`;
  }
}

async function checkVideo(id) {
  if (isArchiveId(id)) return checkArchiveFile(id);
  let res;
  try {
    res = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
  } catch (e) {
    return `unknown:${e.name === 'AbortError' ? 'timeout' : 'network'}`;
  }
  if (res.ok) return 'ok';
  if (res.status === 404 || res.status === 400) return 'dead:unavailable (removed or does not exist)';
  if (res.status === 401 || res.status === 403) {
    // Private, or just embedding disabled (still playable) — ask the watch page
    try {
      const page = await (await fetchWithTimeout(`https://www.youtube.com/watch?v=${id}&hl=en`)).text();
      const m = page.match(/"playabilityStatus":\{"status":"([A-Z_]+)"(?:,"reason":"([^"]*)")?/);
      if (!m) return (await ytdlpVerdict(id)) || 'unknown:no playability data';
      const [, status, reason = ''] = m;
      if (status === 'OK') return 'ok';
      if (/private/i.test(reason)) return 'dead:private video';
      if (status === 'ERROR' || /unavailable|removed|terminated|copyright/i.test(reason)) return `dead:${reason || status.toLowerCase()}`;
      return `unknown:${status}`; // LOGIN_REQUIRED for age-restricted etc. — leave alone
    } catch {
      return 'unknown:watch page';
    }
  }
  return `unknown:http ${res.status}`;
}

async function availabilitySweep(limit, concurrency, dryRun) {
  const perModel = Math.ceil(limit / 2);
  const pick = (Model) => Model.find({ isDead: { $ne: true }, excluded: { $ne: true } })
    .sort({ lastVerified: 1 }).limit(perModel).select('_id id').lean();
  const queue = [
    ...(await pick(Video)).map((d) => ({ Model: Video, d })),
    ...(await pick(PluginVideo)).map((d) => ({ Model: PluginVideo, d })),
  ];
  const stats = { checked: 0, ok: 0, dead: 0, unknown: 0, reasons: {}, cooledDown: false, stopped: null };
  let unknownStreak = 0;

  async function worker() {
    while (queue.length && !stats.stopped) {
      const { Model, d } = queue.shift();
      const verdict = await checkVideo(d.id);
      stats.checked++;
      if (verdict === 'ok') {
        stats.ok++; unknownStreak = 0;
        if (!dryRun) await Model.updateOne({ _id: d._id }, { $set: { lastVerified: new Date() } });
      } else if (verdict.startsWith('dead:')) {
        stats.dead++; unknownStreak = 0;
        const reason = verdict.slice(5);
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        if (!dryRun) await Model.updateOne({ _id: d._id }, { $set: { isDead: true, deadReason: reason, lastVerified: new Date() } });
      } else {
        stats.unknown++; unknownStreak++;
        stats.reasons[verdict] = (stats.reasons[verdict] || 0) + 1;
        if (unknownStreak >= 25) {
          if (!stats.cooledDown) {
            // Usually temporary rate limiting: pause 10 minutes, then carry on
            stats.cooledDown = true;
            unknownStreak = 0;
            log(`YouTube refusing requests (${verdict}) — pausing 10 min`);
            await sleep(10 * 60 * 1000);
          } else {
            stats.stopped = `YouTube refusing requests (${verdict}) — stopping; unchecked videos are picked up tomorrow`;
          }
        }
      }
      // Far more dead than normal = we are being blocked, not a mass deletion
      if (stats.checked >= 200 && stats.dead / stats.checked > 0.35) {
        stats.stopped = `${stats.dead}/${stats.checked} dead is implausible — stopping (check YouTube access from this server)`;
      }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return stats;
}

// ── 3. live channels ────────────────────────────────────────────────────────
const { spawn } = require('child_process');

// yt-dlp is the most reliable live check when the server has it
// (YTDLP_PATH or yt-dlp on PATH). Missing binary → null, never an error.
function ytdlpLive(url) {
  return new Promise((resolve) => {
    const bin = process.env.YTDLP_PATH || 'yt-dlp';
    const nodeMajor = parseInt(process.versions.node, 10);
    const args = ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--ignore-no-formats-error'];
    if (nodeMajor >= 22) args.push('--js-runtimes', `node:${process.execPath}`);
    if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
    let out = '';
    let p;
    try { p = spawn(bin, [...args, url]); } catch { return resolve(null); }
    const t = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', () => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out);
        const ls = j.live_status || (j.is_live ? 'is_live' : null);
        if (!ls) return resolve(null);
        resolve({ live: ls === 'is_live', videoId: j.id, title: j.title || '', via: 'yt-dlp' });
      } catch { resolve(null); }
    });
  });
}

// → { live: true|false|null, videoId, title, why }
async function pageLive(url) {
  try {
    const html = await (await fetchWithTimeout(url)).text();
    const vid = (html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/) || [])[1];
    if (!vid) {
      const why = /consent\.youtube|before you continue/i.test(html) ? 'consent page'
        : /confirm you.re not a bot|unusual traffic/i.test(html) ? 'bot check' : 'no player data';
      return { live: null, why };
    }
    const title = ((html.match(/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/) || [])[1] || '').replace(/\\u0026/g, '&').replace(/\\"/g, '"');
    if (/"isLiveNow":true/.test(html) || /"isLive":true/.test(html)) return { live: true, videoId: vid, title, via: 'page' };
    if (/"isLiveNow":false/.test(html) || /"isLiveContent":false/.test(html)) return { live: false, videoId: vid, title, via: 'page' };
    return { live: null, videoId: vid, title, why: 'no live flag' };
  } catch (e) {
    return { live: null, why: e.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

async function liveStatus(url) {
  const page = await pageLive(url);
  if (page.live !== null) return page;
  const y = await ytdlpLive(url);
  return y || page;
}

// Names from yaml/live-channels.yaml ("200 - Name - url"), used to replace
// placeholder names like "Live 200" from the first import
function liveYamlNames() {
  const names = new Map();
  try {
    const fs = require('fs');
    const text = fs.readFileSync(require('path').join(process.env.YAML_DIR || require('path').join(__dirname, '../../yaml'), 'live-channels.yaml'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d{3,4})\s*-\s*(.+?)\s*-\s*https?:\/\//);
      if (m) names.set(parseInt(m[1], 10), m[2].trim());
    }
  } catch {}
  return names;
}

async function liveSweep(dryRun) {
  const out = [];
  const yamlNames = liveYamlNames();
  for (const l of await LiveChannel.find({ enabled: { $ne: false } }).lean()) {
    let s = await liveStatus(`https://www.youtube.com/watch?v=${l.videoId}&hl=en`);
    // A bot check is usually short-lived rate limiting — wait and try once more
    if (s.live === null && /bot check/.test(s.why || '')) {
      await sleep(15000);
      s = await liveStatus(`https://www.youtube.com/watch?v=${l.videoId}&hl=en`);
    }
    if (s.live === false && l.youtubeChannel) {
      const alt = await liveStatus(`${l.youtubeChannel.replace(/\/+$/, '')}/live?hl=en`);
      if (alt.live) s = alt;
    }
    const set = { lastChecked: new Date() };
    if (s.live !== null) set.isOnline = s.live;
    if (s.live && s.videoId && s.videoId !== l.videoId) { set.videoId = s.videoId; set.url = `https://www.youtube.com/live/${s.videoId}`; }
    if (s.live && s.title) set.description = s.title;
    // Placeholder names from the first import ("Live 200") → use the YAML name
    // if one exists, else the stream title
    if (/^Live \d+$/.test(l.name)) { const n = yamlNames.get(l.channelNumber) || (s.live && s.title ? s.title.slice(0, 60) : null); if (n) set.name = n; }
    if (!dryRun) await LiveChannel.updateOne({ _id: l._id }, { $set: set });
    const state = s.live === null
      ? `unknown — ${s.why || '?'} (kept ${l.isOnline !== false ? 'online' : 'offline'})`
      : `${s.live ? 'LIVE' : 'offline'} via ${s.via}`;
    out.push(`${l.channelNumber} ${set.name ? `${l.name} → ${set.name}` : l.name}: ${state}${set.videoId ? ` (new stream ${set.videoId})` : ''}`);
    await sleep(1000);
  }
  return out;
}

// ── 4. playlists ────────────────────────────────────────────────────────────
// Recount playable videos. Registry entries with no videos at all (not even
// dead/excluded ones) are orphans — e.g. commented-out YAML lines that were
// imported as "# 1995 - Goosebumps" — and are removed. Playlists whose videos
// are all dead/excluded stay (count 0) so a re-import can't silently revive
// them, and are listed for review.
async function playlistSweep(dryRun) {
  const [playable, any] = await Promise.all([
    Video.aggregate([
      { $match: { isDead: { $ne: true }, excluded: { $ne: true }, playlistId: { $nin: [null, ''] } } },
      { $group: { _id: '$playlistId', n: { $sum: 1 } } },
    ]),
    Video.aggregate([
      { $match: { playlistId: { $nin: [null, ''] } } },
      { $group: { _id: '$playlistId', n: { $sum: 1 } } },
    ]),
  ]);
  const playableMap = new Map(playable.map((c) => [c._id, c.n]));
  const anyMap = new Map(any.map((c) => [c._id, c.n]));
  const playlists = await Playlist.find({}).select('_id playlistId showName videoCount').lean();
  let recounted = 0;
  const orphans = [];
  const allGone = [];
  for (const p of playlists) {
    const n = playableMap.get(p.playlistId) || 0;
    if (!anyMap.get(p.playlistId) || /^\s*#/.test(p.showName || '')) {
      orphans.push(p);
      continue;
    }
    if (n === 0) allGone.push(p.showName);
    if (n !== p.videoCount) {
      recounted++;
      if (!dryRun) await Playlist.updateOne({ _id: p._id }, { $set: { videoCount: n } });
    }
  }
  if (!dryRun && orphans.length) await Playlist.deleteMany({ _id: { $in: orphans.map((o) => o._id) } });
  return {
    playlists: playlists.length,
    recounted,
    orphansRemoved: orphans.length,
    orphanSample: orphans.slice(0, 10).map((o) => o.showName),
    noPlayableVideos: allGone.length,
    noPlayableSample: allGone.slice(0, 15),
  };
}

// ── run ─────────────────────────────────────────────────────────────────────
async function runMaintenance({ dryRun = false, limit, concurrency, liveOnly = false, rulesOnly = false } = {}) {
  if (running) return { skipped: 'already running' };
  running = true;
  const started = Date.now();
  const report = { startedAt: new Date().toISOString(), dryRun };
  try {
    log(`start${dryRun ? ' (dry run)' : ''}`);
    if (liveOnly) {
      report.live = await liveSweep(dryRun);
      log('live', report.live.join(' | '));
      return report;
    }
    report.titleSweep = await titleSweep(dryRun);
    log('title sweep', JSON.stringify(report.titleSweep));
    if (rulesOnly) return report;
    report.availability = await availabilitySweep(
      limit || parseInt(process.env.MAINTENANCE_CHECKS_PER_RUN, 10) || 15000,
      concurrency || parseInt(process.env.MAINTENANCE_CONCURRENCY, 10) || 3,
      dryRun
    );
    log('availability', JSON.stringify(report.availability));
    report.live = await liveSweep(dryRun);
    log('live', report.live.join(' | '));
    report.playlists = await playlistSweep(dryRun);
    log('playlists', JSON.stringify(report.playlists));
  } catch (e) {
    report.error = e.message;
    log('failed:', e.message);
  } finally {
    report.durationSec = Math.round((Date.now() - started) / 1000);
    lastRun = report;
    running = false;
  }
  return report;
}

function scheduleMaintenance() {
  if (/^(0|false|no)$/i.test(process.env.MAINTENANCE_ENABLED || '')) {
    log('disabled (MAINTENANCE_ENABLED=false)');
    return;
  }
  const hour = parseInt(process.env.MAINTENANCE_HOUR, 10);
  const runHour = Number.isFinite(hour) ? hour : 4;
  const next = new Date();
  next.setUTCHours(runHour, 0, 0, 0);
  if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1);
  const wait = next - Date.now();
  log(`next run ${next.toISOString()}`);
  setTimeout(function tick() {
    runMaintenance().finally(() => setTimeout(tick, 24 * 3600 * 1000));
  }, wait);
}

module.exports = { runMaintenance, scheduleMaintenance, getLastRun: () => lastRun, isRunning: () => running, checkVideo, liveStatus };

// CLI: node src/jobs/maintenance.js [--dry-run] [--limit N] [--live-only] [--rules-only]
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
  const args = process.argv.slice(2);
  const { connectDb } = require('../db/mongodb');
  (async () => {
    await connectDb();
    const report = await runMaintenance({
      dryRun: args.includes('--dry-run'),
      liveOnly: args.includes('--live-only'),
      rulesOnly: args.includes('--rules-only'),
      limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : undefined,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
