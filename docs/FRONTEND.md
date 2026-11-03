# CivicFix Frontend: How It Works (Step 2)

React 19 + Vite + React Router + Leaflet, with plain CSS and no UI framework. Every page talks to the real Express API described in [API.md](API.md); there is no hard-coded sample data in the frontend. Screenshots are in [`screenshots/`](screenshots/).

## Running it

```bash
# Development: two terminals, hot reload
npm run dev:server        # API on http://localhost:4000
npm run dev:client        # React on http://localhost:5173 (forwards /api and /uploads to :4000)

# Production-style: one server, one origin
npm run build             # builds client/dist
npm start                 # Express serves the API *and* the built React app on :4000
```

## Pages

| # | Page | URL | Who |
|---|---|---|---|
| 1 | Landing: live map of open issues, how it works, recent reports | `/` | everyone |
| 2 | Sign up / Log in | `/register`, `/login` | everyone |
| 3 | Citizen dashboard: counts by status (click to filter), my reports, updates | `/dashboard` | citizen |
| 4 | Report an issue: category, details, map pin or GPS, photo, similar-report warning | `/report` | citizen |
| 5 | Browse issues: search, status, category, near me, pagination (filters live in the URL) | `/issues` | everyone |
| 6 | Issue details: photo, status road, history, rejection reason, ticket, map | `/issues/:id` | everyone |
| 7 | Interactive map: status-coloured pins, status and category filters, issues near me | `/map` | everyone |
| 8 | Admin log in (citizens are refused) | `/admin/login` | staff |
| 9 | Admin dashboard: live stats, 30-day trend, by category/department, new queue | `/admin` | admin |
| 10 | Complaint management: table with 8 filters + area-on-map; detail page with status, priority, category, department, duplicate review | `/admin/complaints`, `/admin/complaints/:id` | admin |
| 11 | Profile and complaint history | `/profile` | logged in |
| + | Possible-duplicates review queue | `/admin/duplicates` | admin |
| + | Category management | `/admin/categories` | admin |

Every page has loading, empty and error states. All forms validate in the browser *and* on the server, and errors appear under the field they belong to.

## How the frontend, backend and database talk

```
Browser (React)                Express API                     PostgreSQL
───────────────                ───────────                     ──────────
fetch('/api/complaints',   →   validate → requireRole       →  INSERT complaints,
  { credentials:'include',     → sharp re-encodes photo         status_history,
    body: FormData })          → transaction                    assignments
                           ←   201 { complaint: {trackingId} } ←
```

- **`src/lib/api.js`**: the only place that calls `fetch`. It sends the login cookie (`credentials: 'include'`) and turns server errors into an `ApiError` with per-field messages.
- **`src/lib/auth.jsx`**: on page load it asks `GET /api/auth/session` who is logged in and shares the answer with every page. Hiding admin links is only convenience; the server checks the role on every request.
- **`src/lib/useApi.js`**: "load this when the page opens", with loading/error state and cancellation of stale requests.
- In development, Vite forwards `/api` and `/uploads` to port 4000. The browser only ever sees one origin, so the httpOnly cookie works the same way it does in production.

## Design

- **Palette:** municipal signboard green (`#1F5E4E`), road-marking yellow (`#F2B705`), slate ink, cool paper white. The five status colours are used consistently on badges, pins, legends and stats.
- **Type:** *Archivo* at an expanded width for headings, a nod to road signage, and *Public Sans* (a typeface made for government services) for text. Both are self-hosted, with no external font requests.
- **Signature elements:** the tracking ID shown as a perforated **ticket stub**, and progress drawn as a **road** with lane markings. Everything else is deliberately quiet.
- **Accessibility:** a skip link, visible keyboard focus, labels tied to inputs with hints and errors via `aria-describedby`, `aria-invalid`, `aria-current` on the status road, live regions for result counts and toasts, and reduced-motion respected.
- **Responsive:** from 360 px phones up; the nav collapses into a Menu button.

Key files: `src/styles.css` (all design tokens and styles), `components/` (ui, StatusRoad, ComplaintRows, MapView, DuplicateCard, Layout), `pages/` and `pages/admin/`.

## Tests: what was actually run (2 Nov 2026)

| Suite | Tool | Result |
|---|---|---|
| `client/src/test/components.test.jsx`: form validation rules, status road states, history, badge, ticket, pagination, field accessibility, complaint rows | Vitest + Testing Library | ✅ 15/15 |
| `e2e/journey.spec.js`: the full journey from the brief, steps 1–11 (register → log out/in → report pothole with photo → saved in DB → on dashboard → on public map without reporter identity → admin logs in → opens it → changes status → citizen sees new status + notification), **plus** empty-form and disguised-file failures and citizen-tries-admin (redirected, API 403, admin login refused) | Playwright, Chrome 153, desktop 1366×900 | ✅ 7/7 |
| `e2e/responsive.spec.js`: no horizontal scroll on 7 pages, mobile menu works | Playwright, Pixel 7 viewport | ✅ 8/8 |
| Backend (unchanged suites + new checks) | Vitest + Supertest, node:test | ✅ 67/67 + 8/8 |

The browser suite was run three times in a row with no failures after the fixes below. Zero browser console errors were seen across all pages.

Run them: `npm test` (server + client unit tests); `npm run test:e2e` (builds, starts the server if needed, runs Chrome). Set `PW_CHROME=/path/to/chrome` to use an installed Chrome, or run `npx playwright install chromium` once.

### Bugs found while testing in the browser

| Found by | Problem | Fix |
|---|---|---|
| Screenshot review | Tracking ID wrapped onto two lines inside the ticket | Narrower stub, `nowrap` on the ID |
| Screenshot review | First stop on the status road was centred, not at the start | The CSS selector matched the progress bar instead of the first stop; stops now get explicit position classes |
| Screenshot review | Sample reports with no photo showed a stray icon on the details page | The photo block is only rendered when there is a photo |
| Console check | Every logged-out page load logged a 401 error | New `GET /api/auth/session` returns `{ user: null }` with 200 |
| E2E step 10 | UI said "In progress", notifications said "In Progress" | Server labels changed to sentence case to match the UI |
| E2E second run | Login rate limit (20 per 15 min) tripped by repeated test runs | Limits are now configurable (`RATE_LIMIT_AUTH`); the test server raises it, production keeps 20 |
| Backend suite after the build | With the React app present, `/uploads/../.env` and missing photos returned the homepage with status 200 | Only extension-less page URLs get the React app; files are real 404s; missing photos are 404 (new test) |
| Running on a real PC (user report, 3 Nov) | Map showed pins but no streets | helmet's default `Referrer-Policy: no-referrer` stopped the browser sending a Referer, which OpenStreetMap's tile policy requires. The sandbox couldn't reach OSM, so tests never saw it | `strict-origin-when-cross-origin` (sends only the origin), tile URL updated to `tile.openstreetmap.org`; header test added; verified in Chrome that tile requests now carry a Referer |
| E2E (test bugs, not app bugs) | Test clicked before the login redirect finished; repeated runs stacked pins on top of each other | The test waits for the redirect; pin position varies per run |

## Known limitations

- **Map tiles in the screenshots are grey** because this build environment can't reach OpenStreetMap's tile servers.
- **E2E tests write to the development database** (new users and complaints each run), which is why the duplicates screenshot shows several "Gate 4" test reports. Step 10 will produce clean demo screenshots from a freshly seeded database.
- "Near me" needs the browser's location permission and HTTPS (or localhost); without them, users get a clear message and pick on the map instead.
- No offline support, and no photo compression in the browser. Photos up to 5 MB upload as-is and are shrunk on the server.
