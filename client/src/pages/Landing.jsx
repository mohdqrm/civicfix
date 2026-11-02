import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/useApi.js';
import { ComplaintMap } from '../components/MapView.jsx';
import { ComplaintRows, RowsSkeleton } from '../components/ComplaintRows.jsx';
import { Empty, ErrorState } from '../components/ui.jsx';

export default function Landing() {
  const { user } = useAuth();
  const markers = useApi('/complaints/map');
  const recent = useApi('/complaints', { query: { limit: 5 } });
  const open = markers.data?.items.filter((m) => !['resolved', 'rejected'].includes(m.status)).length;

  return (
    <>
      <section className="hero">
        <div>
          <h1>Spotted a pothole? Put it on the map.</h1>
          <p className="hero-lede">
            Report broken streetlights, overflowing bins and leaking pipes with a photo and a pin. Then follow your report until it’s fixed.
          </p>
          <div className="hero-actions">
            {user?.role === 'admin' ? (
              <Link to="/admin" className="btn">
                Open the admin dashboard
              </Link>
            ) : (
              <Link to="/report" className="btn">
                Report an issue
              </Link>
            )}
            <Link to="/map" className="btn btn-secondary">
              See issues near you
            </Link>
          </div>
        </div>
        <div className="hero-map">
          <ComplaintMap markers={markers.data?.items ?? []} />
          {markers.data && (
            <div className="hero-map-caption">
              <strong>{open}</strong> open {open === 1 ? 'issue' : 'issues'} on the map right now
            </div>
          )}
        </div>
      </section>

      <ol className="how" aria-label="How it works">
        <li>
          <span className="how-step" aria-hidden="true">1</span>
          <h3>Pin it</h3>
          <p>Choose a category, add a photo and mark the exact spot. We’ll show you if someone has already reported it.</p>
        </li>
        <li>
          <span className="how-step" aria-hidden="true">2</span>
          <h3>Get a tracking ID</h3>
          <p>Your report is routed to the right department, and you get an ID like <span style={{ whiteSpace: 'nowrap' }}>CF-000042</span> to follow it.</p>
        </li>
        <li>
          <span className="how-step" aria-hidden="true">3</span>
          <h3>Watch it move</h3>
          <p>Every status change is recorded and you’re notified. If a report is rejected, the reason is shown publicly.</p>
        </li>
      </ol>

      <section aria-labelledby="recent-heading">
        <div className="section-head">
          <h2 id="recent-heading">Recently reported</h2>
          <Link to="/issues">Browse all issues</Link>
        </div>
        {recent.loading && !recent.data && <RowsSkeleton n={3} />}
        {recent.error && <ErrorState error={recent.error} onRetry={recent.reload} />}
        {recent.data &&
          (recent.data.items.length ? (
            <ComplaintRows items={recent.data.items} />
          ) : (
            <Empty title="Nothing reported yet" action={<Link className="btn" to="/report">Report the first issue</Link>}>
              Be the first to put a problem on the map.
            </Empty>
          ))}
      </section>
    </>
  );
}
