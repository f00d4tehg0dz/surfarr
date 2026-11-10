'use strict';

// Where a video's bytes live. Video IDs are plain YouTube IDs, or
//   ia:<archive.org identifier>/<file path inside the item>
// for Internet Archive files (e.g. "ia:bonanza_s01/Bonanza S01E01.mp4").
//
// KEEP IN SYNC: server/src/content/mediaSource.js and
// client/src/components/shared/media.js are copies.

const IA_PREFIX = 'ia:';

function isArchiveId(id) {
  return typeof id === 'string' && id.startsWith(IA_PREFIX);
}

function archiveId(identifier, file) {
  return `${IA_PREFIX}${identifier}/${file}`;
}

function parseArchiveId(id) {
  if (!isArchiveId(id)) return null;
  const rest = id.slice(IA_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 1) return null;
  return { identifier: rest.slice(0, slash), file: rest.slice(slash + 1) };
}

// Direct, range-capable file URL (archive.org redirects to a storage node)
function archiveFileUrl(id) {
  const p = parseArchiveId(id);
  if (!p) return null;
  const file = p.file.split('/').map(encodeURIComponent).join('/');
  return `https://archive.org/download/${encodeURIComponent(p.identifier)}/${file}`;
}

function archiveThumbUrl(id) {
  const p = parseArchiveId(id);
  return p ? `https://archive.org/services/img/${encodeURIComponent(p.identifier)}` : '';
}

function sourceOf(id) {
  return isArchiveId(id) ? 'archive' : 'youtube';
}

module.exports = { IA_PREFIX, isArchiveId, archiveId, parseArchiveId, archiveFileUrl, archiveThumbUrl, sourceOf };
