import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { Loading } from './ui.jsx';

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="rgba(255,255,255,0.12)" />
      <path d="M9 23 L16 7 L23 23" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      <path d="M16 12v3M16 18v3" stroke="#F2B705" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function useUnreadCount(user) {
  const [n, setN] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!user || user.role !== 'citizen') return setN(0);
    api('/me/notifications', { query: { unread: 'true', limit: 1 } })
      .then((d) => setN(d.unreadCount))
      .catch(() => {});
  }, [user, pathname]);
  return n;
}

export function SiteLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount(user);
  useEffect(() => setOpen(false), [pathname]);
  const isAdmin = user?.role === 'admin';

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`nav${open ? ' open' : ''}`}>
        <div className="container nav-inner">
          <Link to="/" className="brand">
            <BrandMark />
            CivicFix
          </Link>
          <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
            Menu
          </button>
          <nav className="nav-links" id="main-nav" aria-label="Main">
            <NavLink to="/issues">Browse issues</NavLink>
            <NavLink to="/map">Map</NavLink>
            {user && !isAdmin && (
              <>
                <NavLink to="/dashboard">
                  My reports
                  {unread > 0 && (
                    <span className="nav-badge" aria-label={`${unread} unread updates`}>
                      {unread}
                    </span>
                  )}
                </NavLink>
                <NavLink to="/profile">Profile</NavLink>
              </>
            )}
            {isAdmin && <NavLink to="/admin">Admin dashboard</NavLink>}
            {user ? (
              <button
                type="button"
                className="linklike"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                Log out
              </button>
            ) : (
              <>
                <NavLink to="/login">Log in</NavLink>
                <NavLink to="/register">Sign up</NavLink>
              </>
            )}
            {!isAdmin && (
              <Link to="/report" className="btn btn-small btn-report">
                Report an issue
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`nav admin${open ? ' open' : ''}`}>
        <div className="container nav-inner">
          <Link to="/admin" className="brand">
            <BrandMark />
            CivicFix <span className="nav-tag">Admin</span>
          </Link>
          <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((o) => !o)}>
            Menu
          </button>
          <nav className="nav-links" id="admin-nav" aria-label="Admin">
            <NavLink to="/admin" end>
              Dashboard
            </NavLink>
            <NavLink to="/admin/complaints">Complaints</NavLink>
            <NavLink to="/admin/duplicates">Possible duplicates</NavLink>
            <NavLink to="/admin/categories">Categories</NavLink>
            <NavLink to="/map">Public map</NavLink>
            <button
              type="button"
              className="linklike"
              onClick={async () => {
                await logout();
                navigate('/admin/login');
              }}
            >
              Log out {user?.name ? `(${user.name})` : ''}
            </button>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="container">
          <Outlet />
        </div>
      </main>
    </>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <p>
          CivicFix is an independent student project. It is not run by, or officially connected to, any municipal body or government
          department. In an emergency, call 112.
        </p>
      </div>
    </footer>
  );
}

/** Pages that need a logged-in citizen (or admin when role="admin"). */
export function RequireAuth({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} replace state={{ from: location.pathname + location.search }} />;
  }
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  }
  return children;
}
