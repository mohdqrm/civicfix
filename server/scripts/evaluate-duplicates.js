/**
 * Evaluate the duplicate detector on the labelled dataset in ml/duplicate-dataset.json.
 *
 *   node scripts/evaluate-duplicates.js            -> prints report, writes ml/evaluation-results.json
 *
 * Method
 *  - Every pair of reports inside a split is one example. Label = 1 if both reports
 *    belong to the same cluster (same real-world problem), else 0.
 *  - The decision threshold (and each baseline's parameter) is chosen on the DEV split
 *    by maximising F1. The TEST split is only scored once, with those fixed values.
 *  - Pairs the detector never compares (too far apart / too far apart in time) count as
 *    "predicted not duplicate", so missed true duplicates show up as false negatives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_CONFIG,
  buildIdf,
  cosineSimilarity,
  haversineMeters,
  scorePair,
  tfidfVector,
  tokenize,
} from '../src/services/duplicateDetector.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataset = JSON.parse(readFileSync(path.join(root, 'ml/duplicate-dataset.json'), 'utf8'));

// ---------- expand dataset into reports ----------
const base = new Date(dataset.baseDate).getTime();
const reports = [];
for (const g of dataset.groups) {
  const [lat0, lng0] = g.center;
  for (const c of g.clusters) {
    for (const [dx, dy, day, title, description] of c.reports) {
      const east = c.at[0] + dx;
      const north = c.at[1] + dy;
      reports.push({
        id: reports.length + 1,
        split: g.split,
        group: g.name,
        cluster: c.id,
        categoryId: c.category,
        title,
        description,
        latitude: lat0 + north / 111320,
        longitude: lng0 + east / (111320 * Math.cos((lat0 * Math.PI) / 180)),
        createdAt: new Date(base + day * 86400000).toISOString(),
      });
    }
  }
}

const textOf = (r) => `${r.title} ${r.title} ${r.description}`;

function pairsFor(split) {
  const rs = reports.filter((r) => r.split === split);
  const idf = buildIdf(rs.map((r) => tokenize(textOf(r))));
  const vecs = new Map(rs.map((r) => [r.id, tfidfVector(tokenize(textOf(r)), idf)]));
  const pairs = [];
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      pairs.push({
        a,
        b,
        label: a.cluster === b.cluster ? 1 : 0,
        model: scorePair(a, b, idf, DEFAULT_CONFIG), // null = outside window
        distanceM: haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude),
        text: cosineSimilarity(vecs.get(a.id), vecs.get(b.id)),
        sameCategory: a.categoryId === b.categoryId,
      });
    }
  }
  return { reports: rs, pairs };
}

// ---------- methods (each returns a prediction function given a parameter) ----------
const methods = {
  'CivicFix model (text+geo+category+time)': {
    param: 'score threshold',
    grid: range(0.3, 0.9, 0.01),
    predict: (p, t) => (p.model ? p.model.score >= t : false),
  },
  'Baseline: distance only': {
    param: 'max distance (m)',
    grid: range(10, 300, 10),
    predict: (p, d) => p.distanceM <= d,
  },
  'Baseline: same category + distance': {
    param: 'max distance (m)',
    grid: range(10, 300, 10),
    predict: (p, d) => p.sameCategory && p.distanceM <= d,
  },
  'Baseline: text similarity only': {
    param: 'cosine threshold',
    grid: range(0.05, 0.9, 0.01),
    predict: (p, t) => p.text >= t,
  },
};

function range(lo, hi, step) {
  const out = [];
  for (let x = lo; x <= hi + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
}

function confusion(pairs, predict, param) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const errors = { falsePositives: [], falseNegatives: [] };
  for (const p of pairs) {
    const pred = predict(p, param);
    if (pred && p.label) tp++;
    else if (pred && !p.label) { fp++; errors.falsePositives.push(p); }
    else if (!pred && p.label) { fn++; errors.falseNegatives.push(p); }
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1, errors };
}

function tune(pairs, m) {
  let best = null;
  for (const v of m.grid) {
    const c = confusion(pairs, m.predict, v);
    if (
      !best ||
      c.f1 > best.c.f1 + 1e-12 ||
      (Math.abs(c.f1 - best.c.f1) < 1e-12 && c.precision > best.c.precision)
    ) {
      best = { v, c };
    }
  }
  return best;
}

// ---------- run ----------
const dev = pairsFor('dev');
const test = pairsFor('test');
const stress = pairsFor('stress');
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const describe = (p) =>
  `#${p.a.id} "${p.a.title}" <-> #${p.b.id} "${p.b.title}" ` +
  `(${p.a.cluster}${p.label ? '' : ' vs ' + p.b.cluster}; ${Math.round(p.distanceM)} m, ` +
  `score=${p.model ? p.model.score : 'outside window'})`;

const results = { generatedAt: new Date().toISOString(), config: DEFAULT_CONFIG, data: {}, methods: [] };
for (const [name, split] of [['dev', dev], ['test', test], ['stress', stress]]) {
  results.data[name] = {
    reports: split.reports.length,
    clusters: new Set(split.reports.map((r) => r.cluster)).size,
    pairs: split.pairs.length,
    duplicatePairs: split.pairs.filter((p) => p.label).length,
    pairsInsideWindow: split.pairs.filter((p) => p.model).length,
  };
}

console.log('\nCivicFix duplicate detection — evaluation');
console.log('='.repeat(60));
console.log('Data:', JSON.stringify(results.data));
console.log('\n| Method | Param (tuned on dev) | Dev F1 | Test P / R / F1 (TP/FP/FN) | Stress P / R / F1 (TP/FP/FN) |');
console.log('|---|---|---|---|---|');
for (const [name, m] of Object.entries(methods)) {
  const best = tune(dev.pairs, m);
  const t = confusion(test.pairs, m.predict, best.v);
  const st = confusion(stress.pairs, m.predict, best.v);
  results.methods.push({
    name,
    parameter: m.param,
    chosenOnDev: best.v,
    dev: { precision: best.c.precision, recall: best.c.recall, f1: best.c.f1, tp: best.c.tp, fp: best.c.fp, fn: best.c.fn },
    test: { precision: t.precision, recall: t.recall, f1: t.f1, tp: t.tp, fp: t.fp, fn: t.fn, tn: t.tn },
    stress: { precision: st.precision, recall: st.recall, f1: st.f1, tp: st.tp, fp: st.fp, fn: st.fn, tn: st.tn },
    stressFalsePositives: st.errors.falsePositives.map(describe),
    stressFalseNegatives: st.errors.falseNegatives.map(describe),
    testFalsePositives: t.errors.falsePositives.map(describe),
    testFalseNegatives: t.errors.falseNegatives.map(describe),
  });
  console.log(
    `| ${name} | ${m.param} = ${best.v} | ${pct(best.c.f1)} | ${pct(t.precision)} / ${pct(t.recall)} / ${pct(t.f1)} (${t.tp}/${t.fp}/${t.fn}) | ${pct(st.precision)} / ${pct(st.recall)} / ${pct(st.f1)} (${st.tp}/${st.fp}/${st.fn}) |`
  );
}

const main = results.methods[0];
console.log(`\nConfigured threshold in duplicateDetector.js: ${DEFAULT_CONFIG.threshold}; dev-tuned: ${main.chosenOnDev}`);
console.log('\nTest false positives (model):');
main.testFalsePositives.forEach((s) => console.log('  - ' + s));
console.log('Test false negatives (model):');
main.testFalseNegatives.forEach((s) => console.log('  - ' + s));
for (const m of results.methods) {
  console.log(`\nStress errors — ${m.name}:`);
  m.stressFalsePositives.forEach((s) => console.log('  FP ' + s));
  m.stressFalseNegatives.forEach((s) => console.log('  FN ' + s));
}

const devMain = tune(dev.pairs, methods['CivicFix model (text+geo+category+time)']);
results.devErrorsModel = {
  falsePositives: devMain.c.errors.falsePositives.map(describe),
  falseNegatives: devMain.c.errors.falseNegatives.map(describe),
};
writeFileSync(path.join(root, 'ml/evaluation-results.json'), JSON.stringify(results, null, 2));
console.log('\nWrote ml/evaluation-results.json');
