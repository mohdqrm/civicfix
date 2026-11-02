// Read-side of complaints: building filtered list queries and turning database
// rows into the JSON the API returns.
//
// There are three "views" of a complaint:
//   public — anyone can see it. Never includes who reported it (FR15).
//   owner  — the citizen who filed it: public view + isMine flag.
//   admin  — everything, including reporter contact details and AI duplicate info.
import { query } from '../db/pool.js';

export const trackingId = (id) => `CF-${String(id).padStart(6, '0')}`;

const BASE_FROM = `
  FROM complaints c
  JOIN categories cat ON cat.id = c.category_id
  JOIN users u ON u.id = c.user_id
  LEFT JOIN assignments a ON a.complaint_id = c.id AND a.is_current
  LEFT JOIN departments d ON d.id = a.department_id`;

const BASE_COLUMNS = `
  c.*, cat.slug AS category_slug, cat.name AS category_name,
  d.id AS department_id, d.name AS department_name,
  u.name AS reporter_name, u.email AS reporter_email, u.phone AS reporter_phone,
  (SELECT COUNT(*) FROM duplicate_suggestions ds
     WHERE ds.review_status = 'pending' AND (ds.complaint_id = c.id OR ds.candidate_id = c.id)
  ) AS pending_duplicates`;

/** SQL for great-circle distance in metres from ($lat, $lng) to the complaint. */
const distanceSql = (latP, lngP) => `(6371000 * 2 * ASIN(LEAST(1, SQRT(
    POWER(SIN(RADIANS(c.latitude - ${latP}) / 2), 2) +
    COS(RADIANS(${latP})) * COS(RADIANS(c.latitude)) *
    POWER(SIN(RADIANS(c.longitude - ${lngP}) / 2), 2)))))`;

const escapeLike = (s) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Build WHERE clauses + params from validated filters.
 * `admin` unlocks the extra admin-only filters; `userId` restricts to one reporter.
 */
export function buildFilters(f, { admin = false, userId } = {}) {
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  let distance = null;

  if (userId) where.push(`c.user_id = ${p(userId)}`);
  if (f.status?.length) where.push(`c.status = ANY(${p(f.status)}::text[])`);
  if (f.category) {
    where.push(/^\d+$/.test(f.category) ? `cat.id = ${p(Number(f.category))}` : `cat.slug = ${p(f.category)}`);
  }
  if (f.q) {
    const idMatch = /^(CF-?)?(\d{1,9})$/i.exec(f.q);
    const like = p(`%${escapeLike(f.q)}%`);
    const textMatch = `(c.title ILIKE ${like} ESCAPE '\\' OR c.description ILIKE ${like} ESCAPE '\\' OR c.landmark ILIKE ${like} ESCAPE '\\')`;
    where.push(idMatch ? `(c.id = ${p(Number(idMatch[2]))} OR ${textMatch})` : textMatch);
  }
  if (f.lat !== undefined && f.lng !== undefined) {
    // Cheap bounding box first (can use the location index), then the exact distance.
    const dLat = f.radius / 111320;
    const dLng = f.radius / (111320 * Math.max(0.01, Math.cos((f.lat * Math.PI) / 180)));
    where.push(`c.latitude BETWEEN ${p(f.lat - dLat)} AND ${p(f.lat + dLat)}`);
    where.push(`c.longitude BETWEEN ${p(f.lng - dLng)} AND ${p(f.lng + dLng)}`);
    distance = distanceSql(p(f.lat), p(f.lng));
    where.push(`${distance} <= ${p(f.radius)}`);
  }
  if (admin) {
    if (f.priority?.length) where.push(`c.priority = ANY(${p(f.priority)}::text[])`);
    if (f.departmentId) where.push(`d.id = ${p(f.departmentId)}`);
    if (f.from) where.push(`c.created_at >= ${p(f.from)}`);
    if (f.to) where.push(`c.created_at <= ${p(f.to)}`);
    if (f.hasDuplicates === 'true') {
      where.push(`EXISTS (SELECT 1 FROM duplicate_suggestions ds WHERE ds.review_status = 'pending'
                   AND (ds.complaint_id = c.id OR ds.candidate_id = c.id))`);
    }
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params, distance };
}

// Sort keys are whitelisted: user input is never placed into ORDER BY directly.
const ORDER = {
  newest: 'c.created_at DESC, c.id DESC',
  oldest: 'c.created_at ASC, c.id ASC',
  updated: 'c.updated_at DESC, c.id DESC',
  priority: `CASE c.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, c.created_at DESC`,
};

export async function listComplaints(f, { view = 'public', userId, currentUserId } = {}) {
  const { where, params, distance } = buildFilters(f, { admin: view === 'admin', userId });
  const order = f.sort === 'distance' && distance ? `distance_m ASC` : ORDER[f.sort] ?? ORDER.newest;
  const offset = (f.page - 1) * f.limit;
  const countRes = await query(`SELECT COUNT(*) AS n ${BASE_FROM} ${where}`, params);
  const total = countRes.rows[0].n;
  const { rows } = await query(
    `SELECT ${BASE_COLUMNS} ${distance ? `, ${distance} AS distance_m` : ''}
     ${BASE_FROM} ${where}
     ORDER BY ${order}
     LIMIT ${Number(f.limit)} OFFSET ${Number(offset)}`,
    params
  );
  return {
    items: rows.map((r) => serialize(r, view, currentUserId)),
    page: f.page,
    limit: f.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / f.limit)),
  };
}

/** Minimal marker data for the map — up to 1000 points, no descriptions or reporter info. */
export async function mapMarkers(f) {
  const { where, params } = buildFilters({ ...f });
  const { rows } = await query(
    `SELECT c.id, c.title, c.status, c.latitude, c.longitude, c.created_at, cat.slug AS category_slug, cat.name AS category_name
     ${BASE_FROM} ${where} ORDER BY c.created_at DESC LIMIT 1000`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    trackingId: trackingId(r.id),
    title: r.title,
    status: r.status,
    latitude: r.latitude,
    longitude: r.longitude,
    createdAt: r.created_at,
    category: { slug: r.category_slug, name: r.category_name },
  }));
}

export async function getComplaintRow(id, db = { query }) {
  const { rows } = await db.query(`SELECT ${BASE_COLUMNS} ${BASE_FROM} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getStatusHistory(id, view) {
  const { rows } = await query(
    `SELECT sh.id, sh.old_status, sh.new_status, sh.note, sh.created_at, u.name AS changed_by_name, u.role AS changed_by_role
     FROM status_history sh LEFT JOIN users u ON u.id = sh.changed_by
     WHERE sh.complaint_id = $1 ORDER BY sh.created_at ASC, sh.id ASC`,
    [id]
  );
  return rows.map((r) => ({
    id: r.id,
    fromStatus: r.old_status,
    toStatus: r.new_status,
    note: r.note,
    at: r.created_at,
    // Publicly we say *which kind* of user made the change, not who.
    changedBy:
      view === 'admin'
        ? r.changed_by_name ?? 'System'
        : r.changed_by_role === 'admin'
          ? 'CivicFix team'
          : r.changed_by_role === 'citizen'
            ? 'Reporter'
            : 'System',
  }));
}

export async function getAssignmentHistory(id) {
  const { rows } = await query(
    `SELECT a.id, a.note, a.is_current, a.created_at, d.id AS department_id, d.name AS department_name, u.name AS assigned_by
     FROM assignments a JOIN departments d ON d.id = a.department_id LEFT JOIN users u ON u.id = a.assigned_by
     WHERE a.complaint_id = $1 ORDER BY a.created_at ASC, a.id ASC`,
    [id]
  );
  return rows.map((r) => ({
    id: r.id,
    department: { id: r.department_id, name: r.department_name },
    note: r.note,
    isCurrent: r.is_current,
    assignedBy: r.assigned_by ?? 'System (category default)',
    at: r.created_at,
  }));
}

export function serialize(r, view = 'public', currentUserId) {
  const out = {
    id: r.id,
    trackingId: trackingId(r.id),
    title: r.title,
    description: r.description,
    category: { id: r.category_id, slug: r.category_slug, name: r.category_name },
    status: r.status,
    priority: r.priority,
    latitude: r.latitude,
    longitude: r.longitude,
    landmark: r.landmark,
    imageUrl: r.image_url,
    rejectionReason: r.rejection_reason,
    department: r.department_id ? { id: r.department_id, name: r.department_name } : null,
    duplicateOf: r.duplicate_of ? { id: r.duplicate_of, trackingId: trackingId(r.duplicate_of) } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
  if (r.distance_m !== undefined && r.distance_m !== null) out.distanceM = Math.round(r.distance_m);
  if (currentUserId) out.isMine = r.user_id === currentUserId;
  if (view === 'admin') {
    out.reporter = { id: r.user_id, name: r.reporter_name, email: r.reporter_email, phone: r.reporter_phone };
    out.pendingDuplicates = r.pending_duplicates;
  }
  return out;
}
