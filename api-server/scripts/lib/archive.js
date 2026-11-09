'use strict';

// Internet Archive (archive.org) helpers: search, item metadata and turning an
// item (or a collection of single-episode items) into SurfArr videos.
//
// Only browser/FFmpeg-friendly MP4 files are used: an item's original .mp4 or
// the h.264 / MPEG4 derivative the Archive makes of .avi/.mkv/.mpg uploads.
// Video IDs are "ia:<identifier>/<file>" (api-server/src/content/mediaSource.js).

const { archiveId, archiveThumbUrl } = require('../../src/content/mediaSource');

const UA = 'SurfArr/1.1 (+https://surfarr.tv; catalog discovery)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

// ~2 requests/second, retry on 429/5xx
async function iaJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const wait = last + 500 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error('archive.org unavailable');
}

/** advancedsearch → docs [{identifier,title,mediatype,collection,language,downloads,...}] */
async function search(q, { rows = 50, fields = ['identifier', 'title', 'mediatype', 'collection', 'language', 'downloads', 'item_size', 'year'], sort = 'downloads desc' } = {}) {
  const p = new URLSearchParams({ q, rows: String(rows), output: 'json' });
  for (const f of fields) p.append('fl[]', f);
  if (sort) p.append('sort[]', sort);
  const j = await iaJson(`https://archive.org/advancedsearch.php?${p}`);
  return (j.response && j.response.docs) || [];
}

async function metadata(identifier) {
  return iaJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
}

// "1402.54" | "23:21" | "1:02:03" → seconds
function parseLength(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0));
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Language metadata → true (English / unknown) or false
function englishLanguage(meta) {
  const langs = asList(meta && meta.language).map((l) => String(l).toLowerCase());
  if (!langs.length) return true;
  return langs.some((l) => /^(en|eng|english)\b/.test(l));
}

// Playable MP4 files of an item, one per episode, in item order.
function playableFiles(files) {
  const byBase = new Map();
  for (const f of files || []) {
    const name = f.name || '';
    const fmt = String(f.format || '');
    const isMp4 = /\.mp4$/i.test(name) || /h\.264|mpeg4/i.test(fmt);
    if (!isMp4 || /\.(jpg|png|gif|txt|xml|sqlite|torrent)$/i.test(name)) continue;
    // Derivatives are named after their original: "ep1.avi" → "ep1.mp4" / "ep1.ia.mp4"
    const base = (f.original || name).replace(/\.ia\.mp4$/i, '').replace(/\.[^./]+$/, '');
    const rank = f.source === 'original' && /h\.264/i.test(fmt) ? 3 : /h\.264/i.test(fmt) ? 2 : 1;
    const cur = byBase.get(base);
    if (!cur || rank > cur.rank) byBase.set(base, { file: f, rank });
  }
  return [...byBase.values()].map((x) => x.file)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
}

function episodeTitle(f, itemTitle) {
  const raw = first(f.title) || String(f.name).split('/').pop().replace(/\.(ia\.)?mp4$/i, '').replace(/[_.]+/g, ' ').trim();
  return String(raw).replace(/\s+/g, ' ');
}

/**
 * Videos in one archive.org item → [{ id, title, duration, thumbnailUrl, uploader, language, description }]
 * @param {object} meta — /metadata/<id> response (fetched if a string identifier is passed)
 */
async function itemVideos(metaOrId, showName, filter) {
  const meta = typeof metaOrId === 'string' ? await metadata(metaOrId) : metaOrId;
  const md = meta.metadata || {};
  const identifier = md.identifier;
  const english = englishLanguage(md);
  return playableFiles(meta.files).map((f) => {
    let title = episodeTitle(f, first(md.title));
    // Episode files are often just "S01E03 The Big Race" — give the content
    // filter (which wants the show name or an episode marker) the show name.
    if (showName && filter && !filter.mentionsShow(title, showName)) title = `${showName} - ${title}`;
    return {
      id: archiveId(identifier, f.name),
      title,
      description: String(first(md.description) || '').replace(/<[^>]+>/g, ' ').slice(0, 500),
      duration: parseLength(f.length),
      thumbnailUrl: archiveThumbUrl(archiveId(identifier, f.name)),
      uploader: String(first(md.uploader) || first(md.creator) || 'Internet Archive'),
      language: english ? 'en' : String(first(md.language)),
    };
  });
}

/** archive.org URL → { identifier, kind } ('details/<id>' or 'download/<id>') */
function parseArchiveUrl(url) {
  const m = String(url).match(/archive\.org\/(?:details|download|embed)\/([^/?#\s]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * List every video behind an archive.org URL. An item gives its files; a
 * collection gives one video (the longest playable file) per member item.
 */
async function listArchive(url, showName, filter, { maxItems = 400 } = {}) {
  // Search URL: one item per episode, no collection → every matching item's main file
  const sq = String(url).match(/archive\.org\/search(?:\.php)?\?(?:.*&)?query=([^&#\s]+)/i);
  if (sq) {
    const q = decodeURIComponent(sq[1].replace(/\+/g, ' '));
    return membersVideos(await search(`(${q}) AND mediatype:(movies)`, { rows: maxItems, sort: 'titleSorter asc' }), showName, filter);
  }
  const identifier = parseArchiveUrl(url);
  if (!identifier) throw new Error(`not an archive.org item URL: ${url}`);
  const meta = await metadata(identifier);
  if (!meta || !meta.metadata) throw new Error(`archive.org item not found: ${identifier}`);
  if (first(meta.metadata.mediatype) !== 'collection') return itemVideos(meta, showName, filter);

  const members = await search(`collection:(${identifier}) AND mediatype:(movies)`, { rows: maxItems, sort: 'titleSorter asc' });
  return membersVideos(members, showName, filter);
}

// One video (the longest playable file) per item
async function membersVideos(docs, showName, filter) {
  const out = [];
  for (const d of docs) {
    try {
      const vids = await itemVideos(d.identifier, showName, filter);
      if (!vids.length) continue;
      const main = vids.reduce((a, b) => (b.duration > a.duration ? b : a));
      // Single-episode items carry the episode name in the item title
      if (d.title && vids.length === 1) main.title = String(first(d.title));
      out.push(main);
    } catch { /* skip unreadable item */ }
  }
  return out;
}

function searchUrl(query) {
  return `https://archive.org/search?query=${encodeURIComponent(query)}`;
}

module.exports = { search, metadata, parseLength, playableFiles, itemVideos, membersVideos, listArchive, parseArchiveUrl, searchUrl, englishLanguage };
