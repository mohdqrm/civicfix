import { Link, useParams } from 'react-router-dom';
import { useApi } from '../lib/useApi.js';
import { formatDateTime } from '../lib/format.js';
import { ComplaintMap } from '../components/MapView.jsx';
import { HistoryList, StatusRoad } from '../components/StatusRoad.jsx';
import { ErrorState, Loading, StatusBadge, Ticket } from '../components/ui.jsx';

export default function IssueDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/complaints/${encodeURIComponent(id)}`, {}, [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const c = data.complaint;

  return (
    <>
      <Link to={c.isMine ? '/dashboard' : '/issues'} className="back">
        {c.isMine ? 'Back to my reports' : 'Back to all issues'}
      </Link>
      <div className="two-col">
        <article>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <StatusBadge status={c.status} />
            <span className="tag">{c.category.name}</span>
            {c.isMine && <span className="tag">Your report</span>}
          </div>
          <h1 style={{ fontSize: 'var(--step-3)' }}>{c.title}</h1>
          {c.imageUrl && <img src={c.imageUrl} alt={`Photo of: ${c.title}`} className="detail-photo" />}

          <section className="panel" aria-labelledby="progress-h">
            <h2 id="progress-h">Progress</h2>
            <StatusRoad status={c.status} history={c.statusHistory} />
            {c.status === 'rejected' && c.rejectionReason && (
              <div className="reason">
                <strong>Why it was rejected:</strong> {c.rejectionReason}
              </div>
            )}
            {c.duplicateOf && (
              <div className="alert alert-info" style={{ marginTop: 16 }}>
                <p>
                  The CivicFix team linked this report to{' '}
                  <Link to={`/issues/${c.duplicateOf.id}`}>{c.duplicateOf.trackingId}</Link>, which describes the same problem.
                </p>
              </div>
            )}
            <HistoryList history={c.statusHistory} />
          </section>

          <section className="panel" aria-labelledby="desc-h">
            <h2 id="desc-h">What was reported</h2>
            <p className="description">{c.description}</p>
          </section>
        </article>

        <aside>
          <Ticket complaint={c} note={c.isMine ? 'Keep this ID to follow your report.' : undefined} />
          <div className="panel" style={{ marginTop: 20 }}>
            <dl className="detail-meta">
              <dt>Reported</dt>
              <dd>{formatDateTime(c.createdAt)}</dd>
              <dt>Last update</dt>
              <dd>{formatDateTime(c.updatedAt)}</dd>
              {c.resolvedAt && (
                <>
                  <dt>Resolved</dt>
                  <dd>{formatDateTime(c.resolvedAt)}</dd>
                </>
              )}
              <dt>Department</dt>
              <dd>{c.department?.name ?? 'Not assigned yet'}</dd>
              {c.landmark && (
                <>
                  <dt>Landmark</dt>
                  <dd>{c.landmark}</dd>
                </>
              )}
            </dl>
          </div>
          <div style={{ marginTop: 20 }}>
            <ComplaintMap markers={[c]} className="map small" zoom={16} center={[c.latitude, c.longitude]} />
            <p className="small muted" style={{ marginTop: 6 }}>
              <a href={`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=18/${c.latitude}/${c.longitude}`} target="_blank" rel="noreferrer">
                Open in OpenStreetMap
              </a>
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
