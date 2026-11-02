// Citizen dashboard: counts by status, my reports (filterable), and updates.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/useApi.js';
import { STATUSES, timeAgo } from '../lib/format.js';
import { ComplaintRows, RowsSkeleton } from '../components/ComplaintRows.jsx';
import { Empty, ErrorState, Pagination } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const mine = useApi('/me/complaints', { query: { status, page, limit: 10 } }, [status, page]);
  const notes = useApi('/me/notifications', { query: { limit: 8 } });
  const counts = mine.data?.counts;

  const pick = (s) => {
    setStatus(s);
    setPage(1);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hello, {user.name.split(' ')[0]}</h1>
          <p className="muted">Your reports and what’s happened to them.</p>
        </div>
        <Link to="/report" className="btn">
          Report an issue
        </Link>
      </div>

      {counts && (
        <div className="stat-line" role="group" aria-label="Your reports by status">
          <button type="button" className={`stat lead`} onClick={() => pick('')} style={{ textAlign: 'left', border: 0, font: 'inherit', cursor: 'pointer' }}>
            <div className="stat-value">{counts.total}</div>
            <div className="stat-label">All my reports</div>
          </button>
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              className="stat"
              aria-pressed={status === s.value}
              onClick={() => pick(status === s.value ? '' : s.value)}
              style={{
                textAlign: 'left',
                border: 0,
                borderLeft: '1px solid var(--line)',
                font: 'inherit',
                cursor: 'pointer',
                background: status === s.value ? 'var(--green-tint)' : 'var(--surface)',
              }}
            >
              <div className="stat-value">{counts[s.value]}</div>
              <div className="stat-label" style={{ '--c': `var(--s-${s.value})` }}>
                <i />
                {s.label}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="two-col">
        <section aria-labelledby="mine-h">
          <div className="section-head">
            <h2 id="mine-h">{status ? `${STATUSES.find((s) => s.value === status).label} reports` : 'My reports'}</h2>
            {status && (
              <button type="button" className="linklike small" onClick={() => pick('')}>
                Show all
              </button>
            )}
          </div>
          {mine.loading && !mine.data && <RowsSkeleton />}
          {mine.error && <ErrorState error={mine.error} onRetry={mine.reload} />}
          {mine.data &&
            (mine.data.items.length ? (
              <>
                <ComplaintRows items={mine.data.items} showMine={false} />
                <Pagination page={mine.data.page} totalPages={mine.data.totalPages} onPage={setPage} />
              </>
            ) : status ? (
              <Empty title="None with this status">You have no reports that are {STATUSES.find((s) => s.value === status).label.toLowerCase()}.</Empty>
            ) : (
              <Empty title="You haven’t reported anything yet" action={<Link to="/report" className="btn">Report your first issue</Link>}>
                When you report a problem, it’ll appear here with its tracking ID and status.
              </Empty>
            ))}
        </section>

        <aside className="panel" aria-labelledby="updates-h">
          <div className="section-head">
            <h2 id="updates-h" style={{ fontSize: 'var(--step-1)' }}>
              Updates
            </h2>
            {notes.data?.unreadCount > 0 && (
              <button
                type="button"
                className="linklike small"
                onClick={async () => {
                  await api('/me/notifications/read-all', { method: 'POST' });
                  notes.reload();
                }}
              >
                Mark all as read
              </button>
            )}
          </div>
          {notes.error && <ErrorState error={notes.error} onRetry={notes.reload} />}
          {notes.data &&
            (notes.data.items.length ? (
              <ul className="notice-list">
                {notes.data.items.map((n) => (
                  <li key={n.id} className={n.isRead ? '' : 'unread'}>
                    {n.complaint ? (
                      <Link
                        to={`/issues/${n.complaint.id}`}
                        onClick={() => !n.isRead && api(`/me/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {})}
                        style={{ color: 'inherit' }}
                      >
                        {n.message}
                      </Link>
                    ) : (
                      n.message
                    )}
                    <span className="when">{timeAgo(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                No updates yet. You’ll be notified here when the team changes the status of one of your reports.
              </p>
            ))}
        </aside>
      </div>
    </>
  );
}
