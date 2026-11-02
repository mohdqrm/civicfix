# CivicFix Backend: How It Works (Steps 3–5)

This document explains the Express API so you can understand, demo and defend it. The endpoint reference is in [API.md](API.md).

## Running it locally

```bash
# 1. PostgreSQL 16 running locally, with two databases:
createdb civicfix && createdb civicfix_test

# 2. Install and configure
npm install                       # from the repo root (installs server workspace)
cp server/.env.example server/.env # then edit DATABASE_URL and JWT_SECRET

# 3. Create tables and demo data
npm run db:migrate
npm run db:seed                   # prints the demo logins

# 4. Start the API on http://localhost:4000
npm run dev:server

# 5. Run the tests (wipes and rebuilds civicfix_test only)
npm test -w server
```

Demo accounts created by the seed (development only): `admin@civicfix.demo / Admin@12345`, `citizen@civicfix.demo / Citizen@12345`, `rohan@civicfix.demo / Citizen@12345`.

## The big picture: what happens on one request

Take "citizen files a pothole report" (`POST /api/complaints`):

1. **helmet** adds security headers. **cors** allows only the frontend's origin.
2. **Rate limiter** counts requests from this IP (and, for new reports, this user).
3. **loadUser** (`middleware/auth.js`) reads the `cf_token` cookie and verifies the JWT signature with `JWT_SECRET`. It then loads the user's row from the database, so the role always comes from the DB.
4. **requireRole('citizen')** returns 401 if not logged in and 403 for admins.
5. **multer** (`middleware/upload.js`) reads the multipart form and keeps the photo in memory (max 5 MB, one file).
6. **validate** (`middleware/validate.js`) checks every field against the Zod schema in `validation/schemas.js`. Problems come back as a single 400 listing all the bad fields.
7. **processImage** (`services/imageStorage.js`) uses *sharp* to prove the file really is a JPEG, PNG or WebP. It then resizes it, converts it to WebP and drops the EXIF metadata, which can include the phone's GPS position. The result is saved under a random UUID filename.
8. **createComplaint** (`services/complaintService.js`) opens a **transaction**. It inserts the complaint, the first `status_history` row and the auto-assignment to the category's default department. Either all three are saved or none are.
9. After the commit, **detectAndStore** (`services/duplicateService.js`) runs your Step 8 detector against nearby recent complaints and stores any suggestions for an admin to review. If detection fails, the report is still saved.
10. The response is built by `serialize()` in `services/complaintQueries.js`. The public version never includes who reported the complaint.

Any thrown error ends up in `middleware/errorHandler.js`, which converts it to the standard `{ error: { code, message, details } }` shape. Stack traces and SQL never reach the browser.

## Which file does what

```
server/
├── src/
│   ├── index.js                 starts the HTTP server
│   ├── app.js                   builds the Express app (middleware order, routes, static files)
│   ├── config.js                reads environment variables; refuses unsafe production config
│   ├── db/
│   │   ├── pool.js              PostgreSQL connection pool + withTransaction()
│   │   ├── migrate.js           applies migrations/*.sql once each (tracked in schema_migrations)
│   │   ├── migrations/001_initial_schema.sql   ← your Step 3 schema, unchanged
│   │   └── seedData.js          departments, categories, demo users, 10 sample complaints
│   ├── middleware/
│   │   ├── auth.js              JWT cookie, loadUser, requireAuth, requireRole/requireAdmin
│   │   ├── validate.js          runs Zod schemas, puts clean data on req.valid
│   │   ├── upload.js            multer limits + MIME check
│   │   ├── rateLimit.js         global / login / new-report limits
│   │   └── errorHandler.js      one JSON error format; maps multer & Postgres errors
│   ├── validation/schemas.js    every accepted input, with human-readable messages
│   ├── routes/                  thin HTTP layer: auth, complaints, me, categories, admin
│   ├── services/
│   │   ├── complaintQueries.js  filtered list/detail SQL + public/admin JSON shapes
│   │   ├── complaintService.js  create, edit, status change, assign (transactions + notifications)
│   │   ├── duplicateService.js  connects duplicateDetector.js to the DB; human review
│   │   ├── duplicateDetector.js ← your Step 8 detector, unchanged
│   │   ├── statsService.js      live dashboard numbers
│   │   └── imageStorage.js      sharp re-encode; local-disk or Cloudinary driver
│   └── utils/errors.js          HttpError + asyncHandler
├── scripts/  migrate.js, seed.js, evaluate-duplicates.js
└── tests/    api/*.test.js (Vitest + Supertest), duplicateDetector.node.test.js
```

Routes contain no SQL; they validate, call a service and send the result. That split means each service function can be reasoned about (and tested) on its own.

## Key design decisions

| Decision | Why |
|---|---|
| JWT in an **httpOnly, SameSite=Lax cookie** (7 days) | Page JavaScript can't read it, so XSS can't steal sessions. Browsers don't send it on cross-site POSTs, which blocks CSRF. In production it is also `Secure` (HTTPS only). |
| Role read from the **database** on every request | Demoting an admin takes effect immediately; a token can't claim a role. |
| **bcrypt cost 12**, dummy compare for unknown emails | Slow hashing resists cracking. Equal timing means attackers can't probe which emails are registered. |
| Nobody can register as admin | `role` in the request is ignored. Admins come from `npm run db:seed` (or SQL). |
| **Parameterized SQL only** (`$1, $2…`) | User input is sent as data, so SQL injection is impossible. Sort keys come from a fixed list. `LIKE` wildcards in searches are escaped. |
| Photos **required** and **re-encoded** | Matches FR4. Re-encoding blocks disguised files (e.g. a PHP script named `.jpg`) and removes GPS metadata. |
| Public vs admin **views** of a complaint | FR15: public endpoints and the map never include reporter name, email or phone. |
| Status history is **append-only** | Every change is recorded with who, when and an optional note. A rejection always stores its reason (enforced by both the API and a DB CHECK constraint). |
| Assignments keep **history** | Reassigning sets the old row's `is_current = false`. A partial unique index guarantees exactly one current assignment. |
| Duplicates stored as (newer, older) pairs | Each pair appears once whichever complaint triggers detection. "Confirm" only links them (`duplicate_of`); the admin still decides the status separately. |
| Citizens can edit only while `submitted` | Once an admin starts handling it, the report is frozen so history stays meaningful. |
| Express serves the built React app in production | One origin means the cookie works without cross-site configuration. |

## Tests: what was actually run

Command: `npm test -w server`, run on 2 Nov 2026 against PostgreSQL 16.15 and Node 22.23.

| Suite | Tests | Result |
|---|---|---|
| `tests/api/auth.test.js`: register, login, logout, me, validation, duplicate email, forged JWT, `alg: none` token, profile update, login rate limit → 429 | 14 | ✅ 14 passed |
| `tests/api/complaints.test.js`: create with photo (DB row, WebP served, EXIF gone), missing photo, disguised file, SVG, >5 MB, field validation, bad category, 401/403, public detail by ID and tracking ID without reporter data, filters/search/pagination, SQL-injection and `%` search, near-me + distance sort, map payload, my complaints, owner edit rules, similar-report check | 16 | ✅ 16 passed |
| `tests/api/admin.test.js`: 401/403 on all 13 admin endpoints, citizen can't change status, full status workflow with history and notifications, rejection reason (API + DB constraint), reopen, no-op/invalid status, priority/category/department with history, reporter visible to admin, date filter, stats compared to direct SQL counts, stats update live, duplicate detect → confirm/dismiss → no auto-merge, category CRUD/deactivate | 26 | ✅ 26 passed |
| `tests/api/security.test.js`: headers (CSP, nosniff, no `x-powered-by`), JSON 404, no stack/SQL leakage, 100 KB body limit, CORS origin, mass-assignment ignored, XSS payload stored as inert JSON text, path traversal on `/uploads`, SQL metacharacters in ID/sort/category, cookie flags | 10 | ✅ 10 passed |
| `tests/duplicateDetector.node.test.js` (Step 8 unit tests, unchanged) | 8 | ✅ 8 passed |
| **Total** | **74** | **74 passed, 0 failed, 0 skipped** |

Manual checks also done with `curl` against the running dev server: health, categories, list, detail by tracking ID, citizen blocked from stats, admin stats, a real 2400×1800 JPEG upload (stored as 1600×1200 WebP with no EXIF), and a disguised-file upload (rejected).

### Bugs found and fixed

| # | Found by | Symptom | Root cause | Fix |
|---|---|---|---|---|
| 1 | `complaints.test.js` › citizen editing | Admin status change returned **500**, so the citizen could still edit | PostgreSQL error `42P08`: parameter `$2` was assigned to a `VARCHAR` column and compared with a text literal, so Postgres inferred two types | Cast once: `$2::varchar` in `changeStatus()`. Regression: full suite re-run, 66/66 API tests pass |
| 2 | Same investigation | The 500 above was invisible during tests | The error handler skipped logging when `NODE_ENV=test` | Unexpected 500s are now always logged |
| 3 | Code review during smoke test | Public `/api/categories` showed `defaultDepartment: null` for every category | That query doesn't select the department column, but the serializer always added the field | Field is now only included when it was actually queried |

## Known limitations (honest list)

- **Logout is client-side.** It clears the cookie, but a stolen token stays valid until it expires (7 days). A token denylist or short-lived tokens with refresh would fix this.
- **Rate-limit counters are in memory.** They reset on restart and aren't shared across multiple server instances. That's fine for one instance; use a Redis store if you scale out.
- **Cloudinary driver not yet exercised.** It's written against Cloudinary's documented signed-upload REST API, but every test used the local-disk driver because no Cloudinary account is connected. It needs one real upload to verify before deployment (Step 10).
- **Local uploads disappear on hosts with ephemeral disks** (e.g. Render free tier). Use Cloudinary or a persistent disk in production.
- **Duplicate detection** is limited to a 300 m / 30-day window and text similarity. See `ml/README.md` for measured accuracy and its weak spots: the stress set gives 50% precision and 85.7% recall.
- **No password reset or email verification** yet (needs an email service).
- Exact complaint coordinates are public on the map. They describe the issue's location, not the reporter's home, but the frontend should warn users not to pin their own house.

## What's next

The frontend (Step 2, with the admin UI from Step 6 and the maps from Step 7) is now built; see [FRONTEND.md](FRONTEND.md). Later backend changes made while testing it in the browser (the session endpoint, sentence-case status labels, configurable rate limits, proper 404s next to the React app) are listed there.
