export const STATUSES = [
  { value: 'submitted', label: 'Submitted', hint: 'Received, waiting to be looked at' },
  { value: 'under_review', label: 'Under review', hint: 'The team is checking the report' },
  { value: 'in_progress', label: 'In progress', hint: 'Work has started on site' },
  { value: 'resolved', label: 'Resolved', hint: 'The problem has been fixed' },
  { value: 'rejected', label: 'Rejected', hint: 'Not actionable — see the reason' },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// The happy path a complaint travels; drawn as the "road" on the details page.
export const ROUTE = ['submitted', 'under_review', 'in_progress', 'resolved'];

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const formatDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
export const formatDateTime = (d) => (d ? timeFmt.format(new Date(d)) : '');

export function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(d);
}

export const formatDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// Default map view: central New Delhi (where the sample data lives).
export const DEFAULT_CENTER = [28.6315, 77.2167];
