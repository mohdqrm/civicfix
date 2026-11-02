// Public list of all reported issues with search, filters and "near me".
// Filters are kept in the URL (?q=…&status=…) so a filtered view can be shared or bookmarked.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi.js';
import { STATUSES } from '../lib/format.js';
import { ComplaintRows, RowsSkeleton } from '../components/ComplaintRows.jsx';
import { getCurrentPosition } from '../components/MapView.jsx';
import { Empty, ErrorState, Pagination } from '../components/ui.jsx';

export default function Browse() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1);
  const lat = params.get('lat');
  const lng = params.get('lng');
  const [search, setSearch] = useState(q);
  const [geoError, setGeoError] = useState(null);
  const [locating, setLocating] = useState(false);
  useEffect(() => setSearch(q), [q]);

  const categories = useApi('/categories');
  const query = { q, status, category, page, limit: 15, ...(lat ? { lat, lng, radius: 3000, sort: 'distance' } : {}) };
  const list = useApi('/complaints', { query }, [JSON.stringify(query)]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  async function nearMe() {
    setGeoError(null);
    setLocating(true);
    try {
      const p = await getCurrentPosition();
      update({ lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
    } catch (e) {
      setGeoError(e.message);
    } finally {
      setLocating(false);
    }
  }

  const filtered = q || status || category || lat;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Browse issues</h1>
          <p className="muted">Everything citizens have reported, newest first. Reporters’ names are never shown.</p>
        </div>
        <Link to="/map" className="btn btn-secondary">
          View on map
        </Link>
      </div>

      <form
        className="filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search.trim() });
        }}
      >
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" className="input" type="search" placeholder="Title, place or tracking ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" className="select" value={status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" className="select" value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.data?.items.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label" aria-hidden="true">&nbsp;</span>
          {lat ? (
            <button type="button" className="btn btn-secondary" onClick={() => update({ lat: '', lng: '' })}>
              Show everywhere
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={nearMe} disabled={locating}>
              {locating ? 'Finding you…' : 'Near me'}
            </button>
          )}
        </div>
      </form>
      {geoError && (
        <div className="alert alert-info" role="status">
          <p>{geoError}</p>
        </div>
      )}

      {list.data && (
        <div className="result-bar" aria-live="polite">
          <span>
            {list.data.total} {list.data.total === 1 ? 'issue' : 'issues'}
            {lat && ' within 3 km of you, nearest first'}
          </span>
          {filtered && (
            <button type="button" className="linklike small" onClick={() => setParams({})}>
              Clear filters
            </button>
          )}
        </div>
      )}
      {list.loading && !list.data && <RowsSkeleton />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data &&
        (list.data.items.length ? (
          <div style={{ opacity: list.loading ? 0.6 : 1 }}>
            <ComplaintRows items={list.data.items} />
          </div>
        ) : (
          <Empty
            title={filtered ? 'No issues match these filters' : 'No issues reported yet'}
            action={
              filtered ? (
                <button type="button" className="btn btn-secondary" onClick={() => setParams({})}>
                  Clear filters
                </button>
              ) : (
                <Link to="/report" className="btn">
                  Report an issue
                </Link>
              )
            }
          >
            {filtered ? 'Try a different search, or widen the status and category.' : 'Seen something that needs fixing?'}
          </Empty>
        ))}
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={(p) => update({ page: String(p) })} />}
    </>
  );
}
