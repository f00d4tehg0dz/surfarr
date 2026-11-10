'use strict';
// Episode titles per show from Wikipedia ("List of <show> episodes"),
// cached in yaml/episode-titles/<slug>.json. Used by the content filter's
// show-match rule: a video whose title is just "Heart of Ice" is accepted
// for Batman: The Animated Series because that is a real episode title.
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(process.env.YAML_DIR ? path.resolve(process.env.YAML_DIR) : path.join(__dirname, '..', '..', 'yaml'), 'episode-titles');
// Wikimedia's User-Agent policy wants a descriptive UA with a contact URL;
// generic/bursty clients get HTTP 403. Api-User-Agent is the documented
// header for identifying API tools.
const UA_STRING = 'SurfArrEpisodeTitles/1.1 (https://github.com/f00d4tehg0dz/surfarr; episode-title lookup for a self-hosted TV project) node-fetch';
const UA = { headers: { 'User-Agent': UA_STRING, 'Api-User-Agent': UA_STRING, 'Accept': 'application/json' } };
const API = 'https://en.wikipedia.org/w/api.php?format=json&maxlag=5';

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function cachePath(show) { return path.join(CACHE_DIR, `${slugify(show)}.json`); }

function cached(show) {
  try { return JSON.parse(fs.readFileSync(cachePath(show), 'utf8')); } catch { return null; }
}

// Remove a pattern until there is nothing left of it: one pass over
// "<!-<!-- x -->- y -->" would leave a new "<!-- y -->" behind.
function stripAll(s, re) {
  let prev;
  do {
    prev = s;
    s = s.replace(re, '');
  } while (s !== prev);
  return s;
}

function cleanWiki(s) {
  let out = stripAll(String(s), /<!--[\s\S]*?-->/g)
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    // footnote templates carry notes ("Working title: …"), not titles
    .replace(/\{\{\s*(efn|refn|sfn|notetag|note|cn|citation needed|anchor)[^{}]*\}\}/gi, '')
    .replace(/<br\s*\/?>|<hr\s*\/?>/gi, ' / ')
    .replace(/\{\{[^{}]*\|([^{}|]+)\}\}/g, '$1')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'{2,}/g, '');
  // Tags go until none are left; a stray < or > after that is the rest of a
  // broken tag, never part of a title.
  out = stripAll(out, /<[^>]+>/g).replace(/[<>]/g, '');
  return out
    .replace(/"\s*"/g, '" / "') // "Segment A""Segment B"
    .trim();
}

// Wikipedia rate-limits bursts (HTTP 429) — an audit asks for thousands of
// shows back to back. Space requests out and retry with backoff; a failure
// throws so the (empty) result isn't cached and the next run tries again.
let lastRequest = 0;
async function wikiJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastRequest + 1000 - Date.now(); // ≤ 1 request/second
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url, UA);
    if (res.ok) {
      const j = await res.json();
      if (j && j.error && j.error.code === 'maxlag') { await new Promise((r) => setTimeout(r, 5000)); continue; }
      return j;
    }
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
    if (![403, 429].includes(res.status) && res.status < 500) throw new Error(`HTTP ${res.status} ${body}`);
    if (attempt === 3) throw new Error(`HTTP ${res.status} ${body}`);
    await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
  }
  throw new Error('Wikipedia rate limit');
}

// Words of a name, lowercased, without articles / possessives / punctuation
const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'list', 'episodes', 'episode', 'series', 'tv', 'show', 'animated', 'season', 'seasons', 'cartoon', 'serial', 'new', 'all']);
function words(s) {
  return String(s).toLowerCase().replace(/['’]s\b/g, '').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
}
// "List of Heathcliff episodes" is right for "Heathcliff and the Catillac
// Cats"; "Charlie's Angels" is not right for "Charlie Brown" and a random
// anime list is not right for "The Funky Phantom". Every meaningful word of
// the page title must be part of the show name.
function pageMatchesShow(pageTitle, show) {
  if (!/episodes|series|show/i.test(pageTitle)) return false;
  const core = words(pageTitle);
  const name = new Set(words(show));
  const squashed = words(show).join('');
  return core.length > 0 && core.every((w) => name.has(w) || squashed.includes(w));
}

async function fetchTitles(show) {
  const titles = new Set();
  const base = String(show).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const q = encodeURIComponent(`List of ${base} episodes`);
  const sr = await wikiJson(`${API}&action=query&list=search&srlimit=4&srsearch=${q}`);
  const pages = (sr.query?.search || []).map((r) => r.title).filter((t) => pageMatchesShow(t, base));
  for (const page of pages.slice(0, 2)) {
    const pr = await wikiJson(`${API}&action=parse&prop=wikitext&page=${encodeURIComponent(page)}`);
    const wt = pr.parse?.wikitext?.['*'] || '';
    // value runs until the next "| Field =" or the end of the template, so
    // multi-line segment titles ("A"<br />\n"B") are kept together
    for (const m of wt.matchAll(/\|\s*(?:Title|RTitle|AltTitle)\s*=\s*([\s\S]*?)(?=\n\s*\||\n\s*\}\}|\|\s*[A-Z][A-Za-z_0-9]+\s*=)/g)) {
      const raw = cleanWiki(m[1]);
      for (const part of raw.split(/\s*(?:\/|;| & ")\s*/)) {
        const t = part.replace(/^["“]|["”]$/g, '').replace(/\s*\(.*?\)\s*$/, '').replace(/\s+/g, ' ').trim();
        if (/^(working title|also titled|originally titled|a\s*working title)/i.test(t)) continue;
        if (t.length >= 3 && t.length <= 80) titles.add(t);
      }
    }
    if (titles.size) break;
  }
  return [...titles];
}

// Shows whose lookup failed this run (network / rate limit) → error message.
// Callers treat these as "unknown", not "no episode titles".
const failed = new Map();
const errorCounts = {};
let consecutiveFailures = 0;
const BREAKER = 8; // after this many failures in a row, stop asking Wikipedia this run

/** Titles for a show — cache first; fetch (and cache) when allowed. */
// Caches written by the first parser version can hold footnote text or
// segment titles glued together ('Super-Flea""A Bug's Strife'). Re-fetch
// those when fetching is allowed. (An empty cache just means "no known list",
// which safely switches the show-match rule off for that show.)
function looksStale(list) {
  return !Array.isArray(list) || list.some((t) => /""|working title|also titled/i.test(t));
}

async function getEpisodeTitles(show, { fetchMissing = true } = {}) {
  const c = cached(show);
  if (c && !(fetchMissing && looksStale(c))) return Array.isArray(c) ? c : [];
  if (!fetchMissing) return [];
  if (failed.has(show)) return [];
  if (consecutiveFailures >= BREAKER) { failed.set(show, 'skipped (Wikipedia unavailable)'); return []; }
  let list = [];
  try {
    list = await fetchTitles(show);
    consecutiveFailures = 0;
  } catch (e) { // don't cache network errors
    consecutiveFailures++;
    const msg = String(e && (e.cause?.code || e.message) || e).slice(0, 80);
    failed.set(show, msg);
    errorCounts[msg] = (errorCounts[msg] || 0) + 1;
    if (consecutiveFailures === BREAKER) console.warn(`  ⚠ Wikipedia: ${BREAKER} lookups failed in a row (last: ${msg}) — not asking again this run`);
    return [];
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(show), JSON.stringify(list, null, 1));
  return list;
}

module.exports = {
  getEpisodeTitles,
  lookupFailed: (show) => failed.has(show),
  hasCache: (show) => cached(show) !== null,
  pageMatchesShow,
  fetchFailureCount: () => failed.size,
  fetchErrorSummary: () => ({ ...errorCounts }),
  cachedEpisodeTitles: (s) => cached(s) || [],
  slugify,
};
