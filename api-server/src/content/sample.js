'use strict';

// A grid channel can hold far more videos than a client should cache (90s
// Cartoons ≈ 19k). Returning the first N in insertion order meant the same
// early-imported shows forever and newly added shows never aired. Instead:
// round-robin across shows so every show gets a fair share, in an order that
// is deterministic for the current week — every SurfArr instance that syncs
// in the same week gets the identical list, so the virtual clock still shows
// the same video to everyone, and the selection rotates weekly.
const DEFAULT_LIMIT = 1500;
const MAX_LIMIT = 3000;

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function weekSeed(key) {
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return hashString(`${key}|${week}`);
}
function seededShuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function balancedSample(videos, limit, seed) {
  // stable base order so the seed alone decides the result
  const sorted = videos.slice().sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  if (sorted.length <= limit) return sorted;
  const rand = mulberry32(seed);
  const byShow = new Map();
  for (const v of sorted) {
    const k = v.showName || v.playlistId || '?';
    if (!byShow.has(k)) byShow.set(k, []);
    byShow.get(k).push(v);
  }
  const queues = seededShuffle([...byShow.keys()].sort(), rand).map((k) => seededShuffle(byShow.get(k), rand));
  const out = [];
  for (let round = 0; out.length < limit; round++) {
    let took = false;
    for (const q of queues) {
      if (round < q.length) { out.push(q[round]); took = true; if (out.length >= limit) break; }
    }
    if (!took) break;
  }
  return out;
}

module.exports = { balancedSample, weekSeed, DEFAULT_LIMIT, MAX_LIMIT };
