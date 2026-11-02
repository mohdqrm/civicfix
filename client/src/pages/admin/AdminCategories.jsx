// Manage complaint categories (FR13): add, rename, set default department, deactivate.
// Categories are never deleted, so old complaints keep their category.
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { ErrorState, Field, FormError, Loading, useToast } from '../../components/ui.jsx';

function CategoryRow({ c, departments, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(c.name);
  const [dep, setDep] = useState(String(c.defaultDepartment?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = name !== c.name || dep !== String(c.defaultDepartment?.id ?? '');

  async function save(body, msg) {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/categories/${c.id}`, { method: 'PATCH', body });
      toast(msg);
      onSaved();
    } catch (e) {
      setError(e.details?.[0]?.message ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr style={{ opacity: c.isActive ? 1 : 0.65 }}>
      <td>
        <label className="sr-only" htmlFor={`n${c.id}`}>
          Name
        </label>
        <input id={`n${c.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 180 }} />
        <div className="small muted">{c.slug}</div>
        {error && <div className="field-error">{error}</div>}
      </td>
      <td>
        <label className="sr-only" htmlFor={`d${c.id}`}>
          Default department
        </label>
        <select id={`d${c.id}`} className="select" value={dep} onChange={(e) => setDep(e.target.value)}>
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ textAlign: 'right' }}>{c.complaintCount}</td>
      <td>{c.isActive ? 'Active' : 'Inactive'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="btn btn-small"
          disabled={!dirty || busy}
          onClick={() => save({ name, defaultDepartmentId: dep ? Number(dep) : null }, `Saved ${name}`)}
        >
          Save
        </button>{' '}
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={busy}
          onClick={() => save({ isActive: !c.isActive }, c.isActive ? `${c.name} hidden from the report form` : `${c.name} is available again`)}
        >
          {c.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      </td>
    </tr>
  );
}

export default function AdminCategories() {
  const toast = useToast();
  const cats = useApi('/admin/categories');
  const deps = useApi('/admin/departments');
  const [form, setForm] = useState({ name: '', slug: '', defaultDepartmentId: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = error?.fieldErrors ?? {};
  const autoSlug = (n) => n.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

  async function create(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/admin/categories', {
        method: 'POST',
        body: { name: form.name, slug: form.slug, defaultDepartmentId: form.defaultDepartmentId ? Number(form.defaultDepartmentId) : undefined },
      });
      toast(`Added ${form.name}`);
      setForm({ name: '', slug: '', defaultDepartmentId: '' });
      cats.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if ((cats.loading && !cats.data) || (deps.loading && !deps.data)) return <Loading />;
  if (cats.error || deps.error) return <ErrorState error={cats.error ?? deps.error} onRetry={() => (cats.reload(), deps.reload())} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p className="muted">New reports are sent to the category’s default department. Deactivated categories disappear from the report form.</p>
        </div>
      </div>
      <div className="two-col">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Default department</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Reports
                </th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cats.data.items.map((c) => (
                <CategoryRow key={`${c.id}-${c.name}-${c.isActive}-${c.defaultDepartment?.id}`} c={c} departments={deps.data.items} onSaved={cats.reload} />
              ))}
            </tbody>
          </table>
        </div>
        <form className="panel" onSubmit={create} noValidate>
          <h2>Add a category</h2>
          <FormError error={error} />
          <Field label="Name" error={fe.name}>
            {(p) => (
              <input
                {...p}
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Short code" hint="Used in links; lowercase letters, numbers and hyphens." error={fe.slug}>
            {(p) => <input {...p} className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />}
          </Field>
          <Field label="Default department" error={fe.defaultDepartmentId}>
            {(p) => (
              <select {...p} className="select" value={form.defaultDepartmentId} onChange={(e) => setForm({ ...form, defaultDepartmentId: e.target.value })}>
                <option value="">None</option>
                {deps.data.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button className="btn btn-block" disabled={busy || !form.name}>
            {busy ? 'Adding…' : 'Add category'}
          </button>
        </form>
      </div>
    </>
  );
}
