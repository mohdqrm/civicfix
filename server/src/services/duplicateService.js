// Connects the pure duplicate detector (duplicateDetector.js, Step 8) to the database.
//
// Flow when a complaint is filed:
//   1. Load complaints within the detector's distance (300 m) and time (30 days) window.
//   2. Load up to 500 recent complaints as the IDF "corpus" so rare words weigh more.
//   3. Score each candidate; store those above the threshold in duplicate_suggestions
//      with review_status = 'pending'.
//   4. An admin later confirms (sets complaints.duplicate_of) or dismisses each one.
// Nothing is merged or rejected automatically — a human always decides (FR12).
import { query, withTransaction } from '../db/pool.js';
import { DEFAULT_CONFIG, findDuplicates } from './duplicateDetector.js';
import { trackingId } from './complaintQueries.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

const toDetector = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  latitude: r.latitude,
  longitude: r.longitude,
  categoryId: r.category_id,
  createdAt: r.created_at,
});

const COLS = 'id, title, description, latitude, longitude, category_id, created_at, status';

/** Complaints close enough in space and time to `target` to be worth scoring. */
async function loadCandidates(target, cfg) {
  const dLat = cfg.maxDistanceM / 111320;
  const dLng = cfg.maxDistanceM / (111320 * Math.max(0.01, Math.cos((target.latitude * Math.PI) / 180)));
  const created = new Date(target.createdAt);
  const windowMs = cfg.maxAgeDays * 86400000;
  const { rows } = await query(
    `SELECT ${COLS} FROM complaints
     WHERE ($1::int IS NULL OR id <> $1) AND status <> 'rejected'
       AND latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5
       AND created_at BETWEEN $6 AND $7
     LIMIT 500`,
    [
      target.id ?? null,
      target.latitude - dLat,
      target.latitude + dLat,
      target.longitude - dLng,
      target.longitude + dLng,
      new Date(created.getTime() - windowMs),
      new Date(created.getTime() + windowMs),
    ]
  );
  return rows;
}

async function loadCorpus(target, candidates) {
  const { rows } = await query(
    `SELECT ${COLS} FROM complaints WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 500`,
    [new Date(new Date(target.createdAt).getTime() - 90 * 86400000)]
  );
  const byId = new Map(rows.map((r) => [r.id, toDetector(r)]));
  for (const c of candidates) byId.set(c.id, toDetector(c));
  const corpus = [...byId.values()];
  if (target.id === undefined || !byId.has(target.id)) corpus.push(target);
  return corpus;
}

/** Score `target` (a detector-shaped object) against nearby complaints. */
export async function scoreAgainstExisting(target, cfg = DEFAULT_CONFIG) {
  const rows = await loadCandidates(target, cfg);
  if (!rows.length) return { matches: [], rows };
  const candidates = rows.map(toDetector);
  const corpus = await loadCorpus(target, rows);
  return { matches: findDuplicates(target, candidates, { corpus, config: cfg }), rows };
}

/**
 * Run detection for a stored complaint and save new suggestions.
 * Returns the number of suggestions recorded. Errors are the caller's to log:
 * detection must never block a citizen's report from being saved.
 */
export async function detectAndStore(complaintId) {
  const { rows } = await query(`SELECT ${COLS} FROM complaints WHERE id = $1`, [complaintId]);
  if (!rows[0]) throw notFound('Complaint not found');
  const { matches } = await scoreAgainstExisting(toDetector(rows[0]));
  let stored = 0;
  for (const m of matches) {
    // Store each pair once as (newer id, older id); the older report is the likely original.
    const [newer, older] = complaintId > m.id ? [complaintId, m.id] : [m.id, complaintId];
    const res = await query(
      `INSERT INTO duplicate_suggestions (complaint_id, candidate_id, score, components)
       VALUES ($1, $2, $3, $4) ON CONFLICT (complaint_id, candidate_id) DO NOTHING`,
      [newer, older, m.score, JSON.stringify(m.components)]
    );
    stored += res.rowCount;
  }
  return stored;
}

const suggestionSelect = `
  SELECT ds.*,
    c1.title AS complaint_title, c1.status AS complaint_status, c1.created_at AS complaint_created_at, c1.image_url AS complaint_image,
    c2.title AS candidate_title, c2.status AS candidate_status, c2.created_at AS candidate_created_at, c2.image_url AS candidate_image,
    u.name AS reviewed_by_name
  FROM duplicate_suggestions ds
  JOIN complaints c1 ON c1.id = ds.complaint_id
  JOIN complaints c2 ON c2.id = ds.candidate_id
  LEFT JOIN users u ON u.id = ds.reviewed_by`;

const brief = (id, title, status, createdAt, imageUrl) => ({ id, trackingId: trackingId(id), title, status, createdAt, imageUrl });

export function serializeSuggestion(r) {
  return {
    id: r.id,
    score: r.score,
    components: r.components,
    reviewStatus: r.review_status,
    reviewedBy: r.reviewed_by_name ?? null,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    complaint: brief(r.complaint_id, r.complaint_title, r.complaint_status, r.complaint_created_at, r.complaint_image),
    likelyOriginal: brief(r.candidate_id, r.candidate_title, r.candidate_status, r.candidate_created_at, r.candidate_image),
  };
}

export async function listSuggestions({ status, page, limit }) {
  const total = (await query('SELECT COUNT(*) AS n FROM duplicate_suggestions WHERE review_status = $1', [status])).rows[0].n;
  const { rows } = await query(
    `${suggestionSelect} WHERE ds.review_status = $1 ORDER BY ds.score DESC, ds.id DESC LIMIT $2 OFFSET $3`,
    [status, limit, (page - 1) * limit]
  );
  return { items: rows.map(serializeSuggestion), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function suggestionsForComplaint(complaintId) {
  const { rows } = await query(
    `${suggestionSelect} WHERE ds.complaint_id = $1 OR ds.candidate_id = $1 ORDER BY ds.score DESC`,
    [complaintId]
  );
  return rows.map(serializeSuggestion);
}

/** Human review of one suggestion. Confirming links the newer complaint to the older one. */
export async function reviewSuggestion(id, decision, adminId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM duplicate_suggestions WHERE id = $1 FOR UPDATE', [id]);
    const s = rows[0];
    if (!s) throw notFound('Suggestion not found');
    if (s.review_status !== 'pending') throw conflict(`This suggestion was already ${s.review_status}`);
    if (decision === 'confirmed') {
      const target = await db.query('SELECT duplicate_of FROM complaints WHERE id = $1 FOR UPDATE', [s.complaint_id]);
      if (target.rows[0].duplicate_of && target.rows[0].duplicate_of !== s.candidate_id) {
        throw badRequest(`${trackingId(s.complaint_id)} is already marked as a duplicate of ${trackingId(target.rows[0].duplicate_of)}`);
      }
      await db.query('UPDATE complaints SET duplicate_of = $1, updated_at = now() WHERE id = $2', [s.candidate_id, s.complaint_id]);
    }
    await db.query(
      'UPDATE duplicate_suggestions SET review_status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3',
      [decision, adminId, id]
    );
    const updated = await db.query(`${suggestionSelect} WHERE ds.id = $1`, [id]);
    return serializeSuggestion(updated.rows[0]);
  });
}
