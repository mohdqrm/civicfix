import { Link } from 'react-router-dom';
import { Photo, StatusBadge } from './ui.jsx';
import { formatDistance, timeAgo } from '../lib/format.js';

/** A list of complaints as rows (photo, title, meta, status). */
export function ComplaintRows({ items, linkTo = (c) => `/issues/${c.id}`, showMine = true }) {
  return (
    <ul className="rows">
      {items.map((c) => (
        <li key={c.id}>
          <Link to={linkTo(c)} className="row">
            <Photo src={c.imageUrl} alt="" />
            <div style={{ minWidth: 0 }}>
              <p className="row-title">{c.title}</p>
              <div className="row-meta">
                <span className="row-id">{c.trackingId}</span>
                <span>{c.category.name}</span>
                {c.landmark && <span>{c.landmark}</span>}
                {c.distanceM !== undefined && <span>{formatDistance(c.distanceM)} away</span>}
                <span>{timeAgo(c.createdAt)}</span>
              </div>
            </div>
            <div className="row-side">
              <StatusBadge status={c.status} />
              {showMine && c.isMine && <span className="tag">Your report</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RowsSkeleton({ n = 4 }) {
  return (
    <div className="rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" style={i === 0 ? { borderTop: 0 } : undefined} />
      ))}
    </div>
  );
}
