# CivicFix AI: Duplicate Complaint Detection

## What it does

When a citizen submits a complaint, CivicFix looks for earlier complaints that are probably about the **same real-world problem** (for example, five people reporting one pothole). Matches are shown to an administrator as *suggestions*. The admin confirms or dismisses each one — **nothing is merged or rejected automatically**.

The same scorer also runs *before* submission, so a citizen can see "this may already be reported" while filling in the form.

Code: `server/src/services/duplicateDetector.js` (no external libraries).

## How it works

For every earlier complaint within **300 m** and **30 days**, four signals are computed, each between 0 and 1:

| Signal | Formula | Weight |
|---|---|---|
| Text similarity | TF-IDF cosine similarity of title + description | 0.45 |
| Location | `1 − distance / 300 m` | 0.30 |
| Category | 1 if same category, else 0 | 0.15 |
| Time | `1 − days apart / 30` | 0.10 |

`score = 0.45·text + 0.30·location + 0.15·category + 0.10·time`

A pair with score **≥ 0.51** becomes a suggestion (top 5 per complaint). The admin sees the score *and* each component, so the reason for a suggestion is explainable.

**Text preprocessing:** lowercase → remove punctuation → drop stopwords (English + common Hindi/Hinglish fillers) → light stemming → map synonyms to one word (`crater`, `gaddha`, `hole` → `pothole`; `kachra`, `trash`, `rubbish` → `garbage`; `naali`, `gutter`, `sewer` → `drain`) → add word pairs (bigrams).

**TF-IDF:** a word's weight is how often it appears in this report × how rare it is across recent reports. Shared rare words ("Barakhamba", "pillar 120") count far more than shared common words ("road").

**Why not a trained model or embeddings?** There is no real labelled CivicFix data yet, and a hand-written dataset of ~100 reports is far too small to train on honestly. TF-IDF needs no training, runs instantly, and is fully explainable to an admin. Sentence embeddings are the natural next step once real data exists (see Limitations).

## Evaluation

**Dataset:** `ml/duplicate-dataset.json` — 98 hand-written, *synthetic* reports in 12 Delhi neighbourhoods, grouped into clusters (same cluster = same real problem). It includes Hinglish wording, different problems close together, and two deliberate edge cases (a re-report after 40 days; reports 400 m apart along one long road).

**Method:** every pair of reports within a split is one example (duplicate or not). Each method's single parameter is tuned on the **dev** split only (maximise F1). The **test** split is then scored once. The **stress** split was written after the first test run, specifically to check cases where location alone fails; it is never used for tuning.

Run it yourself: `npm run eval:duplicates` (writes `ml/evaluation-results.json`).

### Results (measured, from `evaluation-results.json`)

| Method | Tuned on dev | Test P / R / F1 (TP/FP/FN) | Stress P / R / F1 (TP/FP/FN) |
|---|---|---|---|
| **CivicFix model** | threshold 0.51 | 100% / 100% / **100%** (28/0/0) | 50.0% / 85.7% / **63.2%** (6/6/1) |
| Distance only | ≤ 80 m | 58.3% / 100% / 73.7% (28/20/0) | 9.1% / 28.6% / 13.8% (2/20/5) |
| Same category + distance | ≤ 80 m | 100% / 100% / 100% (28/0/0) | 25.0% / 28.6% / 26.7% (2/6/5) |
| Text similarity only | cosine ≥ 0.28 | 55.6% / 53.6% / 54.5% (15/12/13) | 100% / 57.1% / 72.7% (4/0/3) |

Pairs: dev 861 (29 duplicates), test 780 (28), stress 120 (7).

### What these numbers honestly say

1. **The normal test set was too easy.** A simple rule ("same category and within 80 m") also scored 100%. So the test set alone does not prove the text model adds value.
2. **On the stress set, location-based rules break down** when phone GPS puts reports of the same problem 100–180 m apart; the CivicFix model still found 6 of 7 duplicate pairs.
3. **The model's main weakness:** different problems of the same category 30–40 m apart (a pothole vs a missing divider railing at the same junction) get pushed over the threshold by location + category even though the text differs. That caused all 6 stress false positives.
4. **No method wins everywhere.** Text-only is best on the stress set but worst on the normal test set. The combined model is the most consistent across both.
5. **The samples are small** (28 and 7 duplicate pairs), so these percentages have wide uncertainty. 100% on 28 pairs does not mean the model is perfect.

Since every match is reviewed by an admin, a false positive costs a few seconds of review, while a missed duplicate means wasted field visits. The current threshold therefore favours recall.

## Limitations and next steps

- All data is synthetic and written by the developer, who also wrote the synonym list — real citizen text will be messier and the vocabulary list will miss words.
- Candidate filter is hard: reports > 300 m or > 30 days apart are never compared (both dev false negatives come from this).
- Next improvements, each to be validated on **real** labelled data: require a minimum text similarity before location can count; sentence embeddings (e.g. a multilingual MiniLM) for meaning-level matching; using admin confirm/dismiss decisions as training labels; photo similarity.
