'use strict';

// 7 Decades × 13 Categories = 91 unique linear TV channels
// Channel numbering: decadeIndex * 13 + categoryIndex + 1  (channels 1–91)
//   60s = 1–13, 70s = 14–26, 80s = 27–39, 90s = 40–52, 00s = 53–65, 10s = 66–78, 20s = 79–91
//   Example: 80s Cartoons = 29, 90s Commercials = 44, 20s Shows = 79
// Standalone channels (non-decade): 92–106
// Plugin channels start at 107+

const DECADES = ['60s', '70s', '80s', '90s', '00s', '10s', '20s'];

const CATEGORIES = [
  'Shows',
  'Sitcoms',
  'Cartoons',
  'Movies',
  'Commercials',
  'Drama',
  'Specials',
  'Theme Songs',
  'Trailers',
  'Bumpers',
  'Kids',
  'Documentary',
  'Talk TV',
];

// Temporarily disabled channels — no content available yet.
// Remove a channel number from this set to re-enable it.
const DISABLED_CHANNELS = new Set([
  1,   // 60s Shows
  2,   // 60s Sitcoms
  3,   // 60s Cartoons
  5,   // 60s Commercials
  6,   // 60s Drama
  7,   // 60s Specials
  8,   // 60s Theme Songs
  9,   // 60s Trailers
  10,  // 60s Bumpers
  11,  // 60s Kids
  12,  // 60s Documentary
  13,  // 60s Talk TV
  14,  // 70s Shows
  15,  // 70s Sitcoms
  17,  // 70s Movies
  18,  // 70s Commercials
  19,  // 70s Drama
  20,  // 70s Specials
  21,  // 70s Theme Songs
  22,  // 70s Trailers
  23,  // 70s Bumpers
  24,  // 70s Kids
  25,  // 70s Documentary
  26,  // 70s Talk TV
  27,  // 80s Shows
  28,  // 80s Sitcoms
  30,  // 80s Movies
  31,  // 80s Commercials
  32,  // 80s Drama
  33,  // 80s Specials
  34,  // 80s Theme Songs
  35,  // 80s Trailers
  36,  // 80s Bumpers
  38,  // 80s Documentary
  39,  // 80s Talk TV
  45,  // 90s Drama
  41,  // 90s Sitcoms
  43,  // 90s Movies
  46,  // 90s Specials
  47,  // 90s Theme Songs
  48,  // 90s Trailers
  51,  // 90s Documentary
  52,  // 90s Talk TV
  53,  // 00s Shows
  56,  // 00s Movies
  57,  // 00s Commercials
  58,  // 00s Drama
  59,  // 00s Specials
  60,  // 00s Theme Songs
  61,  // 00s Trailers
  62,  // 00s Bumpers
  64,  // 00s Documentary
  65,  // 00s Talk TV
  66,  // 10s Shows
  67,  // 10s Sitcoms
  69,  // 10s Movies
  70,  // 10s Commercials
  71,  // 10s Drama
  72,  // 10s Specials
  73,  // 10s Theme Songs
  74,  // 10s Trailers
  75,  // 10s Bumpers
  77,  // 10s Documentary
  78,  // 10s Talk TV
  80,  // 20s Sitcoms
  81,  // 20s Cartoons
  82,  // 20s Movies
  83,  // 20s Commercials
  84,  // 20s Drama
  85,  // 20s Specials
  86,  // 20s Theme Songs
  87,  // 20s Trailers
  88,  // 20s Bumpers
  89,  // 20s Kids
  90,  // 20s Documentary
  91,  // 20s Talk TV
]);

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

// Standalone channels — span multiple decades, not part of the grid matrix.
// `slug` is the bare identifier used by the api-server (Video.standaloneChannel
// docs and the /videos/channel/:slug route). The "ch-" prefix is the local
// channel id used everywhere else.
const STANDALONE_CHANNELS = [
  { id: 'ch-classic-nickelodeon',  slug: 'classic-nickelodeon',  channelNumber: 92,  name: 'Classic Nickelodeon',       category: 'Cartoons',    decade: '90s' },
  { id: 'ch-saturday-morning',     slug: 'saturday-morning',     channelNumber: 93,  name: 'Saturday Morning Cartoons', category: 'Cartoons',    decade: '80s' },
  { id: 'ch-unsolved-mysteries',   slug: 'unsolved-mysteries',   channelNumber: 94,  name: 'Unsolved Mysteries',        category: 'Shows',       decade: '80s' },
  { id: 'ch-fox-kids',             slug: 'fox-kids',             channelNumber: 95,  name: 'Fox Kids',                  category: 'Cartoons',    decade: '90s' },
  { id: 'ch-cartoon-cartoons',     slug: 'cartoon-cartoons',     channelNumber: 96,  name: 'Cartoon Cartoons',          category: 'Cartoons',    decade: '90s' },
  { id: 'ch-pbs-kids-classic',     slug: 'pbs-kids-classic',     channelNumber: 97,  name: 'PBS Kids Classic',          category: 'Kids',        decade: '90s' },
  { id: 'ch-mst3k',                slug: 'mst3k',                channelNumber: 98,  name: 'MST3K',                     category: 'Shows',       decade: '90s' },
  { id: 'ch-sci-fi-originals',     slug: 'sci-fi-originals',     channelNumber: 99,  name: 'Sci-Fi Originals',          category: 'Shows',       decade: '80s' },
  { id: 'ch-infomercials',         slug: 'infomercials',         channelNumber: 100, name: 'Infomercials',              category: 'Commercials', decade: '90s' },
  { id: 'ch-late-night-classics',  slug: 'late-night-classics',  channelNumber: 101, name: 'Late Night Classics',       category: 'Talk TV',     decade: '80s' },
  { id: 'ch-classic-game-shows',   slug: 'classic-game-shows',   channelNumber: 102, name: 'Classic Game Shows',        category: 'Shows',       decade: '70s' },
  { id: 'ch-kids-wb',              slug: 'kids-wb',              channelNumber: 103, name: 'Kids WB',                   category: 'Cartoons',    decade: '90s' },
  { id: 'ch-disney-afternoon',     slug: 'disney-afternoon',     channelNumber: 104, name: 'Disney Afternoon',          category: 'Cartoons',    decade: '90s' },
  { id: 'ch-nick-at-nite',         slug: 'nick-at-nite',         channelNumber: 105, name: 'Nick at Nite',              category: 'Sitcoms',     decade: '70s' },
  { id: 'ch-80s-90s-commercials',  slug: '80s-90s-commercials',  channelNumber: 106, name: '80s/90s Commercials',       category: 'Commercials', decade: '80s' },
  { id: 'ch-g4',                   slug: 'g4',                   channelNumber: 107, name: 'G4',                        category: 'Shows',       decade: '00s' },
  { id: 'ch-reality-tv',           slug: 'reality-tv',           channelNumber: 108, name: 'Reality TV',                category: 'Shows',       decade: '00s' },
];

function buildChannelGrid() {
  const channels = [];
  DECADES.forEach((decade, di) => {
    CATEGORIES.forEach((category, ci) => {
      const channelNumber = di * 13 + ci + 1;
      if (DISABLED_CHANNELS.has(channelNumber)) return;
      channels.push({
        id: `ch-${slugify(decade)}-${slugify(category)}`,
        decade,
        category,
        channelNumber,
        name: `${decade} ${category}`,
        enabled: true,
        settings: {
          shuffle: true,
          includeCommercials: false,
        },
        cachedVideos: [],
        lastVideoSync: null,
      });
    });
  });

  for (const sc of STANDALONE_CHANNELS) {
    channels.push({
      id: sc.id,
      channelNumber: sc.channelNumber,
      name: sc.name,
      decade: sc.decade,
      category: sc.category,
      standaloneSlug: sc.slug,
      isStandalone: true,
      enabled: true,
      settings: { shuffle: true, includeCommercials: false },
      cachedVideos: [],
      lastVideoSync: null,
    });
  }

  return channels;
}

module.exports = { DECADES, CATEGORIES, STANDALONE_CHANNELS, buildChannelGrid };