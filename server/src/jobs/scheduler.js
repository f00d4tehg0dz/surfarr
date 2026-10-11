'use strict';

// Background jobs. No cron library: a timer wakes at the top of every minute
// and runs whatever is due, using local time (set TZ in Docker / .env).
// Schedule overview:
//   3:00 AM  — Daily sync from remote VPS API → LowDB cachedVideos
//   4:00 AM  — Dead-link cleanup (checks reports + validates videos)
//   Every 1h — Refresh EPG cache (pre-generate XMLTV for the next 24h)

const JOBS = [
  {
    name: 'daily sync',
    due: (d) => d.getHours() === 3 && d.getMinutes() === 0,
    run: () => require('./dailySync').runDailySync(),
  },
  {
    name: 'dead-link cleanup',
    due: (d) => d.getHours() === 4 && d.getMinutes() === 0,
    run: () => require('../reports/cleanup').runCleanup(),
  },
  {
    name: 'EPG cache refresh',
    due: (d) => d.getMinutes() === 0,
    run: () => require('../epg/generator').invalidateCache(),
  },
];

const running = new Set();
let lastTick = '';

function tick() {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
  if (stamp !== lastTick) {
    lastTick = stamp; // never run the same minute twice (timer drift)
    for (const job of JOBS) {
      if (!job.due(now) || running.has(job.name)) continue; // skip if the last run is still going
      running.add(job.name);
      console.log(`[Scheduler] Running ${job.name}...`);
      Promise.resolve()
        .then(job.run)
        .catch((err) => console.error(`[Scheduler] ${job.name} failed:`, err.message))
        .finally(() => running.delete(job.name));
    }
  }
  // Re-arm for just after the next minute boundary.
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 250).unref();
}

function initScheduler() {
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 250).unref();
  console.log('[Scheduler] Jobs registered (3:00 sync, 4:00 cleanup, hourly guide refresh).');
}

module.exports = { initScheduler, _jobs: JOBS };
