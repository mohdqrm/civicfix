// A complaint's progress drawn as a stretch of road with four stops, followed by
// the full status history (every change, with who/when/note).
import { ROUTE, STATUS_LABEL, formatDateTime } from '../lib/format.js';

export function StatusRoad({ status, history = [] }) {
  const rejected = status === 'rejected';
  // For a rejected complaint, show how far it got before being rejected.
  const reached = rejected
    ? Math.max(0, ...history.filter((h) => ROUTE.includes(h.toStatus)).map((h) => ROUTE.indexOf(h.toStatus)))
    : ROUTE.indexOf(status);
  const progress = rejected ? (reached / (ROUTE.length - 1)) * 100 + 8 : (reached / (ROUTE.length - 1)) * 100;
  const when = (s) => {
    const h = [...history].reverse().find((x) => x.toStatus === s);
    return h ? formatDateTime(h.at) : null;
  };

  return (
    <div>
      <div className={`road${rejected ? ' is-rejected' : ''}`} style={{ '--progress': `${progress}%` }}>
        <div className="road-progress" aria-hidden="true" />
        {ROUTE.map((s, i) => {
          const done = i < reached || (i === reached && status === 'resolved');
          const current = !rejected && i === reached && status !== 'resolved';
          return (
            <div
              key={s}
              className={`road-stop${i === ROUTE.length - 1 ? ' at-end' : i > 0 ? ' at-middle' : ''}${done ? ' done' : ''}${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined}>
              <span className="road-dot" aria-hidden="true" />
              <span>
                {STATUS_LABEL[s]}
                {(done || current) && when(s) && (
                  <>
                    <br />
                    <span className="small muted" style={{ fontWeight: 400 }}>
                      {when(s)}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {rejected && <p className="small" style={{ color: 'var(--danger)', fontWeight: 600, marginTop: 10 }}>Rejected after {STATUS_LABEL[ROUTE[reached]].toLowerCase()}.</p>}
    </div>
  );
}

export function HistoryList({ history }) {
  return (
    <ol className="history" aria-label="Status history">
      {history.map((h) => (
        <li key={h.id}>
          <strong>{h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ${STATUS_LABEL[h.toStatus]}` : STATUS_LABEL[h.toStatus]}</strong>
          <div className="when">
            {formatDateTime(h.at)} by {h.changedBy}
          </div>
          {h.note && <p className="note">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}
