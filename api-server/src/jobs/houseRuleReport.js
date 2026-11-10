// House-rule impact report / undo.
//   node src/jobs/houseRuleReport.js           → per-channel counts: playable vs excluded by the house rules
//   node src/jobs/houseRuleReport.js --undo    → restore every video excluded by the house-rule sweep
//   node src/jobs/houseRuleReport.js --undo --reason "under 15 min"   → restore only that rule
//   node src/jobs/houseRuleReport.js --language → preview the English-only rule by show (no writes)
//   node src/jobs/houseRuleReport.js --purge   → how many would be DELETED (no writes)
//   node src/jobs/houseRuleReport.js --purge --yes → back them up to backups/*.jsonl, then DELETE them from MongoDB
//   node src/jobs/houseRuleReport.js --resync  → restore videos that no longer break the CURRENT rules
//                                                (after setting HOUSE_RULE_MIN_MINUTES in .env)
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { connectDb, Video, PluginVideo } = require('../db/mongodb');
const { SHORT_FORM_CATEGORIES, MIN_SECONDS_OVERRIDES } = require('../content/contentFilter');

const REASONS = ['compilation (daily sweep)', 'under 15 min (daily sweep)', 'non-English (daily sweep)'];
const args = process.argv.slice(2);

(async () => {
  await connectDb();
  // --language: preview what the English-only rule would remove (no writes)
  if (args.includes('--language')) {
    const { nonEnglishReason } = require('../content/contentFilter');
    const byShow = new Map();
    for await (const v of Video.find({ excluded: { $ne: true } }).select('title language uploader showName decade category standaloneChannel').lean().cursor()) {
      const why = nonEnglishReason(v.title, v.language, v.uploader);
      if (!why) continue;
      const k = `${v.standaloneChannel || v.decade + ' ' + v.category} / ${v.showName || '?'}`;
      if (!byShow.has(k)) byShow.set(k, []);
      byShow.get(k).push(`${why.replace('non-English ', '')}  ${v.title}`);
    }
    const rows = [...byShow.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [k, list] of rows) {
      console.log(`\n${k} — ${list.length}`);
      for (const l of list.slice(0, 4)) console.log('   ' + l);
    }
    console.log(`\nTOTAL non-English: ${rows.reduce((n, [, l]) => n + l.length, 0)} videos in ${rows.length} shows`);
    process.exit(0);
  }
  if (args.includes('--purge')) {
    const fs = require('fs');
    const path = require('path');
    const q = { excluded: true, excludedReason: { $in: REASONS } };
    const counts = {};
    for (const Model of [Video, PluginVideo]) counts[Model.modelName] = await Model.countDocuments(q);
    console.log('house-rule videos to delete:', JSON.stringify(counts));
    if (!args.includes('--yes')) { console.log('dry run — add --yes to back up and delete'); process.exit(0); }
    const dir = path.join(__dirname, '../../backups');
    fs.mkdirSync(dir, { recursive: true });
    for (const Model of [Video, PluginVideo]) {
      if (!counts[Model.modelName]) continue;
      const file = path.join(dir, `house-rule-purge-${Model.modelName}-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.jsonl`);
      const out = fs.createWriteStream(file);
      let n = 0;
      for await (const doc of Model.find(q).lean().cursor()) { out.write(JSON.stringify(doc) + '\n'); n++; }
      await new Promise((r) => out.end(r));
      if (n !== counts[Model.modelName]) { console.error(`backup count mismatch for ${Model.modelName} (${n} vs ${counts[Model.modelName]}) — nothing deleted`); process.exit(1); }
      const r = await Model.deleteMany(q);
      console.log(`${Model.modelName}: backed up ${n} → ${path.relative(process.cwd(), file)}, deleted ${r.deletedCount}`);
    }
    console.log('playlist video counts refresh on the next daily maintenance run');
    process.exit(0);
  }
  if (args.includes('--resync')) {
    console.log('current minimums:', JSON.stringify({ default: '15 min', ...Object.fromEntries(Object.entries(MIN_SECONDS_OVERRIDES).map(([c, s]) => [c, `${s / 60} min`])) }));
    for (const Model of [Video, PluginVideo]) {
      const restore = { excluded: true, excludedReason: REASONS[1], $or: [
        { category: { $in: SHORT_FORM_CATEGORIES } },
        ...Object.entries(MIN_SECONDS_OVERRIDES).map(([c, sec]) => ({ category: c, duration: { $gte: sec } })),
      ] };
      const r = await Model.updateMany(restore, { $set: { excluded: false, excludedReason: '' } });
      console.log(`${Model.modelName}: restored ${r.modifiedCount} short videos that pass the current minimums`);
    }
    process.exit(0);
  }
  if (args.includes('--undo')) {
    const only = args.includes('--reason') ? args[args.indexOf('--reason') + 1] : null;
    const reasons = only ? REASONS.filter((r) => r.startsWith(only)) : REASONS;
    for (const Model of [Video, PluginVideo]) {
      const r = await Model.updateMany({ excluded: true, excludedReason: { $in: reasons } },
        { $set: { excluded: false, excludedReason: '' } });
      console.log(`${Model.modelName}: restored ${r.modifiedCount} (${reasons.join(', ')})`);
    }
    process.exit(0);
  }
  const rows = await Video.aggregate([
    { $group: {
      _id: { channel: { $cond: [{ $gt: ['$standaloneChannel', ''] }, '$standaloneChannel', { $concat: ['$decade', ' ', '$category'] }] } },
      active: { $sum: { $cond: [{ $ne: ['$excluded', true] }, 1, 0] } },
      short: { $sum: { $cond: [{ $eq: ['$excludedReason', REASONS[1]] }, 1, 0] } },
      comp: { $sum: { $cond: [{ $eq: ['$excludedReason', REASONS[0]] }, 1, 0] } },
      foreign: { $sum: { $cond: [{ $eq: ['$excludedReason', REASONS[2]] }, 1, 0] } },
    } },
    { $sort: { active: 1 } },
  ]);
  console.log('channel'.padEnd(34), 'still playable'.padStart(14), 'cut <15m'.padStart(9), 'cut comp'.padStart(9), 'cut lang'.padStart(9));
  for (const r of rows) {
    const flag = r.active === 0 ? '  ← EMPTY' : r.active < 50 ? '  ← thin' : '';
    console.log(String(r._id.channel).padEnd(34), String(r.active).padStart(14), String(r.short).padStart(9), String(r.comp).padStart(9), String(r.foreign).padStart(9) + flag);
  }
  const t = rows.reduce((a, r) => ({ active: a.active + r.active, short: a.short + r.short, comp: a.comp + r.comp, foreign: a.foreign + r.foreign }), { active: 0, short: 0, comp: 0, foreign: 0 });
  console.log('TOTAL'.padEnd(34), String(t.active).padStart(14), String(t.short).padStart(9), String(t.comp).padStart(9), String(t.foreign).padStart(9));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
