'use strict';

// Disabled channel registry — must stay in sync with
// server/src/channels/channelGrid.js DISABLED_CHANNELS.
//
// Anything listed here is hidden from the public API:
//   /config            — never lists the channel in channelGrid
//   /videos            — refuses queries for the matching decade+category
//   /videos/slim       — same
//   /videos/stats      — filters out rows for disabled combos
//
// This prevents disabled channels from "broadcasting" out to user apps
// even if a client probes the API directly.

const DECADES = ['60s', '70s', '80s', '90s', '00s', '10s', '20s'];
const CATEGORIES = [
  'Shows', 'Sitcoms', 'Cartoons', 'Movies', 'Commercials',
  'Drama', 'Specials', 'Theme Songs', 'Trailers', 'Bumpers',
  'Kids', 'Documentary', 'Talk TV',
];

// Standalone channel registry — channels that span decades or are pulled
// from a curated subset rather than the decade+category grid. Videos for
// these channels are tagged in the DB with `standaloneChannel: <slug>`.
//
// `slug` matches the value stored in `Video.standaloneChannel` (no "ch-" prefix).
// `decade`/`category` are used as the fallback when no curated docs exist yet,
// so a channel can launch with the parent decade's content and be replaced as
// curated content is seeded. The fallback bypasses the disabled-grid gate
// because a standalone channel is, by its presence here, explicitly enabled.
const STANDALONE_CHANNELS = [
  { id: 'ch-classic-nickelodeon',  slug: 'classic-nickelodeon',  channelNumber: 92,  name: 'Classic Nickelodeon',       decade: '90s', category: 'Cartoons'     },
  { id: 'ch-saturday-morning',     slug: 'saturday-morning',     channelNumber: 93,  name: 'Saturday Morning Cartoons', decade: '80s', category: 'Cartoons'     },
  { id: 'ch-unsolved-mysteries',   slug: 'unsolved-mysteries',   channelNumber: 94,  name: 'Unsolved Mysteries',        decade: '80s', category: 'Shows'        },
  { id: 'ch-fox-kids',             slug: 'fox-kids',             channelNumber: 95,  name: 'Fox Kids',                  decade: '90s', category: 'Cartoons'     },
  { id: 'ch-cartoon-cartoons',     slug: 'cartoon-cartoons',     channelNumber: 96,  name: 'Cartoon Cartoons',          decade: '90s', category: 'Cartoons'     },
  { id: 'ch-pbs-kids-classic',     slug: 'pbs-kids-classic',     channelNumber: 97,  name: 'PBS Kids Classic',          decade: '90s', category: 'Kids'         },
  { id: 'ch-mst3k',                slug: 'mst3k',                channelNumber: 98,  name: 'MST3K',                     decade: '90s', category: 'Shows'        },
  { id: 'ch-sci-fi-originals',     slug: 'sci-fi-originals',     channelNumber: 99,  name: 'Sci-Fi Originals',          decade: '80s', category: 'Shows'        },
  { id: 'ch-infomercials',         slug: 'infomercials',         channelNumber: 100, name: 'Infomercials',              decade: '90s', category: 'Commercials'  },
  { id: 'ch-late-night-classics',  slug: 'late-night-classics',  channelNumber: 101, name: 'Late Night Classics',       decade: '80s', category: 'Talk TV'      },
  { id: 'ch-classic-game-shows',   slug: 'classic-game-shows',   channelNumber: 102, name: 'Classic Game Shows',        decade: '70s', category: 'Shows'        },
  { id: 'ch-kids-wb',              slug: 'kids-wb',              channelNumber: 103, name: 'Kids WB',                   decade: '90s', category: 'Cartoons'     },
  { id: 'ch-disney-afternoon',     slug: 'disney-afternoon',     channelNumber: 104, name: 'Disney Afternoon',          decade: '90s', category: 'Cartoons'     },
  { id: 'ch-nick-at-nite',         slug: 'nick-at-nite',         channelNumber: 105, name: 'Nick at Nite',              decade: '70s', category: 'Sitcoms'      },
  { id: 'ch-80s-90s-commercials',  slug: '80s-90s-commercials',  channelNumber: 106, name: '80s/90s Commercials',       decade: '80s', category: 'Commercials'  },
  { id: 'ch-g4',                   slug: 'g4',                   channelNumber: 107, name: 'G4',                        decade: '00s', category: 'Shows'        },
  { id: 'ch-reality-tv',           slug: 'reality-tv',           channelNumber: 108, name: 'Reality TV',                decade: '00s', category: 'Shows'        },
];

// Index for O(1) lookup by either full id ("ch-fox-kids") or bare slug ("fox-kids")
const STANDALONE_BY_SLUG = new Map(STANDALONE_CHANNELS.map((c) => [c.slug, c]));
const STANDALONE_BY_ID = new Map(STANDALONE_CHANNELS.map((c) => [c.id, c]));

function findStandalone(channelIdOrSlug) {
  return (
    STANDALONE_BY_SLUG.get(channelIdOrSlug) ||
    STANDALONE_BY_ID.get(channelIdOrSlug) ||
    null
  );
}

const DISABLED_CHANNELS = new Set([
  // 60s
  1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13,
  // 70s
  14, 18, 20, 21, 22, 23, 25, 26,
  // 80s
  27, 31, 33, 34, 35, 36, 38, 39,
  // 90s
  43, 45, 46, 47, 48, 51, 52,
  // 00s
  53, 56, 57, 59, 60, 61, 62, 64, 65,
  // 10s
  66, 67, 69, 70, 71, 72, 73, 74, 75, 77, 78,
  // 20s
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91,
]);

function channelNumberFor(decade, category) {
  const di = DECADES.indexOf(decade);
  const ci = CATEGORIES.indexOf(category);
  if (di < 0 || ci < 0) return null;
  return di * 13 + ci + 1;
}

function isDisabled(decade, category) {
  const n = channelNumberFor(decade, category);
  return n !== null && DISABLED_CHANNELS.has(n);
}

module.exports = {
  DECADES,
  CATEGORIES,
  DISABLED_CHANNELS,
  STANDALONE_CHANNELS,
  channelNumberFor,
  isDisabled,
  findStandalone,
};
