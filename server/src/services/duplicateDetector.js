/**
 * CivicFix duplicate complaint detector.
 *
 * Idea: two reports are probably about the same real problem when they are
 *   (1) close together on the map,
 *   (2) filed recently relative to each other,
 *   (3) in the same category, and
 *   (4) described with similar words.
 *
 * Each signal becomes a number between 0 and 1, and a weighted sum gives the
 * final score. Anything above THRESHOLD is shown to an admin as a *suggestion*;
 * nothing is merged or rejected automatically.
 *
 * Text similarity uses TF-IDF + cosine similarity:
 *   - TF  (term frequency)  = how often a word appears in this report
 *   - IDF (inverse doc freq) = how rare the word is across all reports
 *   A rare shared word ("barakhamba") counts for more than a common one ("road").
 *   Cosine similarity then compares the two weighted word vectors (1 = same words).
 *
 * This file has no dependencies so it can be unit-tested and evaluated on its own.
 */

export const DEFAULT_CONFIG = Object.freeze({
  maxDistanceM: 300, // reports farther apart than this are never compared
  maxAgeDays: 30, // ...or filed further apart in time than this
  weights: Object.freeze({ text: 0.45, geo: 0.3, category: 0.15, time: 0.1 }),
  // Chosen on the development split of the labelled dataset; see
  // ml/README.md and scripts/evaluate-duplicates.js. Update both together.
  threshold: 0.51,
  maxSuggestions: 5,
});

const STOPWORDS = new Set(
  `a an the and or but if of on in at to for from by with without near nearby
   is are was were be been being am it its this that these those there here
   has have had do does did done not no very too so such than then also just
   we our us i me my you your he she they them their his her
   please kindly sir madam since from for days day week weeks morning night
   hai hain ho raha rahi rahe ka ki ke ko se par pe mein me ke paas bahut jaldi
   all every any some many much more most one two three four five
   still again now today yesterday
   area side front opposite behind right just`.split(/\s+/).filter(Boolean)
);

// Map variants, synonyms and common Hindi/Hinglish words onto one canonical term.
const SYNONYMS = new Map(
  Object.entries({
    pothole: ['pothole', 'crater', 'pit', 'gaddha', 'gadda', 'gaddhe', 'hole', 'depression'],
    garbage: ['garbage', 'trash', 'waste', 'rubbish', 'litter', 'kachra', 'kooda', 'kuda', 'refuse', 'debris', 'malba'],
    bin: ['bin', 'dustbin', 'dumpster', 'container'],
    light: ['light', 'lamp', 'lamppost', 'bulb', 'streetlight', 'lights'],
    water: ['water', 'paani', 'pani'],
    leak: ['leak', 'leakage', 'burst', 'seepage', 'beh', 'leaking', 'leaky'],
    pipe: ['pipe', 'pipeline', 'valve'],
    drain: ['drain', 'drainage', 'nala', 'naala', 'nali', 'naali', 'gutter', 'sewer', 'sewage'],
    overflow: ['overflow', 'overflowing', 'spill', 'spilling', 'choke', 'choked', 'blocked', 'block', 'clogged'],
    broken: ['broken', 'damaged', 'damage', 'dead', 'faulty', 'fused', 'cracked', 'collapsed', 'fallen', 'caved', 'sinking'],
    road: ['road', 'street', 'lane', 'gali', 'marg'],
    dark: ['dark', 'darkness', 'andhera'],
    smell: ['smell', 'stink', 'stench', 'odour', 'odor', 'badbu'],
  }).flatMap(([canonical, variants]) => variants.map((v) => [v, canonical]))
);

function stem(word) {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function canonical(word) {
  if (SYNONYMS.has(word)) return SYNONYMS.get(word);
  const stemmed = stem(word);
  return SYNONYMS.get(stemmed) ?? stemmed;
}

/** Turn free text into normalised tokens: unigrams plus adjacent bigrams. */
export function tokenize(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/street[\s-]?lights?/g, ' light ')
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(canonical)
    .filter((w) => !STOPWORDS.has(w));
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] !== words[i + 1]) bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return [...words, ...bigrams];
}

/** Smoothed inverse document frequency over a corpus of token lists. */
export function buildIdf(tokenLists) {
  const df = new Map();
  for (const tokens of tokenLists) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = tokenLists.length;
  const idf = new Map();
  for (const [t, count] of df) idf.set(t, Math.log((n + 1) / (count + 1)) + 1);
  return { idf, unseen: Math.log(n + 1) + 1 };
}

export function tfidfVector(tokens, { idf, unseen }) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const vec = new Map();
  for (const [t, c] of counts) vec.set(t, (c / tokens.length) * (idf.get(t) ?? unseen));
  return vec;
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, w] of a) {
    na += w * w;
    if (b.has(t)) dot += w * b.get(t);
  }
  for (const w of b.values()) nb += w * w;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Great-circle distance between two lat/lng points, in metres. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const textOf = (c) => `${c.title ?? ''} ${c.title ?? ''} ${c.description ?? ''}`; // title counted twice: it's the summary

/**
 * Score one pair of complaints. Returns null when the pair is outside the
 * distance/time window (never a candidate). Otherwise returns the score and
 * the per-signal breakdown so an admin can see *why* it was flagged.
 */
export function scorePair(a, b, idfModel, config = DEFAULT_CONFIG) {
  const distanceM = haversineMeters(+a.latitude, +a.longitude, +b.latitude, +b.longitude);
  const days = Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) / 86400000;
  if (distanceM > config.maxDistanceM || days > config.maxAgeDays) return null;

  const text = cosineSimilarity(
    tfidfVector(tokenize(textOf(a)), idfModel),
    tfidfVector(tokenize(textOf(b)), idfModel)
  );
  const geo = 1 - distanceM / config.maxDistanceM;
  const category = a.categoryId === b.categoryId ? 1 : 0;
  const time = 1 - days / config.maxAgeDays;
  const w = config.weights;
  const score = w.text * text + w.geo * geo + w.category * category + w.time * time;

  const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    score: round(score),
    components: {
      text: round(text),
      geo: round(geo),
      category,
      time: round(time),
      distanceM: Math.round(distanceM),
      daysApart: round(days, 1),
    },
  };
}

/**
 * Find likely duplicates of `target` among `candidates`.
 * `corpus` (optional) is a larger set of recent complaints used for IDF; it
 * defaults to target + candidates.
 */
export function findDuplicates(target, candidates, { corpus, config = DEFAULT_CONFIG } = {}) {
  const docs = corpus ?? [target, ...candidates];
  const idfModel = buildIdf(docs.map((c) => tokenize(textOf(c))));
  return candidates
    .filter((c) => c.id === undefined || c.id !== target.id)
    .map((c) => ({ candidate: c, result: scorePair(target, c, idfModel, config) }))
    .filter(({ result }) => result && result.score >= config.threshold)
    .sort((x, y) => y.result.score - x.result.score)
    .slice(0, config.maxSuggestions)
    .map(({ candidate, result }) => ({ id: candidate.id, ...result }));
}
