// Admin dashboard — every number comes live from GET /api/admin/stats.
import { Link } from 'react-router-dom';
import { useApi } from '../../lib/useApi.js';
import { ComplaintRows } from '../../components/ComplaintRows.jsx';
import { Empty, ErrorState, Loading } from '../../components/ui.jsx';

function Bars({ rows, label }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} className="bar-row">
          <span>{r.name}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ display: 'block', width: `${(r.total / max) * 100}%` }} />
          </span>
          <span className="n">{r.total}</span>
        </li>
      ))}
    </ul>
  );
}

function Trend({ days }) {
  const max = Math.max(1, ...days.map((d) => d.reported + d.resolved));
  const totalRep = days.reduce((a, d) => a + d.reported, 0);
  const totalRes = days.reduce((a, d) => a + d.resolved, 0);
  return (
    <figure style={{ margin: 0 }}>
      <div className="trend" role="img" aria-label={`Last 30 days: ${totalRep} reported, ${totalRes} resolved`}>
        {days.map((d) => (
          <div key={d.date} className="trend-col" title={`${d.date}: ${d.reported} reported, ${d.resolved} resolved`}>
            <span className="rep" style={{ height: `${(d.reported / max) * 100}%` }} />
            <span className="res" style={{ height: `${(d.resolved / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="trend-axis">
        <span>{days[0]?.date}</span>
        <span>Today</span>
      </div>
      <figcaption className="map-legend">
        <span style={{ '--c': 'var(--ink-3)' }}>
          <i />
          Reported ({totalRep})
        </span>
        <span style={{ '--c': 'var(--green)' }}>
          <i />
          Resolved ({totalRes})
        </span>
      </figcaption>
    </figure>
  );
}

export default function AdminDashboard() {
  const stats = useApi('/admin/stats');
  const queue = useApi('/admin/complaints', { query: { status: 'submitted', sort: 'priority', limit: 6 } });

  if (stats.loading && !stats.data) return <Loading label="Loading statistics…" />;
  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;
  const tiles = [
    ['Pending', s.pending, 'submitted,under_review', 'var(--s-under_review)'],
    ['In progress', s.inProgress, 'in_progress', 'var(--s-in_progress)'],
    ['Resolved', s.resolved, 'resolved', 'var(--s-resolved)'],
    ['Rejected', s.rejected, 'rejected', 'var(--s-rejected)'],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Live figures from all {s.total} complaints.</p>
        </div>
        <Link to="/admin/complaints" className="btn">
          Manage complaints
        </Link>
      </div>

      <div className="stat-line">
        <Link to="/admin/complaints" className="stat lead">
          <div className="stat-value">{s.total}</div>
          <div className="stat-label">Total complaints</div>
        </Link>
        {tiles.map(([label, value, status, color]) => (
          <Link key={label} to={`/admin/complaints?status=${status}`} className="stat">
            <div className="stat-value">{value}</div>
            <div className="stat-label" style={{ '--c': color }}>
              <i />
              {label}
            </div>
          </Link>
        ))}
        <div className="stat">
          <div className="stat-value">{s.resolutionRate}%</div>
          <div className="stat-label">Resolution rate</div>
        </div>
      </div>

      {s.pendingDuplicateSuggestions > 0 && (
        <div className="alert alert-info">
          <p>
            <strong>{s.pendingDuplicateSuggestions}</strong> possible duplicate {s.pendingDuplicateSuggestions === 1 ? 'pair needs' : 'pairs need'} review.{' '}
            <Link to="/admin/duplicates">Review them</Link>
          </p>
        </div>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>Reported vs resolved, last 30 days</h2>
          <Trend days={s.last30Days} />
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            {s.avgResolutionHours === null
              ? 'No complaints resolved yet.'
              : `Average time to resolve: ${s.avgResolutionHours < 48 ? `${s.avgResolutionHours} hours` : `${(s.avgResolutionHours / 24).toFixed(1)} days`}.`}{' '}
            {s.last7Days} filed in the last 7 days.
          </p>
        </section>
        <section className="panel">
          <h2>By category</h2>
          <Bars rows={s.byCategory} label="Complaints by category" />
        </section>
        <section className="panel">
          <h2>By department</h2>
          <Bars rows={s.byDepartment} label="Complaints by department" />
        </section>
        <section className="panel">
          <div className="section-head">
            <h2 style={{ margin: 0 }}>New and waiting</h2>
            <Link to="/admin/complaints?status=submitted" className="small">
              See all
            </Link>
          </div>
          {queue.error && <ErrorState error={queue.error} onRetry={queue.reload} />}
          {queue.data &&
            (queue.data.items.length ? (
              <ComplaintRows items={queue.data.items} linkTo={(c) => `/admin/complaints/${c.id}`} />
            ) : (
              <Empty title="Inbox zero">No new complaints are waiting for review.</Empty>
            ))}
        </section>
      </div>
    </>
  );
}
