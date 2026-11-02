// Admin complaint management: search + filters (status, category, priority,
// department, date, area, possible duplicates) over a sortable table.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi.js';
import { PRIORITIES, STATUSES, formatDate } from '../../lib/format.js';
import { LocationPicker } from '../../components/MapView.jsx';
import { Empty, ErrorState, Loading, Pagination, PriorityTag, StatusBadge } from '../../components/ui.jsx';

const FILTER_KEYS = ['q', 'status', 'category', 'priority', 'departmentId', 'from', 'to', 'hasDuplicates', 'lat', 'lng', 'radius', 'sort'];

export default function AdminComplaints() {
  const [params, setParams] = useSearchParams();
  const get = (k) => params.get(k) ?? '';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(get('q'));
  const [areaOpen, setAreaOpen] = useState(false);
  useEffect(() => setSearch(get('q')), [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useApi('/admin/categories');
  const departments = useApi('/admin/departments');
  const query = Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)]));
  query.page = page;
  query.limit = 20;
  if (query.to) query.to = `${query.to}T23:59:59`;
  const list = useApi('/admin/complaints', { query }, [params.toString()]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const anyFilter = FILTER_KEYS.some((k) => k !== 'sort' && get(k));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Complaints</h1>
          <p className="muted">Search, filter and open a complaint to update it.</p>
        </div>
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
          <label htmlFor="aq">Search</label>
          <input id="aq" type="search" className="input" placeholder="Title, description, landmark or CF-ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="as">Status</label>
          <select id="as" className="select" value={get('status')} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All</option>
            <option value="submitted,under_review">Pending (submitted + under review)</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ac">Category</label>
          <select id="ac" className="select" value={get('category')} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All</option>
            {categories.data?.items.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
                {c.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ap">Priority</label>
          <select id="ap" className="select" value={get('priority')} onChange={(e) => update({ priority: e.target.value })}>
            <option value="">All</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ad">Department</label>
          <select id="ad" className="select" value={get('departmentId')} onChange={(e) => update({ departmentId: e.target.value })}>
            <option value="">All</option>
            {departments.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="af">Filed from</label>
          <input id="af" type="date" className="input" value={get('from')} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="at">Filed until</label>
          <input id="at" type="date" className="input" value={get('to')} onChange={(e) => update({ to: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="asort">Sort</label>
          <select id="asort" className="select" value={get('sort') || 'newest'} onChange={(e) => update({ sort: e.target.value })}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="priority">Highest priority</option>
            <option value="updated">Recently updated</option>
            {get('lat') && <option value="distance">Nearest to area centre</option>}
          </select>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={get('hasDuplicates') === 'true'} onChange={(e) => update({ hasDuplicates: e.target.checked ? 'true' : '' })} />
          Only with possible duplicates
        </label>
        <button type="button" className="btn btn-secondary btn-small" aria-expanded={areaOpen} onClick={() => setAreaOpen((o) => !o)}>
          {get('lat') ? `Area: within ${Number(get('radius') || 2000) / 1000} km` : 'Filter by area'}
        </button>
        {get('lat') && (
          <button type="button" className="linklike small" onClick={() => update({ lat: '', lng: '', radius: '', sort: get('sort') === 'distance' ? '' : get('sort') })}>
            Remove area filter
          </button>
        )}
        {anyFilter && (
          <button type="button" className="linklike small" onClick={() => setParams({})}>
            Clear all filters
          </button>
        )}
      </div>
      {areaOpen && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="small">Click the map to set the centre of the area.</span>
            <label className="small" htmlFor="radius">
              Radius
            </label>
            <select id="radius" className="select" style={{ width: 'auto' }} value={get('radius') || '2000'} onChange={(e) => update({ radius: e.target.value })}>
              {[500, 1000, 2000, 5000, 10000].map((r) => (
                <option key={r} value={r}>
                  {r < 1000 ? `${r} m` : `${r / 1000} km`}
                </option>
              ))}
            </select>
          </div>
          <LocationPicker
            value={get('lat') ? { lat: Number(get('lat')), lng: Number(get('lng')) } : null}
            onChange={(p) => update({ lat: p.lat.toFixed(6), lng: p.lng.toFixed(6), radius: get('radius') || '2000' })}
          />
        </div>
      )}

      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && (
        <>
          <div className="result-bar" aria-live="polite">
            <span>{list.data.total} complaints</span>
          </div>
          {list.data.items.length ? (
            <div className="table-wrap" style={{ opacity: list.loading ? 0.6 : 1 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Complaint</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Department</th>
                    <th scope="col">Reporter</th>
                    <th scope="col">Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c.trackingId}</td>
                      <td className="title-cell">
                        <Link to={`/admin/complaints/${c.id}`}>{c.title}</Link>
                        {c.pendingDuplicates > 0 && <span className="dup-flag" title="Possible duplicate awaiting review">Possible duplicate</span>}
                        <div className="small muted">
                          {c.category.name}
                          {c.distanceM !== undefined && `, ${c.distanceM} m from area centre`}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td>
                        <PriorityTag priority={c.priority} />
                      </td>
                      <td>{c.department?.name ?? <span className="muted">Unassigned</span>}</td>
                      <td>{c.reporter.name}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No complaints match"
              action={
                anyFilter && (
                  <button type="button" className="btn btn-secondary" onClick={() => setParams({})}>
                    Clear all filters
                  </button>
                )
              }
            >
              {anyFilter ? 'Try removing a filter.' : 'Nothing has been reported yet.'}
            </Empty>
          )}
          <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={(p) => update({ page: String(p) })} />
        </>
      )}
    </>
  );
}
