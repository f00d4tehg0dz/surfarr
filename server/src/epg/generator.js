'use strict';

// XMLTV EPG generator.
// Generates a 24-hour lookahead guide for all enabled channels.
//
// CRITICAL: Uses the exact same seededShuffle + buildSeed logic as
// virtualClock.js — they must agree on program order or the guide
// will show different programs than what's actually playing.
//
// Output format: XMLTV (xmltv.dtd), accepted by Plex, Jellyfin, Emby.

const virtualClock = require('../channels/virtualClock');
const config = require('../config');
const { logoUrl } = require('../hdhr/channelLogo');
const { isArchiveId, archiveThumbUrl } = require('../content/mediaSource');

// Cache generated XML for 1 hour to avoid regenerating on every request
let cachedXml = null;
let cacheGeneratedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function invalidateCache() {
  cachedXml = null;
  cacheGeneratedAt = 0;
}

// Format a Unix ms timestamp to XMLTV date format: "20241225120000 +0000"
function formatXMLTVDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    ' +0000'
  );
}

// Picture for a programme: what the API gave us, or the stock thumbnail
// every YouTube video / Internet Archive item has.
function thumbFor(video) {
  if (!video) return '';
  if (/^https?:\/\//i.test(video.thumbnailUrl || '')) return video.thumbnailUrl;
  if (isArchiveId(video.id)) return archiveThumbUrl(video.id);
  if (/^[A-Za-z0-9_-]{11}$/.test(video.id || '')) return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  return '';
}

// XMLTV categories. Emby, Jellyfin and Plex sort the guide into Movies /
// Kids / Series from these words.
const XMLTV_CATEGORIES = {
  Movies: ['Movie'],
  Cartoons: ['Children', 'Animation'],
  Kids: ['Children'],
  Sitcoms: ['Series', 'Comedy'],
  Drama: ['Series', 'Drama'],
  Shows: ['Series'],
  Documentary: ['Documentary'],
  'Talk TV': ['Talk'],
  Specials: ['Special'],
};

function categoryXml(ch) {
  return (XMLTV_CATEGORIES[ch.category] || [])
    .map((c) => `    <category lang="en">${c}</category>\n`)
    .join('');
}

function iconXml(url) {
  return url ? `    <icon src="${escapeXml(url)}" />\n` : '';
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate XMLTV XML for all enabled channels.
 *
 * @param {object[]} channels — array of LowDB channel objects
 * @param {number} [startTime] — Unix ms (defaults to now)
 * @param {number} [hoursAhead] — how many hours to look ahead (default 24)
 * @returns {string} XMLTV XML
 */
function generateXMLTV(channels, startTime, hoursAhead) {
  startTime = startTime || Date.now();
  hoursAhead = hoursAhead || 24;

  const endTime = startTime + hoursAhead * 3600 * 1000;
  const enabledChannels = channels.filter((ch) =>
    ch.enabled && (ch.isLive ? !!ch.liveVideoId : ch.cachedVideos && ch.cachedVideos.length > 0)
  );

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<!DOCTYPE tv SYSTEM "xmltv.dtd">\n';
  xml += '<tv generator-info-name="SurfArr" generator-info-url="">\n\n';

  // Channel declarations (with a logo tile each)
  const baseUrl = config.getAdvertiseUrl(config.port);
  for (const ch of enabledChannels) {
    xml += `  <channel id="ch${ch.channelNumber}">\n`;
    xml += `    <display-name>${escapeXml(ch.name)}</display-name>\n`;
    xml += `    <display-name>${ch.channelNumber}</display-name>\n`;
    xml += iconXml(logoUrl(baseUrl, ch));
    xml += `  </channel>\n`;
  }
  xml += '\n';

  // Programme entries per channel
  for (const ch of enabledChannels) {
    // Live channels: no clock — one "LIVE" block per hour so guides that
    // require programme data still render something sensible.
    if (ch.isLive) {
      const HOUR = 3600 * 1000;
      const liveTitle = (ch.cachedVideos[0] && ch.cachedVideos[0].title) || ch.name;
      let cursor = Math.floor(startTime / HOUR) * HOUR;
      while (cursor < endTime) {
        xml += `  <programme start="${formatXMLTVDate(cursor)}" stop="${formatXMLTVDate(cursor + HOUR)}" channel="ch${ch.channelNumber}">\n`;
        xml += `    <title lang="en">${escapeXml(ch.name)}</title>\n`;
        xml += `    <desc lang="en">${escapeXml(`LIVE — ${liveTitle}`)}</desc>\n`;
        xml += `    <category lang="en">Live</category>\n`;
        xml += iconXml(thumbFor({ id: ch.liveVideoId, thumbnailUrl: ch.thumbnailUrl }));
        xml += `  </programme>\n`;
        cursor += HOUR;
      }
      continue;
    }

    const validVideos = virtualClock.playableVideos(ch.cachedVideos);
    if (!validVideos.length) continue;

    // Get the playhead at startTime — same logic as virtualClock
    const playhead = virtualClock.getPlayheadForChannel(ch, startTime);
    if (!playhead) continue;

    const { shuffledList, videoIndex, seekSeconds } = playhead;

    // cursor starts at the beginning of the current video (not mid-seek)
    let cursor = startTime - seekSeconds * 1000;
    let idx = videoIndex;

    while (cursor < endTime) {
      const video = shuffledList[idx % shuffledList.length];
      if (!video || !video.duration) {
        idx++;
        continue;
      }

      const progStart = formatXMLTVDate(cursor);
      const progEnd = formatXMLTVDate(cursor + video.duration * 1000);

      xml += `  <programme start="${progStart}" stop="${progEnd}" channel="ch${ch.channelNumber}">\n`;
      xml += `    <title lang="en">${escapeXml(video.title)}</title>\n`;
      if (video.description) {
        xml += `    <desc lang="en">${escapeXml(video.description)}</desc>\n`;
      }
      xml += categoryXml(ch);
      xml += iconXml(thumbFor(video));
      xml += `  </programme>\n`;

      cursor += video.duration * 1000;
      idx++;
    }
  }

  xml += '</tv>\n';
  return xml;
}

/**
 * Get XMLTV — returns cached version if fresh, otherwise regenerates.
 *
 * @param {object[]} channels
 * @returns {string}
 */
function getXMLTV(channels) {
  if (cachedXml && Date.now() - cacheGeneratedAt < CACHE_TTL_MS) {
    return cachedXml;
  }
  cachedXml = generateXMLTV(channels);
  cacheGeneratedAt = Date.now();
  return cachedXml;
}

module.exports = { getXMLTV, generateXMLTV, invalidateCache };