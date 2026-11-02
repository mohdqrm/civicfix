// Small building blocks used across pages.
import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABEL, formatDate } from '../lib/format.js';

export function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function PriorityTag({ priority }) {
  return <span className={`tag priority-${priority}`}>{priority[0].toUpperCase() + priority.slice(1)} priority</span>;
}

/** The tracking-ID "ticket stub" — the one bold element of the design. */
export function Ticket({ complaint, compact = false, note }) {
  return (
    <div className={`ticket${compact ? ' compact' : ''}`} role="group" aria-label={`Tracking ID ${complaint.trackingId}`}>
      <div className="ticket-stub">
        <span>Tracking ID</span>
        {!compact && <span>{formatDate(complaint.createdAt)}</span>}
      </div>
      <div className="ticket-body">
        <div className="ticket-id">{complaint.trackingId}</div>
        {!compact && <div className="ticket-meta">{note ?? 'Use this ID to follow your report.'}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="alert alert-error" role="alert">
      <p>
        <strong>{error?.status === 404 ? 'Not found.' : 'This didn’t load.'}</strong> {error?.message}
      </p>
      {onRetry && error?.status !== 404 && (
        <button type="button" className="btn btn-secondary btn-small" onClick={onRetry} style={{ marginTop: 8 }}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pages">
      <button type="button" className="btn btn-secondary btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button type="button" className="btn btn-secondary btn-small" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

/** Label + input + hint + error, wired up with ids for screen readers. */
export function Field({ label, hint, error, children, counter }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {counter}
      {error && (
        <span className="field-error" id={errId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function FormError({ error }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <p>{error.details?.length ? 'Please fix the highlighted fields.' : error.message}</p>
    </div>
  );
}

export function Photo({ src, alt, className = 'row-thumb' }) {
  if (!src) {
    return (
      <div className={`${className} placeholder`} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="11" r="2" />
          <path d="M21 16l-5-5-8 8" />
        </svg>
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}

export const TrackLink = ({ complaint, admin }) => (
  <Link to={admin ? `/admin/complaints/${complaint.id}` : `/issues/${complaint.id}`}>{complaint.trackingId}</Link>
);

// ---------- toast ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const show = useCallback((m) => setMsg({ text: m, key: Date.now() }), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">{msg && <div className="toast" key={msg.key}>{msg.text}</div>}</div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
