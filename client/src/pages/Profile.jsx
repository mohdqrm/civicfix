// Profile: edit name and phone, and see the full complaint history.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/useApi.js';
import { formatDate } from '../lib/format.js';
import { ComplaintRows, RowsSkeleton } from '../components/ComplaintRows.jsx';
import { Empty, ErrorState, Field, FormError, Pagination, useToast } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, phone: user.phone ?? '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const history = useApi(user.role === 'citizen' ? '/me/complaints' : null, { query: { page, limit: 10, sort: 'newest' } }, [page]);
  const fe = error?.fieldErrors ?? {};
  const changed = form.name !== user.name || form.phone !== (user.phone ?? '');

  async function onSave(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const d = await api('/me', { method: 'PATCH', body: { name: form.name, phone: form.phone.trim() ? form.phone : null } });
      setUser(d.user);
      toast('Profile saved');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p className="muted">
            {user.email}, member since {formatDate(user.createdAt)}
          </p>
        </div>
      </div>
      <div className="two-col sidebar-left">
        <form className="panel" onSubmit={onSave} noValidate>
          <h2>Your details</h2>
          <FormError error={error} />
          <Field label="Full name" error={fe.name}>
            {(p) => <input {...p} className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Phone (optional)" hint="Visible only to the CivicFix team." error={fe.phone}>
            {(p) => <input {...p} className="input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          </Field>
          <Field label="Email" hint="Email can’t be changed.">
            {(p) => <input {...p} className="input" value={user.email} readOnly disabled />}
          </Field>
          <button className="btn" disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        {user.role === 'citizen' ? (
          <section aria-labelledby="hist-h">
            <div className="section-head">
              <h2 id="hist-h">Complaint history</h2>
              {history.data && <span className="small muted">{history.data.total} in total</span>}
            </div>
            {history.loading && !history.data && <RowsSkeleton />}
            {history.error && <ErrorState error={history.error} onRetry={history.reload} />}
            {history.data &&
              (history.data.items.length ? (
                <>
                  <ComplaintRows items={history.data.items} showMine={false} />
                  <Pagination page={history.data.page} totalPages={history.data.totalPages} onPage={setPage} />
                </>
              ) : (
                <Empty title="No reports yet" action={<Link to="/report" className="btn">Report an issue</Link>} />
              ))}
          </section>
        ) : (
          <div className="panel">
            <p style={{ margin: 0 }}>
              You’re signed in as an administrator. <Link to="/admin">Go to the admin dashboard</Link>.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
