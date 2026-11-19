'use strict';

// Channel logos, drawn on the fly as PNG tiles: GET /logo/<channel-id>.png
//
// Media servers and IPTV players want a picture per channel (XMLTV <icon>,
// M3U tvg-logo). SurfArr has no artwork for its channels, so it draws a
// simple tile with the channel name and number. No image library: a tiny
// 5x7 pixel font and a hand-rolled PNG writer on top of Node's zlib.

const express = require('express');
const zlib = require('zlib');
const { getDb } = require('../db/lowdb');

const router = express.Router();

const SIZE = 400;
const PAD = 28;
const BAND = 64; // bottom strip with the channel number

// 5x7 glyphs, one string per row, '#' = pixel on
const FONT = {
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ### '],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['  ###', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  0: [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  2: [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  3: ['#### ', '    #', '    #', ' ### ', '    #', '    #', '#### '],
  4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  5: ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  6: [' ### ', '#    ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  7: ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  8: [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  9: [' ### ', '#   #', '#   #', ' ####', '    #', '    #', ' ### '],
  '&': [' ##  ', '#  # ', '# #  ', ' #   ', '# # #', '#  # ', ' ## #'],
  '/': ['    #', '    #', '   # ', '  #  ', ' #   ', '#    ', '#    '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  ':': ['     ', ' ##  ', ' ##  ', '     ', ' ##  ', ' ##  ', '     '],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '],
  "'": ['  #  ', '  #  ', ' #   ', '     ', '     ', '     ', '     '],
  '+': ['     ', '  #  ', '  #  ', '#####', '  #  ', '  #  ', '     '],
};

// Background per kind of channel (white text reads on all of them)
const DECADE_COLORS = {
  '60s': [0xc9, 0x6a, 0x12],
  '70s': [0x9c, 0x54, 0x1a],
  '80s': [0xb8, 0x14, 0x6e],
  '90s': [0x0b, 0x7d, 0x7d],
  '00s': [0x1f, 0x5f, 0xc4],
  '10s': [0x5e, 0x3b, 0xb0],
  '20s': [0x33, 0x47, 0x56],
};
const LIVE_COLOR = [0xb7, 0x1c, 0x1c];
const PLUGIN_COLOR = [0x2b, 0x6e, 0x31];
const THEMED_COLOR = [0x8e, 0x2a, 0x4f];
const WHITE = [255, 255, 255];

function colorFor(ch) {
  if (ch.isLive) return LIVE_COLOR;
  if (ch.isPlugin) return PLUGIN_COLOR;
  if (ch.isStandalone) return THEMED_COLOR;
  return DECADE_COLORS[ch.decade] || THEMED_COLOR;
}

const darker = (c) => c.map((v) => Math.round(v * 0.62));

// Only characters the font has; everything else becomes a space
function clean(text) {
  return String(text || '')
    .toUpperCase()
    .slice(0, 80)
    .split('')
    .map((c) => (FONT[c] || c === ' ' ? c : ' '))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Greedy word wrap; a word longer than the line is cut
function wrap(text, maxChars, maxLines) {
  const lines = [];
  let line = '';
  for (const raw of text.split(' ')) {
    const word = raw.slice(0, maxChars);
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

const textWidth = (str, scale) => (str.length * 6 - 1) * scale;

function fillRect(px, x, y, w, h, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(SIZE, x + w);
  const y1 = Math.min(SIZE, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * SIZE + xx) * 3;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
    }
  }
}

function drawText(px, str, x, y, scale, color) {
  let cx = x;
  for (const ch of str) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (glyph[r][c] !== '#') continue;
          fillRect(px, cx + c * scale, y + r * scale, scale, scale, color);
        }
      }
    }
    cx += 6 * scale;
  }
}

// --- PNG ---------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = SIZE * 3;
  const raw = Buffer.alloc((row + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (row + 1)] = 0; // no filter
    px.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Tile --------------------------------------------------------------------
function renderLogo(ch) {
  const bg = colorFor(ch);
  const px = Buffer.alloc(SIZE * SIZE * 3);
  fillRect(px, 0, 0, SIZE, SIZE, bg);
  fillRect(px, 0, SIZE - BAND, SIZE, BAND, darker(bg));

  // Decade channels read best as "90s" over "CARTOONS"
  const grid = !ch.isStandalone && !ch.isPlugin && !ch.isLive && ch.decade && ch.category;
  let lines = grid
    ? [clean(ch.decade), ...wrap(clean(ch.category), 11, 2)]
    : wrap(clean(ch.name), 11, 4);
  if (!lines.length) lines = ['SURFARR'];

  const areaW = SIZE - PAD * 2;
  const areaH = SIZE - BAND - PAD * 2;
  const longest = Math.max(...lines.map((l) => l.length));
  const scale = Math.max(2, Math.min(
    Math.floor(areaW / (longest * 6 - 1)),
    Math.floor(areaH / (lines.length * 9 - 2)),
    12
  ));
  const blockH = (lines.length * 9 - 2) * scale;
  let y = PAD + Math.floor((areaH - blockH) / 2);
  for (const line of lines) {
    drawText(px, line, Math.floor((SIZE - textWidth(line, scale)) / 2), y, scale, WHITE);
    y += 9 * scale;
  }

  const label = ch.isLive ? `LIVE ${ch.channelNumber}` : `CH ${ch.channelNumber}`;
  const ls = 4;
  drawText(px, label, Math.floor((SIZE - textWidth(label, ls)) / 2), SIZE - BAND + Math.floor((BAND - 7 * ls) / 2), ls, WHITE);

  return encodePng(px);
}

// Tiles are tiny and channels are few: keep them all, redraw only when the
// name or number changes.
const cache = new Map();

function logoFor(ch) {
  const key = [ch.id, ch.name, ch.channelNumber, ch.decade, ch.category, !!ch.isLive, !!ch.isPlugin, !!ch.isStandalone].join('|');
  let png = cache.get(key);
  if (!png) {
    if (cache.size > 1000) cache.clear();
    png = renderLogo(ch);
    cache.set(key, png);
  }
  return png;
}

router.get('/logo/:file', (req, res) => {
  const id = String(req.params.file || '').replace(/\.png$/i, '');
  const ch = getDb().data.channels.find((c) => c.id === id);
  if (!ch) return res.status(404).end();
  const png = logoFor(ch);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', png.length);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(png);
});

// URL a player can fetch the logo from
function logoUrl(baseUrl, ch) {
  return `${baseUrl}/logo/${encodeURIComponent(ch.id)}.png`;
}

module.exports = router;
module.exports.logoUrl = logoUrl;
module.exports.renderLogo = renderLogo;
