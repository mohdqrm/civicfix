// One AI duplicate suggestion: both reports side by side, the score broken down
// into its four signals, and buttons for the human decision.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatDate, formatDistance } from '../lib/format.js';
import { Photo, StatusBadge } from './ui.jsx';

const SIGNALS = [
  ['text', 'Wording'],
  ['geo', 'Distance'],
  ['category', 'Category'],
  ['time', 'Timing'],
];

function Side({ c, label }) {
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Photo src={c.imageUrl} alt="" />
        <div style={{ minWidth: 0 }}>
          <Link to={`/admin/complaints/${c.id}`} style={{ fontWeight: 600 }}>
            {c.trackingId}
          </Link>
          <div style={{ overflowWrap: 'anywhere' }}>{c.title}</div>
          <div className="small muted" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <StatusBadge status={c.status} /> {formatDate(c.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DuplicateCard({ s, onReviewed }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const pending = s.reviewStatus === 'pending';

  async function decide(decision) {
    setBusy(decision);
    setError(null);
    try {
      const d = await api(`/admin/duplicates/${s.id}`, { method: 'PATCH', body: { decision } });
      onReviewed?.(d.suggestion);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`dup-card${pending ? '' : ' reviewed'}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <strong>Similarity score {Math.round(s.score * 100)}%</strong>
        <span className="small muted">
          {formatDistance(s.components.distanceM)} apart, {s.components.daysApart} days apart
        </span>
      </div>
      <div className="score-bars" aria-label="Score breakdown">
        {SIGNALS.map(([k, label]) => (
          <div key={k}>
            {label} {Math.round(s.components[k] * 100)}%
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${s.components[k] * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="dup-pair">
        <Side c={s.complaint} label="Newer report" />
        <Side c={s.likelyOriginal} label="Likely original" />
      </div>
      {error && <p className="field-error">{error}</p>}
      {pending ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => decide('confirmed')}>
            {busy === 'confirmed' ? 'Confirming…' : 'Confirm duplicate'}
          </button>
          <button type="button" className="btn btn-secondary btn-small" disabled={!!busy} onClick={() => decide('dismissed')}>
            {busy === 'dismissed' ? 'Dismissing…' : 'Not the same problem'}
          </button>
          <span className="small muted">Confirming links the reports. It doesn’t change either status.</span>
        </div>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          {s.reviewStatus === 'confirmed' ? 'Confirmed as duplicate' : 'Dismissed'} by {s.reviewedBy} on {formatDate(s.reviewedAt)}.
        </p>
      )}
    </div>
  );
}
