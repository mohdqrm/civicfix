// One complaint, full admin view: reporter, photo, map, history, and the actions
// panel (status, priority & category, department, duplicate review).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { PRIORITIES, STATUSES, STATUS_LABEL, formatDateTime } from '../../lib/format.js';
import { ComplaintMap } from '../../components/MapView.jsx';
import { HistoryList, StatusRoad } from '../../components/StatusRoad.jsx';
import { DuplicateCard } from '../../components/DuplicateCard.jsx';
import { ErrorState, Loading, PriorityTag, StatusBadge, Ticket, useToast } from '../../components/ui.jsx';

function StatusForm({ c, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(c.status);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setStatus(c.status), [c.status]);
  const fe = error?.fieldErrors ?? {};

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const d = await api(`/admin/complaints/${c.id}/status`, {
        method: 'PATCH',
        body: { status, note: note || undefined, rejectionReason: status === 'rejected' ? reason : undefined },
      });
      setNote('');
      setReason('');
      onSaved(d.complaint);
      toast(`Status changed to ${STATUS_LABEL[status]}. The reporter has been notified.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h3>Update status</h3>
      {error && !error.details?.length && <p className="field-error">{error.message}</p>}
      <div className="field">
        <label htmlFor="st">New status</label>
        <select id="st" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
              {s.value === c.status ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </div>
      {status === 'rejected' && (
        <div className="field">
          <label htmlFor="rr">Reason for rejecting</label>
          <span className="hint">Shown publicly and sent to the reporter.</span>
          <textarea id="rr" className="textarea" style={{ minHeight: 80 }} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fe.rejectionReason ? 'true' : undefined} />
          {fe.rejectionReason && <span className="field-error">{fe.rejectionReason}</span>}
        </div>
      )}
      <div className="field">
        <label htmlFor="sn">Note (optional)</label>
        <span className="hint">Added to the public history, e.g. “Crew scheduled for Friday”.</span>
        <textarea id="sn" className="textarea" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className={`btn btn-block${status === 'rejected' ? ' btn-danger' : ''}`} disabled={busy || status === c.status}>
        {busy ? 'Saving…' : status === c.status ? 'Choose a new status' : `Change to ${STATUS_LABEL[status]}`}
      </button>
    </form>
  );
}

function TriageForm({ c, categories, onSaved }) {
  const toast = useToast();
  const [priority, setPriority] = useState(c.priority);
  const [categoryId, setCategoryId] = useState(String(c.category.id));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const changed = priority !== c.priority || categoryId !== String(c.category.id);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {};
      if (priority !== c.priority) body.priority = priority;
      if (categoryId !== String(c.category.id)) body.categoryId = Number(categoryId);
      const d = await api(`/admin/complaints/${c.id}`, { method: 'PATCH', body });
      onSaved(d.complaint);
      toast('Priority and category saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>Priority and category</h3>
      {error && <p className="field-error">{error}</p>}
      <div className="field">
        <label htmlFor="pr">Priority</label>
        <select id="pr" className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cat">Category</label>
        <select id="cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-secondary btn-block" disabled={busy || !changed}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function AssignForm({ c, departments, onSaved }) {
  const toast = useToast();
  const [dep, setDep] = useState(String(c.department?.id ?? ''));
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api(`/admin/complaints/${c.id}/assign`, { method: 'POST', body: { departmentId: Number(dep), note: note || undefined } });
      setNote('');
      onSaved(d.complaint);
      toast(`Assigned to ${d.complaint.department.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>Department</h3>
      {error && <p className="field-error">{error}</p>}
      <div className="field">
        <label htmlFor="dep">Assigned to</label>
        <select id="dep" className="select" value={dep} onChange={(e) => setDep(e.target.value)}>
          {!c.department && <option value="">Choose a department</option>}
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.id === c.department?.id ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="an">Note (optional)</label>
        <input id="an" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="btn btn-secondary btn-block" disabled={busy || !dep || dep === String(c.department?.id ?? '')}>
        {busy ? 'Assigning…' : 'Reassign'}
      </button>
    </form>
  );
}

export default function AdminComplaintDetail() {
  const { id } = useParams();
  const res = useApi(`/admin/complaints/${id}`, {}, [id]);
  const categories = useApi('/admin/categories');
  const departments = useApi('/admin/departments');
  const [c, setC] = useState(null);
  const [rerun, setRerun] = useState(null);
  useEffect(() => setC(res.data?.complaint ?? null), [res.data]);

  if (res.loading && !c) return <Loading />;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!c) return null;

  const pendingDups = c.duplicateSuggestions.filter((s) => s.reviewStatus === 'pending');
  const reviewedDups = c.duplicateSuggestions.filter((s) => s.reviewStatus !== 'pending');

  async function detectAgain() {
    setRerun('Checking…');
    try {
      const d = await api(`/admin/complaints/${c.id}/detect-duplicates`, { method: 'POST' });
      setC({ ...c, duplicateSuggestions: d.suggestions });
      setRerun(d.added ? `Found ${d.added} new possible duplicate${d.added === 1 ? '' : 's'}.` : 'No new possible duplicates found.');
    } catch (e) {
      setRerun(e.message);
    }
  }

  return (
    <>
      <Link to="/admin/complaints" className="back">
        Back to complaints
      </Link>
      <div className="two-col">
        <article>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <StatusBadge status={c.status} />
            <PriorityTag priority={c.priority} />
            <span className="tag">{c.category.name}</span>
            {c.duplicateOf && (
              <span className="tag">
                Duplicate of <Link to={`/admin/complaints/${c.duplicateOf.id}`}>{c.duplicateOf.trackingId}</Link>
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 'var(--step-3)' }}>{c.title}</h1>

          {pendingDups.length > 0 && (
            <section aria-labelledby="dups-h" style={{ marginBottom: 20 }}>
              <h2 id="dups-h" style={{ fontSize: 'var(--step-1)' }}>
                Possible duplicate{pendingDups.length === 1 ? '' : 's'} found by CivicFix
              </h2>
              {pendingDups.map((s) => (
                <DuplicateCard key={s.id} s={s} onReviewed={() => res.reload()} />
              ))}
            </section>
          )}

          <div className="grid-2" style={{ marginBottom: 20 }}>
            {c.imageUrl ? (
              <img src={c.imageUrl} alt={`Photo of: ${c.title}`} className="detail-photo" style={{ margin: 0, height: 260 }} />
            ) : (
              <div className="empty" style={{ padding: 20, display: 'grid', placeItems: 'center' }}>
                <p style={{ margin: 0 }}>No photo attached</p>
              </div>
            )}
            <ComplaintMap markers={[c]} className="map small" center={[c.latitude, c.longitude]} zoom={16} linkFor={(m) => `/admin/complaints/${m.id}`} />
          </div>

          <section className="panel">
            <h2>Description</h2>
            <p className="description">{c.description}</p>
            <dl className="detail-meta">
              <dt>Landmark</dt>
              <dd>{c.landmark ?? '—'}</dd>
              <dt>Coordinates</dt>
              <dd>
                {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
              </dd>
              <dt>Filed</dt>
              <dd>{formatDateTime(c.createdAt)}</dd>
              <dt>Last update</dt>
              <dd>{formatDateTime(c.updatedAt)}</dd>
            </dl>
          </section>

          <section className="panel">
            <h2>Progress</h2>
            <StatusRoad status={c.status} history={c.statusHistory} />
            {c.rejectionReason && (
              <div className="reason">
                <strong>Rejection reason:</strong> {c.rejectionReason}
              </div>
            )}
            <HistoryList history={c.statusHistory} />
          </section>

          <section className="panel">
            <h2>Department history</h2>
            <ol className="history">
              {c.assignments.map((a) => (
                <li key={a.id}>
                  <strong>{a.department.name}</strong>
                  {a.isCurrent && <span className="tag" style={{ marginLeft: 8 }}>Current</span>}
                  <div className="when">
                    {formatDateTime(a.at)} by {a.assignedBy}
                  </div>
                  {a.note && <p className="note">{a.note}</p>}
                </li>
              ))}
            </ol>
            {!c.assignments.length && <p className="muted">Not assigned to a department yet.</p>}
          </section>

          <section className="panel">
            <div className="section-head">
              <h2 style={{ margin: 0 }}>Duplicate check</h2>
              <button type="button" className="btn btn-secondary btn-small" onClick={detectAgain}>
                Check again
              </button>
            </div>
            {rerun && <p className="small" role="status">{rerun}</p>}
            {reviewedDups.map((s) => (
              <DuplicateCard key={s.id} s={s} />
            ))}
            {!c.duplicateSuggestions.length && <p className="small muted">No similar reports nearby.</p>}
          </section>
        </article>

        <aside style={{ position: 'sticky', top: 84 }}>
          <Ticket complaint={c} compact />
          <div className="panel" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: '1rem', fontStretch: '112%' }}>Reporter</h3>
            <p style={{ margin: 0 }}>
              {c.reporter.name}
              <br />
              <a href={`mailto:${c.reporter.email}?subject=${encodeURIComponent(`Your CivicFix report ${c.trackingId}`)}`}>{c.reporter.email}</a>
              {c.reporter.phone && (
                <>
                  <br />
                  <a href={`tel:${c.reporter.phone}`}>{c.reporter.phone}</a>
                </>
              )}
            </p>
          </div>
          <div className="panel action-panel" style={{ marginTop: 16 }}>
            <StatusForm c={c} onSaved={setC} />
            {categories.data && <TriageForm key={`${c.priority}-${c.category.id}`} c={c} categories={categories.data.items} onSaved={setC} />}
            {departments.data && <AssignForm key={c.department?.id ?? 'none'} c={c} departments={departments.data.items} onSaved={setC} />}
          </div>
        </aside>
      </div>
    </>
  );
}
