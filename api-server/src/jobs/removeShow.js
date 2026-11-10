// Remove whole shows from MongoDB (videos, plugin videos, playlist records) with a JSONL backup.
// From api-server/:
//   node src/jobs/removeShow.js --playlist <id> [--playlist <id> ...] [--title "<regex>" ...]   → dry run
//   ... --yes   → back up to backups/*.jsonl, then delete
// --title matches the video title OR show name, case-insensitive (e.g. --title "around the world").
// Also remove the show's line from its yaml file, or the next import brings it back.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { connectDb, Video, PluginVideo, Playlist } = require('../db/mongodb');

const args = process.argv.slice(2);
const multi = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : [])).filter(Boolean);
const ids = multi('--playlist');
const titles = multi('--title');

(async () => {
  if (!ids.length && !titles.length) {
    console.error('usage: node src/jobs/removeShow.js [--playlist <id>]... [--title "<regex>"]... [--yes]');
    process.exit(1);
  }
  await connectDb();
  const or = [];
  if (ids.length) or.push({ playlistId: { $in: ids } });
  for (const t of titles) or.push({ title: { $regex: t, $options: 'i' } }, { showName: { $regex: t, $options: 'i' } });
  const q = { $or: or };
  const plQ = { $or: [...(ids.length ? [{ playlistId: { $in: ids } }] : []), ...titles.map((t) => ({ showName: { $regex: t, $options: 'i' } }))] };

  const counts = {};
  for (const M of [Video, PluginVideo]) counts[M.modelName] = await M.countDocuments(q);
  const playlists = await Playlist.find(plQ).select('playlistId showName').lean();
  console.log('playlists:', playlists.map((p) => `${p.showName} (${p.playlistId})`).join(', ') || '(none)');
  for (const M of [Video, PluginVideo]) {
    if (!counts[M.modelName]) continue;
    const byShow = await M.aggregate([{ $match: q }, { $group: { _id: { show: '$showName', ch: { $ifNull: ['$standaloneChannel', ''] }, d: '$decade', c: '$category' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
    console.log(`${M.modelName}: ${counts[M.modelName]}`);
    for (const r of byShow) console.log(`   ${String(r.n).padStart(5)}  ${r._id.show || '?'}  [${r._id.ch || `${r._id.d} ${r._id.c}`}]`);
  }
  if (!args.includes('--yes')) { console.log('dry run — check the list above, then add --yes to back up and delete'); process.exit(0); }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `remove-show-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.jsonl`);
  const out = fs.createWriteStream(file);
  const written = {};
  for (const M of [Video, PluginVideo]) {
    written[M.modelName] = 0;
    for await (const d of M.find(q).lean().cursor()) { out.write(JSON.stringify({ collection: M.collection.name, ...d }) + '\n'); written[M.modelName]++; }
  }
  for (const p of await Playlist.find(plQ).lean()) out.write(JSON.stringify({ collection: 'playlists', ...p }) + '\n');
  await new Promise((r) => out.end(r));
  for (const M of [Video, PluginVideo]) {
    if (written[M.modelName] !== counts[M.modelName]) { console.error(`backup count mismatch for ${M.modelName} — nothing deleted`); process.exit(1); }
  }
  for (const M of [Video, PluginVideo]) console.log(`${M.modelName}: deleted ${(await M.deleteMany(q)).deletedCount}`);
  console.log(`playlists: deleted ${(await Playlist.deleteMany(plQ)).deletedCount}`);
  console.log(`backup → ${path.relative(process.cwd(), file)}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
