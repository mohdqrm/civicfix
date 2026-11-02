// Report an issue: category → details → location → photo → submit.
// While the citizen fills it in, we ask the server for similar reports nearby
// (POST /api/complaints/similar) so they can see if it's already been reported.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { formatDistance } from '../lib/format.js';
import { LocationPicker, getCurrentPosition } from '../components/MapView.jsx';
import { Field, FormError, StatusBadge, Ticket, Loading, ErrorState } from '../components/ui.jsx';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateReport(f) {
  const e = {};
  if (!f.categoryId) e.categoryId = 'Choose what kind of problem this is';
  if (f.title.trim().length < 5) e.title = 'Give it a short title (at least 5 characters)';
  else if (f.title.trim().length > 120) e.title = 'Keep the title under 120 characters';
  if (f.description.trim().length < 10) e.description = 'Describe the problem in at least 10 characters';
  else if (f.description.trim().length > 2000) e.description = 'Keep the description under 2000 characters';
  if (!f.location) e.location = 'Mark where the problem is on the map';
  if (!f.photo) e.photo = 'Add a photo of the problem';
  else if (!TYPES.includes(f.photo.type)) e.photo = 'Use a JPEG, PNG or WebP photo';
  else if (f.photo.size > MAX_BYTES) e.photo = 'That photo is over 5 MB. Choose a smaller one.';
  return e;
}

export default function Report() {
  const categories = useApi('/categories');
  const [f, setF] = useState({ categoryId: '', title: '', description: '', landmark: '', location: null, photo: null });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [preview, setPreview] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [geo, setGeo] = useState({ busy: false, msg: null });
  const [similar, setSimilar] = useState([]);
  const fileRef = useRef(null);
  const set = (k, v) => setF((cur) => ({ ...cur, [k]: v }));

  useEffect(() => {
    if (!f.photo) return setPreview(null);
    const url = URL.createObjectURL(f.photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [f.photo]);

  // Similar-report check, debounced so we don't call the server on every keystroke.
  useEffect(() => {
    if (!f.categoryId || !f.location || f.title.trim().length < 5 || f.description.trim().length < 10) return setSimilar([]);
    const t = setTimeout(() => {
      api('/complaints/similar', {
        method: 'POST',
        body: {
          categoryId: Number(f.categoryId),
          title: f.title,
          description: f.description,
          latitude: +f.location.lat.toFixed(6),
          longitude: +f.location.lng.toFixed(6),
        },
      })
        .then((d) => setSimilar(d.items))
        .catch(() => setSimilar([]));
    }, 700);
    return () => clearTimeout(t);
  }, [f.categoryId, f.title, f.description, f.location]);

  async function useMyLocation() {
    setGeo({ busy: true, msg: null });
    try {
      const p = await getCurrentPosition();
      set('location', p);
      setFlyTo(p);
      setGeo({ busy: false, msg: null });
    } catch (e) {
      setGeo({ busy: false, msg: e.message });
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setServerError(null);
    const v = validateReport(f);
    setErrors(v);
    if (Object.keys(v).length) {
      document.querySelector('[aria-invalid="true"], .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const body = new FormData();
    body.set('categoryId', f.categoryId);
    body.set('title', f.title.trim());
    body.set('description', f.description.trim());
    body.set('latitude', f.location.lat.toFixed(6));
    body.set('longitude', f.location.lng.toFixed(6));
    if (f.landmark.trim()) body.set('landmark', f.landmark.trim());
    body.set('photo', f.photo);
    setBusy(true);
    try {
      const d = await api('/complaints', { method: 'POST', body });
      setCreated(d.complaint);
      window.scrollTo(0, 0);
    } catch (err) {
      setServerError(err);
      setErrors(err.fieldErrors ?? {});
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="success-block" style={{ maxWidth: 640 }}>
        <h1>Report submitted</h1>
        <p className="muted">
          Thanks. Your report has been sent to {created.department ? <strong>{created.department.name}</strong> : 'the CivicFix team'}.
          You’ll see an update on your dashboard when its status changes.
        </p>
        <Ticket complaint={created} note={created.title} />
        <div className="hero-actions">
          <Link to={`/issues/${created.id}`} className="btn">
            Track this report
          </Link>
          <Link to="/dashboard" className="btn btn-secondary">
            Go to my reports
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setCreated(null);
              setF({ categoryId: '', title: '', description: '', landmark: '', location: null, photo: null });
              setSimilar([]);
            }}
          >
            Report another issue
          </button>
        </div>
      </div>
    );
  }

  if (categories.loading) return <Loading />;
  if (categories.error) return <ErrorState error={categories.error} onRetry={categories.reload} />;

  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Report an issue</h1>
      <p className="muted">It takes about two minutes. Please don’t include personal details like phone numbers in the description.</p>
      <form className="panel" onSubmit={onSubmit} noValidate>
        <FormError error={serverError} />

        <fieldset className="form-section" style={{ border: 0, margin: 0, padding: 0 }}>
          <h2>
            <span className="n">1</span> What kind of problem is it?
          </h2>
          <legend className="sr-only">Category</legend>
          <div className="category-grid">
            {categories.data.items.map((c) => (
              <label key={c.id} className="category-option" title={c.description ?? undefined}>
                <input type="radio" name="category" value={c.id} checked={String(f.categoryId) === String(c.id)} onChange={() => set('categoryId', String(c.id))} />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
          {errors.categoryId && <p className="field-error" style={{ marginTop: 8 }}>{errors.categoryId}</p>}
        </fieldset>

        <div className="form-section">
          <h2>
            <span className="n">2</span> Describe it
          </h2>
          <Field label="Title" hint="A short summary, like “Deep pothole outside Gate 3”." error={errors.title} counter={<span className="counter">{f.title.length}/120</span>}>
            {(p) => <input {...p} className="input" maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field
            label="Description"
            hint="What’s wrong, how big it is, and since when."
            error={errors.description}
            counter={<span className="counter">{f.description.length}/2000</span>}
          >
            {(p) => <textarea {...p} className="textarea" maxLength={2000} value={f.description} onChange={(e) => set('description', e.target.value)} />}
          </Field>
        </div>

        <div className="form-section">
          <h2>
            <span className="n">3</span> Where is it?
          </h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            Click the map to drop a pin on the problem, then drag it to adjust. Pin the problem itself, not your home.
          </p>
          <div className="location-bar">
            <button type="button" className="btn btn-secondary btn-small" onClick={useMyLocation} disabled={geo.busy}>
              {geo.busy ? 'Finding you…' : 'Use my current location'}
            </button>
            {f.location ? (
              <span>
                Pinned at {f.location.lat.toFixed(5)}, {f.location.lng.toFixed(5)}
              </span>
            ) : (
              <span className="muted">No location yet</span>
            )}
          </div>
          {geo.msg && (
            <div className="alert alert-info" role="status">
              <p>{geo.msg}</p>
            </div>
          )}
          <div aria-label="Map: click to mark the problem location">
            <LocationPicker value={f.location} onChange={(p) => set('location', p)} flyTo={flyTo} />
          </div>
          {errors.location && <p className="field-error" style={{ marginTop: 8 }}>{errors.location}</p>}
          <div style={{ marginTop: 16 }}>
            <Field label="Nearby landmark (optional)" hint="Helps the field team find it, e.g. “Opposite Metro Gate 2”." error={errors.landmark}>
              {(p) => <input {...p} className="input" maxLength={200} value={f.landmark} onChange={(e) => set('landmark', e.target.value)} />}
            </Field>
          </div>
        </div>

        {similar.length > 0 && (
          <div className="similar" role="status">
            <h3>This may already be reported</h3>
            <p className="small" style={{ margin: 0 }}>
              We found {similar.length === 1 ? 'a similar report' : 'similar reports'} nearby. If it’s the same problem, you can follow that one instead.
              You can still submit yours.
            </p>
            <ul>
              {similar.map((s) => (
                <li key={s.id}>
                  <Link to={`/issues/${s.id}`} target="_blank">
                    {s.trackingId}: {s.title}
                  </Link>{' '}
                  <span className="small muted">{formatDistance(s.distanceM)} away</span> <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-section">
          <h2>
            <span className="n">4</span> Add a photo
          </h2>
          <input
            ref={fileRef}
            id="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-invalid={errors.photo ? 'true' : undefined}
            onChange={(e) => {
              set('photo', e.target.files?.[0] ?? null);
              setErrors((x) => ({ ...x, photo: undefined }));
            }}
          />
          {preview ? (
            <div className="photo-preview">
              <img src={preview} alt="Selected photo" />
              <div>
                <p className="small" style={{ margin: 0 }}>
                  {f.photo.name} ({(f.photo.size / 1024 / 1024).toFixed(1)} MB)
                </p>
                <button type="button" className="linklike small" onClick={() => fileRef.current?.click()}>
                  Choose a different photo
                </button>
              </div>
            </div>
          ) : (
            <label htmlFor="photo" className="photo-drop">
              <strong>Choose a photo</strong>
              <span className="small muted">JPEG, PNG or WebP, up to 5 MB. Location data inside the photo is removed when it’s uploaded.</span>
            </label>
          )}
          {errors.photo && <p className="field-error" style={{ marginTop: 8 }}>{errors.photo}</p>}
        </div>

        <div className="form-section">
          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Submitting report…' : 'Submit report'}
          </button>
        </div>
      </form>
    </div>
  );
}
