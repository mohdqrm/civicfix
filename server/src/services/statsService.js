// Admin dashboard statistics, computed live from the database on every request
// (FR11) — no cached or hard-coded numbers.
//
// Definitions (also in docs/API.md):
//   pending        = submitted + under_review  (nobody is working on it yet)
//   resolutionRate = resolved / total * 100, one decimal place (0 when there are no complaints)
//   avgResolutionHours = mean time from filing to the current resolved_at, over resolved complaints
import { query } from '../db/pool.js';

export async function getStats() {
  const totals = (
    await query(`SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'submitted')    AS submitted,
      COUNT(*) FILTER (WHERE status = 'under_review') AS under_review,
      COUNT(*) FILTER (WHERE status = 'in_progress')  AS in_progress,
      COUNT(*) FILTER (WHERE status = 'resolved')     AS resolved,
      COUNT(*) FILTER (WHERE status = 'rejected')     AS rejected,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last7_days,
      AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE status = 'resolved') AS avg_resolution_hours
    FROM complaints`)
  ).rows[0];

  const byCategory = (
    await query(`SELECT cat.id, cat.slug, cat.name,
        COUNT(c.id) AS total,
        COUNT(c.id) FILTER (WHERE c.status = 'resolved') AS resolved,
        COUNT(c.id) FILTER (WHERE c.status IN ('submitted', 'under_review', 'in_progress')) AS open
      FROM categories cat LEFT JOIN complaints c ON c.category_id = cat.id
      GROUP BY cat.id ORDER BY total DESC, cat.name`)
  ).rows;

  const byDepartment = (
    await query(`SELECT d.id, d.name,
        COUNT(c.id) AS total,
        COUNT(c.id) FILTER (WHERE c.status IN ('submitted', 'under_review', 'in_progress')) AS open
      FROM departments d
      LEFT JOIN assignments a ON a.department_id = d.id AND a.is_current
      LEFT JOIN complaints c ON c.id = a.complaint_id
      GROUP BY d.id ORDER BY total DESC, d.name`)
  ).rows;

  const unassigned = (
    await query(`SELECT COUNT(*) AS n FROM complaints c
      WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.complaint_id = c.id AND a.is_current)`)
  ).rows[0].n;

  const byPriority = (
    await query(`SELECT priority, COUNT(*) AS total FROM complaints GROUP BY priority`)
  ).rows.reduce((acc, r) => ({ ...acc, [r.priority]: r.total }), { low: 0, medium: 0, high: 0, critical: 0 });

  const daily = (
    await query(`SELECT to_char(day, 'YYYY-MM-DD') AS date,
        (SELECT COUNT(*) FROM complaints c WHERE c.created_at >= day AND c.created_at < day + interval '1 day') AS reported,
        (SELECT COUNT(*) FROM complaints c WHERE c.resolved_at >= day AND c.resolved_at < day + interval '1 day') AS resolved
      FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS day
      ORDER BY day`)
  ).rows;

  const pendingDuplicates = (
    await query(`SELECT COUNT(*) AS n FROM duplicate_suggestions WHERE review_status = 'pending'`)
  ).rows[0].n;

  const total = totals.total;
  return {
    total,
    byStatus: {
      submitted: totals.submitted,
      under_review: totals.under_review,
      in_progress: totals.in_progress,
      resolved: totals.resolved,
      rejected: totals.rejected,
    },
    pending: totals.submitted + totals.under_review,
    inProgress: totals.in_progress,
    resolved: totals.resolved,
    rejected: totals.rejected,
    resolutionRate: total ? Math.round((totals.resolved / total) * 1000) / 10 : 0,
    avgResolutionHours: totals.avg_resolution_hours === null ? null : Math.round(Number(totals.avg_resolution_hours) * 10) / 10,
    last7Days: totals.last7_days,
    byPriority,
    byCategory,
    byDepartment: [...byDepartment, { id: null, name: 'Unassigned', total: unassigned, open: null }],
    last30Days: daily,
    pendingDuplicateSuggestions: pendingDuplicates,
  };
}
