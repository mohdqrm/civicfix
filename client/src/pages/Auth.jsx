// Citizen log in and sign up. Client-side checks mirror the server's rules so
// people see problems instantly; the server still validates everything.
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Field, FormError } from '../components/ui.jsx';

export function validateRegistration({ name, email, password, confirm }) {
  const e = {};
  if (name.trim().length < 2) e.name = 'Enter your name (at least 2 characters)';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email address';
  if (password.length < 8) e.password = 'Use at least 8 characters';
  else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) e.password = 'Include at least one letter and one number';
  if (confirm !== password) e.confirm = 'Passwords don’t match';
  return e;
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(form.email, form.password);
      navigate(user.role === 'admin' ? '/admin' : location.state?.from ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Log in</h1>
      <p className="muted">Log in to report issues and follow your reports.</p>
      <form className="panel" onSubmit={onSubmit} noValidate>
        <FormError error={error} />
        <Field label="Email">
          {(p) => <input {...p} className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password">
          {(p) => (
            <input {...p} className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          )}
        </Field>
        <button className="btn btn-block" disabled={busy || !form.email || !form.password}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        New here? <Link to="/register" state={location.state}>Create an account</Link>
      </p>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setServerError(null);
    const v = validateRegistration(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password, phone: form.phone || undefined });
      navigate(location.state?.from ?? '/dashboard', { replace: true });
    } catch (err) {
      setServerError(err);
      setErrors(err.fieldErrors ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Create an account</h1>
      <p className="muted">You need an account to report issues, so we can tell you when something changes.</p>
      <form className="panel" onSubmit={onSubmit} noValidate>
        <FormError error={serverError} />
        <Field label="Full name" error={errors.name}>
          {(p) => <input {...p} className="input" autoComplete="name" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Phone (optional)" hint="Only the CivicFix team can see this, in case they need to ask about a report." error={errors.phone}>
          {(p) => <input {...p} className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />}
        </Field>
        <Field label="Password" hint="At least 8 characters, with a letter and a number." error={errors.password}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
        </Field>
        <button className="btn btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login" state={location.state}>Log in</Link>
      </p>
    </div>
  );
}
