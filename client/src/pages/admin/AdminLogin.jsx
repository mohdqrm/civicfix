// Separate entry point for staff. Citizens who log in here are signed straight
// back out; the server enforces admin-only access on every /api/admin request anyway.
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { Field } from '../../components/ui.jsx';

export default function AdminLogin() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user?.role === 'admin') return <Navigate to="/admin" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await login(form.email, form.password);
      if (u.role !== 'admin') {
        await logout();
        setError('This account isn’t an administrator. Citizens can log in on the main site.');
        return;
      }
      navigate(location.state?.from?.startsWith('/admin') ? location.state.from : '/admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', display: 'grid', placeItems: 'center', padding: 'var(--gutter)' }}>
      <main id="main" style={{ width: '100%', maxWidth: 420, padding: 0, minHeight: 0 }}>
        <p style={{ color: '#fff', fontFamily: 'var(--font-display)', fontStretch: '125%', fontWeight: 800, fontSize: '1.3rem', marginBottom: 20 }}>
          CivicFix <span className="nav-tag">Admin</span>
        </p>
        <form className="panel" onSubmit={onSubmit} noValidate>
          <h1 style={{ fontSize: 'var(--step-2)' }}>Staff log in</h1>
          {error && (
            <div className="alert alert-error" role="alert">
              <p>{error}</p>
            </div>
          )}
          <Field label="Email">
            {(p) => <input {...p} className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
          <Field label="Password">
            {(p) => (
              <input {...p} className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            )}
          </Field>
          <button className="btn btn-block" disabled={busy || !form.email || !form.password}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p style={{ marginTop: 16 }}>
          <Link to="/" style={{ color: '#d6e2de' }}>
            Back to the public site
          </Link>
        </p>
      </main>
    </div>
  );
}
