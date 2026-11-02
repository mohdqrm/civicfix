// Full-screen map of every reported issue, with status/category filters and "near me".
import { useState } from 'react';
import { useApi } from '../lib/useApi.js';
import { STATUSES } from '../lib/format.js';
import { ComplaintMap, MapLegend, getCurrentPosition } from '../components/MapView.jsx';
import { ErrorState } from '../components/ui.jsx';

export default function MapPage() {
  const [statuses, setStatuses] = useState([]);
  const [category, setCategory] = useState('');
  const [near, setNear] = useState(null);
  const [geoMsg, setGeoMsg] = useState(null);
  const categories = useApi('/categories');
  const query = {
    status: statuses.join(','),
    category,
    ...(near ? { lat: near.lat.toFixed(6), lng: near.lng.toFixed(6), radius: near.radius } : {}),
  };
  const map = useApi('/complaints/map', { query }, [JSON.stringify(query)]);
  const toggle = (s) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function findMe() {
    setGeoMsg(null);
    try {
      const p = await getCurrentPosition();
      setNear({ ...p, radius: 2000 });
    } catch (e) {
      setGeoMsg(e.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Issue map</h1>
          <p className="muted">Each pin is one report, coloured by status. Select a pin for details.</p>
        </div>
        {near ? (
          <button type="button" className="btn btn-secondary" onClick={() => setNear(null)}>
            Show all areas
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={findMe}>
            Issues near me
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 14 }}>
        <div className="chips" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button key={s.value} type="button" className="chip" aria-pressed={statuses.includes(s.value)} onClick={() => toggle(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="map-cat">
          Category
        </label>
        <select id="map-cat" className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.data?.items.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="small muted" aria-live="polite">
          {map.data && `${map.data.items.length} shown${near ? ' within 2 km' : ''}`}
        </span>
      </div>
      {geoMsg && (
        <div className="alert alert-info" role="status">
          <p>{geoMsg}</p>
        </div>
      )}
      {map.error && <ErrorState error={map.error} onRetry={map.reload} />}
      <ComplaintMap markers={map.data?.items ?? []} className="map tall" nearMe={near} />
      <MapLegend />
    </>
  );
}
