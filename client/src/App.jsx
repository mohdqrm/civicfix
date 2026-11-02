// Every page of the app and the URL it lives at.
import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout, RequireAuth, SiteLayout } from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Browse from './pages/Browse.jsx';
import IssueDetail from './pages/IssueDetail.jsx';
import MapPage from './pages/MapPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Report from './pages/Report.jsx';
import Profile from './pages/Profile.jsx';
import AdminLogin from './pages/admin/AdminLogin.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminComplaints from './pages/admin/AdminComplaints.jsx';
import AdminComplaintDetail from './pages/admin/AdminComplaintDetail.jsx';
import AdminDuplicates from './pages/admin/AdminDuplicates.jsx';
import AdminCategories from './pages/admin/AdminCategories.jsx';
import { Empty } from './components/ui.jsx';

const TITLES = [
  [/^\/$/, 'Report and track civic issues'],
  [/^\/issues\/\d+/, 'Issue details'],
  [/^\/issues/, 'Browse issues'],
  [/^\/map/, 'Issue map'],
  [/^\/report/, 'Report an issue'],
  [/^\/dashboard/, 'My reports'],
  [/^\/profile/, 'Profile'],
  [/^\/login/, 'Log in'],
  [/^\/register/, 'Sign up'],
  [/^\/admin\/login/, 'Admin log in'],
  [/^\/admin\/complaints\/\d+/, 'Admin: complaint'],
  [/^\/admin\/complaints/, 'Admin: complaints'],
  [/^\/admin\/duplicates/, 'Admin: possible duplicates'],
  [/^\/admin\/categories/, 'Admin: categories'],
  [/^\/admin/, 'Admin dashboard'],
];

function useTitleAndScroll() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} | CivicFix` : 'CivicFix';
    window.scrollTo(0, 0);
  }, [pathname]);
}

export default function App() {
  useTitleAndScroll();
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <RequireAuth role="admin">
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="complaints" element={<AdminComplaints />} />
        <Route path="complaints/:id" element={<AdminComplaintDetail />} />
        <Route path="duplicates" element={<AdminDuplicates />} />
        <Route path="categories" element={<AdminCategories />} />
      </Route>

      <Route element={<SiteLayout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="issues" element={<Browse />} />
        <Route path="issues/:id" element={<IssueDetail />} />
        <Route path="map" element={<MapPage />} />
        <Route
          path="report"
          element={
            <RequireAuth role="citizen">
              <Report />
            </RequireAuth>
          }
        />
        <Route
          path="dashboard"
          element={
            <RequireAuth role="citizen">
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />
        <Route
          path="*"
          element={
            <Empty title="This page doesn’t exist" action={<Link to="/" className="btn">Go to the home page</Link>}>
              The link may be old or mistyped.
            </Empty>
          }
        />
      </Route>
    </Routes>
  );
}
