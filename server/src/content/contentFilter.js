'use strict';

// Content filter — keeps show playlists to the show.
//
// Community YouTube playlists routinely pick up creator "fluff": reactions,
// reviews, top-10s, theories, cast retrospectives, Shorts, trailers, fan
// edits and podcast clips. Those look like episodes to yt-dlp but are not,
// and they wreck a linear TV channel. This module decides, from metadata
// alone (no network), whether an entry belongs in a channel.
//
// The decision is category-aware: a 30-second clip is garbage on a Sitcoms
// channel and exactly right on a Commercials channel; "trailer" is fluff on
// Movies and the whole point on Trailers.
//
// Used by:
//   api-server/src/routes/*      — excludes flagged docs at read time
//   scripts/import-yaml.js       — drops fluff before it reaches MongoDB
//   scripts/import-plugins.js    — same for plugin channels
//   scripts/audit-content.js     — flags fluff already in MongoDB
//   server/src/jobs/dailySync.js — same rules for locally synced plugins
//
// KEEP IN SYNC: server/src/content/contentFilter.js is a verbatim copy so the
// Docker image (which only ships server/) has the same rules.

// ---------------------------------------------------------------------------
// Category profiles: what a legitimate entry looks like
// ---------------------------------------------------------------------------
const CATEGORY_PROFILES = {
  // Episodic content — must be episode-length
  Shows:       { minSeconds: 15 * 60, maxSeconds: 6 * 3600, episodic: true },
  Sitcoms:     { minSeconds: 15 * 60, maxSeconds: 6 * 3600, episodic: true },
  Drama:       { minSeconds: 18 * 60, maxSeconds: 6 * 3600, episodic: true },
  Cartoons:    { minSeconds: 5 * 60,  maxSeconds: 6 * 3600, episodic: true },
  Kids:        { minSeconds: 5 * 60,  maxSeconds: 6 * 3600, episodic: true },
  Documentary: { minSeconds: 15 * 60, maxSeconds: 8 * 3600, episodic: true },
  'Talk TV':   { minSeconds: 3 * 60,  maxSeconds: 6 * 3600, episodic: true, talk: true },
  Specials:    { minSeconds: 10 * 60, maxSeconds: 8 * 3600, episodic: true },
  Movies:      { minSeconds: 55 * 60, maxSeconds: 8 * 3600, episodic: false, feature: true },
  // Short-form content — short is expected, "compilation" is fine
  Commercials:   { minSeconds: 5,  maxSeconds: 4 * 3600, shortForm: true },
  Bumpers:       { minSeconds: 3,  maxSeconds: 4 * 3600, shortForm: true },
  'Theme Songs': { minSeconds: 10, maxSeconds: 3600,     shortForm: true, themes: true },
  Trailers:      { minSeconds: 15, maxSeconds: 1800,     shortForm: true, trailers: true },
};

const DEFAULT_PROFILE = { minSeconds: 60, maxSeconds: 8 * 3600, episodic: false };

// ---------------------------------------------------------------------------
// House rules (hard, no rescue) for every channel except the short-form ones
// (Commercials, Bumpers, Theme Songs, Trailers, which are short by nature):
//   • nothing whose title says "compilation"
//   • nothing shorter than 15 minutes (videos with unknown length are kept
//     until their duration is known)
// ---------------------------------------------------------------------------
// Per-category minimum can be lowered with HOUSE_RULE_MIN_MINUTES, e.g.
//   HOUSE_RULE_MIN_MINUTES=Cartoons=6,Kids=6,Talk TV=5
const MIN_EPISODE_SECONDS = 15 * 60;
const COMPILATION_RE = /\bcompilations?\b/i;
const SHORT_FORM_CATEGORIES = Object.keys(CATEGORY_PROFILES).filter((c) => CATEGORY_PROFILES[c].shortForm);
const MIN_SECONDS_OVERRIDES = Object.fromEntries(String(process.env.HOUSE_RULE_MIN_MINUTES || '')
  .split(',').map((kv) => kv.split('=').map((x) => x.trim())).filter(([k, v]) => k && Number(v) >= 0)
  .map(([k, v]) => [k, Number(v) * 60]));
function minSecondsFor(category) {
  return category in MIN_SECONDS_OVERRIDES ? MIN_SECONDS_OVERRIDES[category] : MIN_EPISODE_SECONDS;
}
// English only. A title is treated as non-English when yt-dlp reports a
// non-English language, it uses a non-Latin script, it carries a dub/language
// marker ("en español", "latino", "doblado", "VOSTFR", "Folge 3"), or it reads
// as Spanish/Portuguese/French/Italian/German prose (2+ of their function words
// and no English ones, e.g. "Josie y las Melodías").
const NON_LATIN_RE = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ㐀-䶿一-鿿가-힯]/;
// Matched against the title with accents stripped ("capítulo" → "capitulo")
const FOREIGN_MARKER_RE = /\b(espanol|castellano|latino|doblad[oa]|doblaje|capitulos?|episodios?|temporadas?|dublad[oa]|legendad[oa]|portugues|desenho|francais|vostfr|saison|auf deutsch|deutsche? (fassung|synchro)|hd deutsch|folge\s*\d+|synchro|italiano|sub ita|puntata|serie completa|completo|dibujos animados|caricaturas|peliculas?|(russian|hindi|german|french|spanish|italian|portuguese|polish|czech|turkish|arabic|dutch|greek|korean|japanese|chinese|norsk|dansk|svensk|ukrainian)\s*(dub|dubbed|audio|version|tale|tal))\b/i;
const FOREIGN_MARKER_RAW_RE = /épisode|\bVF\b/;
const FOREIGN_WORDS = new Set(['y', 'las', 'los', 'el', 'del', 'con', 'por', 'para', 'una', 'uno', 'su', 'sus', 'contra', 'les', 'des', 'du', 'et', 'aux', 'della', 'dei', 'gli', 'uma', 'dos', 'das', 'und', 'der', 'mit', 'ein', 'eine', 'nel', 'nella', 'il', 'dello', 'delle', 'degli', 'di']);
const ENGLISH_WORDS = new Set(['the', 'and', 'of', 'to', 'in', 'a', 'is', 'with', 'on', 'for', 'at', 'from', 'his', 'her', 'my', 'your', 'it', 'episode', 'season', 'part', 'full', 'meets', 'vs']);
function nonEnglishReason(title, language, uploader) {
  if (language && !/^(en|und|zxx)\b/i.test(String(language))) return `non-English (${language})`;
  const t = String(title || '');
  // An English dub whose title also carries the original-language name
  // ("【English Dubbed】 … 西游记", "ソニック … english dub") is English audio
  const englishDub = /\b(english[- ]dub(bed)?|eng[- ]dub(bed)?|english version|in english|english audio)\b/i.test(t);
  if (NON_LATIN_RE.test(t) && !englishDub) return 'non-English (script)';
  const plain = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!englishDub && (FOREIGN_MARKER_RE.test(plain) || FOREIGN_MARKER_RAW_RE.test(t))) return 'non-English (dub/language marker)';
  // Dub channels usually say so in their name ("Caricaturas Latino", "Desenhos Dublados")
  const up = String(uploader || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (up && (FOREIGN_MARKER_RE.test(up) || NON_LATIN_RE.test(String(uploader)))) return 'non-English (dub channel)';
  const words = plain.toLowerCase().match(/[a-z]+/g) || [];
  const foreign = words.filter((w) => FOREIGN_WORDS.has(w)).length;
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  if (foreign >= 2 && english === 0) return 'non-English (title language)';
  return null;
}

const MULTI_EPISODE_CATS = ['Cartoons', 'Kids', 'Sitcoms'];
const MULTI_EPISODE_MIN_SECONDS = 45 * 60;
const MULTI_EPISODE_RE = /\bfull episodes\b|\b\d+\s*\+?\s*(hours?|hrs?)\b|\bback[- ]to[- ]back\b|\bmarathon\b|\bepisodes?\s*\d+\s*(-|–|&|\+|and|to)\s*\d+/i;
function houseRule(title, duration, category) {
  if (SHORT_FORM_CATEGORIES.includes(category)) return null;
  if (COMPILATION_RE.test(String(title || ''))) return 'compilation';
  const d = Number(duration) || 0;
  // Multi-episode uploads that don't say "compilation": "Full Episodes" (plural),
  // "1 Hour", "Back to Back", "Marathon", "Episodes 3-4". Only for half-hour
  // formats and only when the file is long enough to hold several episodes.
  if (MULTI_EPISODE_CATS.includes(category) && d > MULTI_EPISODE_MIN_SECONDS && MULTI_EPISODE_RE.test(String(title || ''))) return 'compilation';
  const min = minSecondsFor(category);
  if (d > 0 && d < min) return `under ${Math.round(min / 60)} min (${Math.round(d / 60)}m)`;
  return null;
}

// ---------------------------------------------------------------------------
// Title patterns. Each rule: { re, reason, unless?, soft?, maxDuration? }
//   unless      — profile flag that makes the pattern legitimate for that category
//   soft        — adds doubt (40) instead of deciding alone (100)
//   maxDuration — only fires for clips at most this long (or unknown length)
// ---------------------------------------------------------------------------
const FLUFF_RULES = [
  { re: /\b(reaction|reacts?|reacting|first time watching|blind reaction|watch(?:ing)? along)\b/i, reason: 'reaction' },
  { re: /\b(review|reviewed|reviewing|retrospective|rant|critique|analysis|analy[sz]ed|breakdown|deep dive|video essay|explained|explaining|explanation|dissect(?:ed|ing)?)\b/i, reason: 'review/analysis' },
  { re: /\b(top\s?\d+|\d+\s+(best|worst|most|things|facts|reasons|moments|characters)|ranked|ranking|tier list|iceberg|countdown)\b/i, reason: 'listicle' },
  { re: /\b(fan theory|theory|theories|what if|iceberg|lore\b|timeline explained|ending explained|hidden (details|meaning)|easter eggs?|secrets? (you|revealed|of the show))\b/i, reason: 'theory/lore' },
  { re: /\b(then and now|where are they now|cast (?:today|now|then)|what happened to|whatever happened|behind the scenes|making of|how (?:it|they) (?:was|were) made|untold story|dark truth|dark side)\b/i, reason: 'behind-the-scenes' },
  { re: /\b(interview|podcast|panel|q\s?&\s?a|commentary|live stream|livestream|stream highlights?|vod\b)\b/i, reason: 'interview/podcast' },
  { re: /\b(trailer|teaser|promo|sneak peek|first look|official clip|announcement)\b/i, reason: 'trailer', unless: 'trailers', maxDuration: 420 },
  { re: /\b(fan[- ]?(made|film|animation|edit|dub|trailer)|amv|mmd|reimagined|recreated|animatic|parody|spoof|abridged|ytp|youtube poop|sparta remix|meme|mashup)\b/i, reason: 'fan-made/edit' },
  { re: /\b(tribute|remake|restoration|restored)\b/i, reason: 'fan-made/edit', soft: true },
  { re: /\b(unboxing|haul|merch|collection tour|toy (?:review|collection)|figure review)\b/i, reason: 'merch/unboxing' },
  { re: /\b(intro|opening|theme song|theme tune|end credits|closing credits|outro|title sequence)\b/i, reason: 'theme/intro', unless: 'themes', maxDuration: 240 },
  { re: /(^|\s)#shorts?\b|\bshorts?\b.*\bedit\b|\byt shorts\b/i, reason: 'shorts' },
  // "Full episodes compilation" is legitimate cartoon/sitcom content, so this
  // only adds doubt; "best of / funniest moments / supercut" are real fluff.
  { re: /\b(compilation|marathon|all episodes)\b/i, reason: 'compilation', unless: ['shortForm', 'talk'], soft: true },
  { re: /\b(supercut|best of|funniest moments|every time|all (?:the )?times|montage|highlights?)\b/i, reason: 'compilation', unless: ['shortForm', 'talk'] },
  { re: /\b(tutorial|how to draw|speedpaint|speed paint|cosplay|diy\b|gameplay|playthrough|let'?s play|walkthrough|longplay|speedrun)\b/i, reason: 'tutorial/gaming' },
  { re: /\b(pitch meeting|honest trailer|everything wrong with|cinemasins|nostalgia critic|angry video game nerd|avgn|pop culture detective)\b/i, reason: 'commentary channel' },
  { re: /\b(vlog|storytime|story time|grwm|asmr|prank|tiktok|tik tok)\b/i, reason: 'vlog/social' },
  { re: /\b(remastered in 4k|ai upscaled|60fps remaster|ai enhanced|upscaled)\b/i, reason: 'upscale re-upload', soft: true },
];

// Uploaders that are always fluff, regardless of playlist (lower-case, no @)
const DEFAULT_BLOCKED_UPLOADERS = ['oggone'];

// Baby / toddler content never belongs on a retro channel. Channel names are
// matched as substrings of the uploader; title phrases as regex.
const TODDLER_UPLOADERS = [
  'cocomelon', 'moonbug', 'wildbrain kids', 'wildbrain giggles', 'wildbrain fizz', 'little baby bum',
  'super simple', 'pinkfong', 'baby shark', 'kedoo', 'toonstv', 'bebefinn', 'blippi', 'baby einstein',
  'little angel', 'babybus', 'hey bear', 'dave and ava', 'chuchu tv', 'lalafun', 'boom buddies',
];
const TODDLER_TITLE_RE = /\b(for (toddlers|babies|preschoolers|kids \d|little kids)|nursery rhymes?|baby songs?|kids songs?|learn (colors|colours|numbers|abc|shapes)|toddler learning|preschool learning|educational videos? for (kids|children)|bedtime stories? for kids|sing[- ]?along)\b/i;

const SPAM_TITLE_RE = /\b(earn|make)\s+(money|\$+|cash)\b|\bhow to (earn|make money)|\bfreelanc(er|ing|e website)\b|\bpassive income\b|\bcreate (a )?youtube channel\b|\byoutube algorithm\b|\b(crypto|forex) (trading|signals)\b|\bwork from home\b/i;

// Words that are too generic to count as "matches the show name"
// Long words that appear in many show names and don't identify one on their own
const GENERIC_WORDS = new Set(['adventures', 'adventure', 'animated', 'cartoon', 'cartoons', 'classic', 'classics', 'complete', 'episodes',
  'amazing', 'incredible', 'fantastic', 'spectacular', 'mysteries', 'mystery', 'captain', 'planet', 'monsters', 'stories',
  'children', 'friends', 'family', 'kingdom', 'masters', 'legends', 'legend', 'returns', 'extreme', 'ultimate', 'original',
  'universe', 'journey', 'wonderful', 'magical', 'special', 'presents', 'theatre', 'theater', 'hour', 'america', 'american',
  'animals', 'little', 'mighty', 'super', 'power', 'rangers', 'rescue', 'squad', 'patrol', 'defenders', 'heroes', 'warriors',
  'unlimited', 'beyond', 'tonight', 'morning', 'weekend', 'saturday', 'sunday', 'brothers', 'sisters', 'detective', 'forever',
  // 6-letter generics
  'secret', 'island', 'hunter', 'hunters', 'doctor', 'agents', 'school', 'police', 'ranger', 'wonder', 'robots', 'racers', 'dragon',
  'dragons', 'knight', 'knights', 'pirate', 'pirates', 'planet', 'galaxy', 'future', 'rescue', 'garden', 'street', 'circus', 'jungle',
  'animal', 'castle', 'giants', 'mouse', 'kitten', 'puppies', 'friend', 'people', 'things', 'stuff', 'action', 'cosmic', 'mister',
  'little', 'toonsl', 'comedy', 'sports', 'babies', 'twins', 'ghosts', 'spirit', 'master', 'return', 'secret', 'amazing', 'strange']);

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'show', 'series', 'tv', 'season', 'episode', 'full', 'hd', 'new', 'with', 'for', 'at']);

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9'&\s#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function showTokens(showName) {
  return normalize(showName)
    .replace(/'s?\b/g, '')
    .split(' ')
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Does the title mention the show at all? ("Doug S01E02" → yes; "Heart of Ice" → no)
// Accepts: ≥2 distinctive words of the name (or all of them if fewer), the
// main title before a colon ("Batman" for "Batman: The Animated Series"
// only when that part has 2+ distinctive words or is itself distinctive),
// or an acronym of the name ("TAS", "TMNT", "SWAT Kats" → "sk" is too short).
function mentionsShow(title, showName) {
  const tokens = showTokens(showName);
  if (!tokens.length) return true;
  const t = normalize(title);
  const words = new Set(t.split(' '));
  // Space/punctuation-insensitive: "Ghost Busters" ↔ "Ghostbusters", "X-Men" ↔ "XMen"
  const compact = t.replace(/[^a-z0-9]/g, '');
  const has = (tok) => t.includes(tok) || compact.includes(tok);
  const hits = tokens.filter(has).length;
  if (hits >= Math.min(2, tokens.length)) return true;
  const whole = normalize(showName).replace(/^the /, '').replace(/[^a-z0-9]/g, '');
  if (whole.length >= 6 && compact.includes(whole)) return true;

  // One distinctive word is enough ("Heathcliff Pumps Iron", "Popeye - Greek
  // Mirthology", "Mumfie Songs"): 6+ letters and not a generic title word.
  if (tokens.some((tok) => tok.length >= 6 && !GENERIC_WORDS.has(tok) && has(tok))) return true;

  // Main title before ':' / ' - ' (e.g. "Superman: The Animated Series")
  const main = String(showName).split(/:| - /)[0];
  const mainTokens = showTokens(main);
  if (mainTokens.length && mainTokens.length < tokens.length && mainTokens.every((tok) => t.includes(tok))) {
    // a single generic-ish word needs a companion: the rest-of-name acronym
    if (mainTokens.length >= 2 || mainTokens[0].length >= 6) return true;
  }

  // Acronyms: initials of all words (minus articles) and of the part after ':'
  const initials = (str) => normalize(str).split(' ').filter((w) => w && !['the', 'a', 'an', 'of', 'and'].includes(w)).map((w) => w[0]).join('');
  const acronyms = [initials(showName), initials(String(showName).split(':')[1] || '')].filter((a) => a.length >= 3);
  if (acronyms.some((a) => words.has(a))) return true;
  return false;
}

// Playlist "show names" that are really blocks / mixes / labels
const LABEL_RE = /\b(mix|block|compilations?|commercials?|bumpers?|promos?|idents?|specials|theme songs|various|misc(ellaneous)?|marathons?|variety|collection|playlist)\b|^(kids|cartoons|shows|sitcoms|drama|movies|documentar(y|ies)|talk tv|unknown|untitled)$|^\d{2,4}s\b/i;
function isLabelName(name) { return LABEL_RE.test(String(name || '').trim()); }

// Does the title contain one of the show's known episode titles?
// Titles are normalised; very short ones (< 5 chars, e.g. "Pi") are ignored
// to avoid accidental matches.
function matchesEpisodeTitle(title, episodeTitles) {
  if (!episodeTitles || !episodeTitles.length) return false;
  const bare = (x) => normalize(x).replace(/'/g, '').replace(/\s+/g, ' ');
  const t = ` ${bare(title)} `;
  for (const ep of episodeTitles) {
    const e = bare(ep);
    if (e.length >= 5 && t.includes(` ${e} `)) return true;
  }
  return false;
}

// Episode-ish signals: S01E02, 1x02, "Episode 5", "Ep. 5", "Part 2", "Full Episode"
const EPISODE_RE = /\b(s\d{1,2}\s?e\d{1,3}|\d{1,2}x\d{1,3}|season\s?\d+|episode\s?\d+|ep\.?\s?\d+|e\d{1,3}|part\s?\d+|full episode|complete episode|pilot)\b/i;

// Episode numbering as it appears in uploads of a show's own playlist: the
// EPISODE_RE markers plus "#08", misspelled "Epiosde 26", and a leading
// episode number ("088 Babes in Troyland", "02 Animal Antics"). Only used for
// the show-match rule, never to rescue fluff; listicles ("10 Best…") are
// excluded and still hit the fluff rules anyway.
const LISTICLE_RE = /^\s*\d{1,3}\s+(best|top|worst|most|greatest|funniest|things|times|reasons|facts|secrets|moments|characters|episodes|details|mistakes|hidden|craziest|weirdest|scariest|saddest)\b/i;
function hasEpisodeNumber(title) {
  const t = String(title || '');
  if (EPISODE_RE.test(t)) return true;
  if (LISTICLE_RE.test(t)) return false;
  return /(^|\s)#\s?\d{1,3}\b|\bep[a-z]{0,6}\.?\s?\d{1,3}\b|^\s*\d{1,3}\s*[-.):]?\s+[a-z]/i.test(t);
}

/**
 * Evaluate one video for a channel.
 *
 * @param {object} video   { id, title, duration (s), description?, uploader?, channel?, channelId?, liveStatus?, isShort? }
 * @param {object} ctx     { category, showName?, blockedUploaders?: string[], playlistUploader?: string, showTypicalSeconds?: number,
 *                            requireShowMatch?: boolean, episodeTitles?: string[], strict?: boolean }
 * @returns {{ keep: boolean, reason: string|null, score: number, signals: string[] }}
 */
function evaluate(video, ctx = {}) {
  const category = ctx.category || '';
  const profile = CATEGORY_PROFILES[category] || DEFAULT_PROFILE;
  const title = String(video.title || '');
  const duration = Number(video.duration) || 0;
  const signals = [];
  let score = 0; // ≥ 100 → drop

  const uploader = normalize(video.uploader || video.channel || '');
  const uploaderId = String(video.channelId || video.uploaderId || '').toLowerCase().replace(/^@/, '');
  const blocked = (ctx.blockedUploaders || DEFAULT_BLOCKED_UPLOADERS).map((u) => u.toLowerCase().replace(/^@/, ''));
  if (uploader && blocked.some((b) => uploader === b || uploader.includes(b) || uploaderId === b)) {
    return { keep: false, reason: 'blocked uploader', score: 999, signals: ['blocked-uploader'] };
  }

  // Placeholders for videos that were made private / deleted after import
  if (/^\s*\[(private|deleted) video\]\s*$/i.test(title)) {
    return { keep: false, reason: 'private/deleted video', score: 999, signals: ['unavailable'] };
  }

  // Make-money / freelancing / YouTube-growth spam that ends up in hijacked
  // or re-used playlists — never TV content on any channel
  if (SPAM_TITLE_RE.test(title)) {
    return { keep: false, reason: 'spam (make-money / channel-growth)', score: 999, signals: ['spam'] };
  }

  // House rules: no compilations, nothing under 15 minutes
  const foreign = nonEnglishReason(title, video.language, video.uploader || video.channel);
  if (foreign) return { keep: false, reason: foreign, score: 999, signals: ['non-english'] };
  const house = houseRule(title, duration, category);
  if (house) return { keep: false, reason: house, score: 999, signals: ['house-rule'] };

  // Baby / toddler content: dropped on every channel
  if (TODDLER_UPLOADERS.some((u) => uploader.includes(u)) || TODDLER_TITLE_RE.test(title)) {
    return { keep: false, reason: 'toddler/baby content', score: 999, signals: ['toddler'] };
  }

  // Strict show relevance (ctx.requireShowMatch): an entry must name the show,
  // carry an episode marker (S01E02, Episode 5, Part 2), or match a known
  // episode title of the show (ctx.episodeTitles, e.g. from Wikipedia).
  if (ctx.requireShowMatch && ctx.showName && (profile.episodic || profile.feature)) {
    const byName = mentionsShow(title, ctx.showName);
    const byMarker = hasEpisodeNumber(title);
    const byEpisode = matchesEpisodeTitle(title, ctx.episodeTitles);
    if (!byName && !byMarker && !byEpisode) {
      return { keep: false, reason: 'not identifiable as this show (no show name, episode number or episode title)', score: 999, signals: ['no-show-match'] };
    }
  }

  // Live / upcoming streams are never VOD content
  if (video.liveStatus === 'is_live' || video.liveStatus === 'is_upcoming') {
    return { keep: false, reason: 'live/upcoming stream', score: 999, signals: ['live'] };
  }

  // Shorts (vertical, ≤ 60s) unless the category is short-form by nature
  if ((video.isShort || /#shorts?\b/i.test(title)) && !profile.shortForm && !((Number(ctx.showTypicalSeconds) || 0) > 0 && Number(ctx.showTypicalSeconds) < 180)) {
    return { keep: false, reason: 'YouTube Short', score: 999, signals: ['short'] };
  }

  // Title rules. Short-form channels (commercials, bumpers, promos, themes)
  // ARE promos/spoofs/interstitials, so only the universal fluff rules apply
  // there. A playlist whose typical clip is under 3 minutes is treated the
  // same way even if it was filed under an episodic category (e.g. a bumper
  // pack inside Cartoons).
  const typicalLen = Number(ctx.showTypicalSeconds) || 0;
  const shortFormPlaylist = profile.shortForm || (typicalLen > 0 && typicalLen < 180);
  const UNIVERSAL = new Set(['reaction', 'review/analysis', 'listicle', 'vlog/social', 'tutorial/gaming', 'commentary channel', 'merch/unboxing', 'shorts']);
  let hardReason = null;
  for (const rule of FLUFF_RULES) {
    if (!rule.re.test(title)) continue;
    const unless = Array.isArray(rule.unless) ? rule.unless : rule.unless ? [rule.unless] : [];
    if (unless.some((flag) => profile[flag])) continue;
    if (shortFormPlaylist && !UNIVERSAL.has(rule.reason)) continue;
    // Some words ("intro", "opening", "trailer") are common in real episode
    // titles — only treat them as fluff when the clip is actually short.
    if (rule.maxDuration && duration > rule.maxDuration) continue;
    signals.push(rule.reason);
    if (rule.soft) {
      score += 40;
    } else if (!hardReason) {
      hardReason = rule.reason;
      score += 100;
    }
  }

  // An episode marker in the title (S01E02) rescues borderline title matches
  // like "The Simpsons S03E12 — Homer's Review Hour"; it does NOT rescue the
  // unambiguous ones (reaction, top 10, theory, fan-made).
  const NEVER_RESCUE = new Set(['reaction', 'listicle', 'theory/lore', 'fan-made/edit', 'shorts', 'vlog/social', 'commentary channel', 'interview/podcast']);
  if (hardReason && !NEVER_RESCUE.has(hardReason) && EPISODE_RE.test(title) && duration >= (profile.minSeconds || 0)) {
    score -= 100;
    signals.push('episode-marker-rescue');
    hardReason = null;
  }

  // Duration sanity. The best yardstick is the show's OWN typical episode
  // length (ctx.showTypicalSeconds = 75th percentile of the playlist, see
  // filterVideos): a 4-minute clip on a show whose episodes run 22 minutes is
  // fluff, while a 14-minute sitcom or an 11-minute cartoon is simply a short
  // show. The category minimum is only used when we know nothing about the
  // show (single videos), and then only as doubt, not a verdict.
  if (duration > 0 && !shortFormPlaylist) {
    const typical = typicalLen;
    if (typical > 0 && (profile.episodic || profile.feature)) {
      // A clip is short for BOTH the show and the category — so a natively
      // short show (14-min sitcom) is never punished, and a playlist padded
      // with hour-long compilations doesn't make its 7-minute shorts "clips".
      // An explicit episode marker (E16, Season 1 Episode 2 P1, Part 3)
      // protects natively short episodes and multi-part uploads — unless the
      // title itself says it's a scene/recap/clip.
      const episodeMarked = EPISODE_RE.test(title) && !/\b(scenes?|clips?|recap|preview|promo|moments?|sneak peek|teaser)\b/i.test(title);
      if (duration < typical * 0.4 && duration < profile.minSeconds && !(episodeMarked && duration >= 120)) {
        score += 100;
        signals.push(`clip-length for this show (${duration}s vs typical ${Math.round(typical)}s)`);
      }
    } else if (duration < profile.minSeconds) {
      score += profile.episodic || profile.feature ? 60 : 40;
      signals.push(`short for ${category || 'channel'} (${duration}s)`);
    }
    // Anything under a minute is a clip/Short on every episodic channel
    if (duration < 60 && (profile.episodic || profile.feature)) {
      score += 100;
      signals.push('under 60s');
    }
    if (duration > profile.maxSeconds) {
      score += 60;
      signals.push(`too long (${Math.round(duration / 60)}m)`);
    }
  }

  // Show-name relevance (soft): only matters when combined with other doubt
  if (ctx.showName && profile.episodic) {
    if (!mentionsShow(title, ctx.showName) && !EPISODE_RE.test(title)) {
      score += 30;
      signals.push('title does not mention show');
    }
  }

  // Off-uploader entries in a single-uploader playlist are suspicious
  if (ctx.playlistUploader && uploader && normalize(ctx.playlistUploader) !== uploader) {
    score += 30;
    signals.push('different uploader than playlist majority');
  }

  const threshold = ctx.strict ? 60 : 100;
  const keep = score < threshold;
  const reason = keep ? null : hardReason || signals.filter((s) => s !== 'episode-marker-rescue').join('; ') || 'low relevance';
  return { keep, reason, score, signals };
}

/**
 * Filter a whole list. Computes the majority uploader for the playlist so
 * off-uploader fluff carries extra weight. Returns { kept, dropped }.
 */
function filterVideos(videos, ctx = {}) {
  const list = Array.isArray(videos) ? videos : [];
  let playlistUploader = ctx.playlistUploader || null;
  if (!playlistUploader && list.length >= 5) {
    const counts = new Map();
    for (const v of list) {
      const u = normalize(v.uploader || v.channel || '');
      if (u) counts.set(u, (counts.get(u) || 0) + 1);
    }
    let best = null;
    for (const [u, n] of counts) if (!best || n > best.n) best = { u, n };
    if (best && best.n / list.length >= 0.6) playlistUploader = best.u;
  }

  // Typical episode length for this playlist/show: 75th percentile of known
  // durations, so a playlist padded with clips still reveals its real episodes.
  let showTypicalSeconds = ctx.showTypicalSeconds || 0;
  if (!showTypicalSeconds) {
    const durs = list.map((v) => Number(v.duration) || 0).filter((d) => d > 0).sort((a, b) => a - b);
    if (durs.length >= 3) showTypicalSeconds = durs[Math.min(durs.length - 1, Math.floor(durs.length * 0.75))];
  }

  // Show-match rule safety valves:
  //  - the "show" is really a block/label ("The Disney Afternoon Block",
  //    "1990s Sitcoms Mix", "Buzzr Compilation") → rule doesn't apply
  //  - we have no episode-title list AND under 30% of titles name the show or
  //    carry an episode number → the uploader probably titles by episode name
  //    only; don't guess, report it for review instead of wiping the playlist
  let requireShowMatch = !!ctx.requireShowMatch;
  let showMatchSkipped = null;
  if (requireShowMatch && (!ctx.showName || isLabelName(ctx.showName))) {
    requireShowMatch = false;
    showMatchSkipped = 'label, not a show';
  } else if (requireShowMatch && !(ctx.episodeTitles && ctx.episodeTitles.length) && list.length >= 5) {
    const hits = list.filter((v) => mentionsShow(v.title, ctx.showName) || hasEpisodeNumber(v.title)).length;
    if (hits / list.length < 0.3) {
      requireShowMatch = false;
      showMatchSkipped = `no episode titles and only ${Math.round((hits / list.length) * 100)}% name the show — review manually`;
    }
  }

  const kept = [];
  const dropped = [];
  for (const v of list) {
    const verdict = evaluate(v, { ...ctx, requireShowMatch, playlistUploader, showTypicalSeconds });
    if (verdict.keep) kept.push(v);
    else dropped.push({ ...v, filterReason: verdict.reason, filterSignals: verdict.signals });
  }
  return { kept, dropped, playlistUploader, showTypicalSeconds, showMatchSkipped };
}

module.exports = {
  MIN_EPISODE_SECONDS,
  COMPILATION_RE,
  SHORT_FORM_CATEGORIES,
  MIN_SECONDS_OVERRIDES,
  minSecondsFor,
  houseRule,
  nonEnglishReason,
  evaluate,
  filterVideos,
  mentionsShow,
  hasEpisodeNumber,
  matchesEpisodeTitle,
  isLabelName,
  TODDLER_UPLOADERS,
  TODDLER_TITLE_RE,
  SPAM_TITLE_RE,
  CATEGORY_PROFILES,
  FLUFF_RULES,
  DEFAULT_BLOCKED_UPLOADERS,
  EPISODE_RE,
};
