// Unit tests for the duplicate detector. Uses Node's built-in test runner so they
// run with zero dependencies:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  buildIdf,
  cosineSimilarity,
  findDuplicates,
  haversineMeters,
  tfidfVector,
  tokenize,
} from '../src/services/duplicateDetector.js';

const at = (meters) => 28.6315 + meters / 111320; // move north by `meters`
const base = {
  categoryId: 1,
  longitude: 77.2167,
  createdAt: '2026-09-01T09:00:00Z',
};

test('tokenize lowercases, drops stopwords and maps synonyms/Hinglish', () => {
  const t = tokenize('Bada GADDHA on the road near the gate!');
  assert.ok(t.includes('pothole'), 'gaddha -> pothole');
  assert.ok(t.includes('road'));
  assert.ok(!t.includes('the') && !t.includes('near'));
  assert.ok(tokenize('Street lights dead').includes('light'));
  assert.ok(tokenize('Kachra pile').includes('garbage'));
});

test('tokenize is safe on empty / odd input', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize('<script>alert(1)</script>').filter((x) => x.includes('<')), []);
});

test('cosine similarity: identical = 1, disjoint = 0', () => {
  const idf = buildIdf([tokenize('pothole road'), tokenize('dustbin full')]);
  const a = tfidfVector(tokenize('pothole road'), idf);
  const b = tfidfVector(tokenize('dustbin full'), idf);
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9);
  assert.equal(cosineSimilarity(a, b), 0);
  assert.equal(cosineSimilarity(new Map(), a), 0);
});

test('haversine: 0.001 deg latitude is ~111 m', () => {
  const d = haversineMeters(28.6, 77.2, 28.601, 77.2);
  assert.ok(d > 110 && d < 112, `got ${d}`);
});

test('flags a nearby, recent, same-category, similarly worded report', () => {
  const target = { ...base, id: 10, latitude: at(0), title: 'Huge pothole on Outer Circle', description: 'Deep pothole near E block, bikes falling.' };
  const dup = { ...base, id: 11, latitude: at(20), title: 'Big crater near E block', description: 'Crater in the road in front of E block on Outer Circle.' };
  const other = { ...base, id: 12, categoryId: 2, latitude: at(250), title: 'Dustbin overflowing', description: 'Garbage everywhere near metro gate.' };
  const res = findDuplicates(target, [dup, other]);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 11);
  assert.ok(res[0].score >= DEFAULT_CONFIG.threshold);
  assert.ok(res[0].components.distanceM <= 25);
});

test('never compares reports outside the distance or time window', () => {
  const target = { ...base, id: 1, latitude: at(0), title: 'Pothole on main road', description: 'Pothole on the main road near the gate.' };
  const far = { ...target, id: 2, latitude: at(DEFAULT_CONFIG.maxDistanceM + 50) };
  const old = { ...target, id: 3, createdAt: '2026-07-01T09:00:00Z' };
  assert.deepEqual(findDuplicates(target, [far, old]), []);
});

test('does not match a complaint with itself', () => {
  const c = { ...base, id: 5, latitude: at(0), title: 'Pothole on main road', description: 'Pothole on the main road near the gate.' };
  assert.deepEqual(findDuplicates(c, [c]), []);
});

test('returns at most maxSuggestions, highest score first', () => {
  const target = { ...base, id: 100, latitude: at(0), title: 'Garbage pile at gate', description: 'Garbage pile at metro gate 7, overflowing.' };
  const cands = Array.from({ length: 8 }, (_, i) => ({ ...target, id: i + 1, latitude: at(i * 5) }));
  const res = findDuplicates(target, cands);
  assert.equal(res.length, DEFAULT_CONFIG.maxSuggestions);
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].score >= res[i].score);
});
