# CivicFix REST API

Base URL: `/api`. All requests and responses are JSON, except complaint creation, which uses `multipart/form-data` so it can carry a photo.

**Authentication.** After register or login, the server sets an `httpOnly` cookie called `cf_token`, valid for 7 days. Browsers send it automatically. From the frontend, call `fetch(url, { credentials: 'include' })`. Supertest agents keep it too.

**Errors** always have this shape:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Some fields are invalid",
             "details": [{ "field": "title", "message": "Title must be at least 5 characters" }] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Validation failed (`details` lists each field), malformed JSON, invalid image |
| 401 | `UNAUTHORIZED` | Not logged in, or wrong email/password |
| 403 | `FORBIDDEN` | Logged in, but your role can't do this |
| 404 | `NOT_FOUND` | Record or route doesn't exist |
| 409 | `CONFLICT` | Duplicate email, no-op status change, already reviewed, too late to edit |
| 413 | `UPLOAD_ERROR` / `PAYLOAD_TOO_LARGE` | Photo > 5 MB, JSON > 100 KB |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Bug: details are logged on the server, never sent to the client |

**Complaint IDs.** Every `:id` for a complaint accepts either `42` or the tracking form `CF-000042`.

**Paginated lists** return `{ items, page, limit, total, totalPages }`. Defaults are `page=1` and `limit=20`, with a maximum `limit` of 100.

**Statuses:** `submitted`, `under_review`, `in_progress`, `resolved`, `rejected`. **Priorities:** `low`, `medium`, `high`, `critical`.

---

## Auth: `/api/auth`

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/register` | anyone | `name` (2–100), `email`, `password` (8–72, needs a letter and a number), `phone?` | `201 { user }` + cookie |
| POST | `/login` | anyone | `email`, `password` | `{ user }` + cookie |
| POST | `/logout` | anyone | none | `{ ok: true }`, clears cookie |
| GET | `/me` | logged in | none | `{ user }` |

`user` = `{ id, name, email, role, phone, createdAt }`. Registration always creates a `citizen`. A `role` field in the body is ignored. Login and register are limited to 20 requests per 15 minutes per IP.

## Categories: `/api/categories`

| GET | `/` | public | Active categories: `{ items: [{ id, slug, name, description, isActive }] }` |
|---|---|---|---|

## Complaints: `/api/complaints`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/` | public | List. Query: `status` (comma list), `category` (id or slug), `q` (text or `CF-…`), `lat`+`lng`+`radius` (m, default 2000), `sort` = `newest`\|`oldest`\|`updated`\|`priority`\|`distance`, `page`, `limit` |
| GET | `/map` | public | Map markers (max 1000): `{ items: [{ id, trackingId, title, status, latitude, longitude, createdAt, category }] }`. Query: `status`, `category`, `lat`, `lng`, `radius` |
| GET | `/:id` | public | One complaint + `statusHistory` |
| POST | `/similar` | logged in | Body: `categoryId, title, description, latitude, longitude`. Returns nearby similar reports (`score`, `distanceM`) to show *before* submitting |
| POST | `/` | citizen | **multipart/form-data**: `categoryId`, `title` (5–120), `description` (10–2000), `latitude`, `longitude`, `landmark?` (≤200), `photo` (required; JPEG/PNG/WebP, ≤5 MB). Returns `201 { complaint }` with `trackingId`. Max 10 per user per hour |
| PATCH | `/:id` | owner | `title?`, `description?`, `landmark?`. Only while status is `submitted` (otherwise `409`) |

**Public complaint object** (never contains the reporter's identity):

```json
{
  "id": 42, "trackingId": "CF-000042",
  "title": "Deep pothole on Outer Circle", "description": "…",
  "category": { "id": 1, "slug": "roads", "name": "Roads & Potholes" },
  "status": "in_progress", "priority": "high",
  "latitude": 28.63195, "longitude": 77.22055, "landmark": "Near E Block",
  "imageUrl": "/uploads/3f2a….webp", "rejectionReason": null,
  "department": { "id": 1, "name": "Public Works" },
  "duplicateOf": null,
  "createdAt": "…", "updatedAt": "…", "resolvedAt": null,
  "isMine": true,
  "statusHistory": [
    { "id": 1, "fromStatus": null, "toStatus": "submitted", "note": "Complaint submitted", "at": "…", "changedBy": "Reporter" }
  ]
}
```

`isMine` is present only when the request is logged in. `distanceM` is present only on location searches. In public history, `changedBy` is `Reporter`, `CivicFix team` or `System`, never a person's name.

**Photos** are re-encoded server-side: verified as a real image, resized to at most 1600 px, converted to WebP, with all EXIF/GPS metadata removed. They are stored under a random filename and served at `imageUrl`.

## Current user: `/api/me` (logged in)

| Method | Path | Notes |
|---|---|---|
| PATCH | `/` | `name?`, `phone?` (send `null` to clear) → `{ user }` |
| GET | `/complaints` | Your complaints (same filters as the public list) plus `counts: { submitted, under_review, in_progress, resolved, rejected, total }` |
| GET | `/notifications` | `?unread=true` to filter. Returns `{ items: [{ id, message, isRead, createdAt, complaint }], unreadCount, … }` |
| PATCH | `/notifications/:id/read` | Mark one as read (only your own) |
| POST | `/notifications/read-all` | Mark all as read |

A notification is created when an admin changes your complaint's status or department.

## Admin: `/api/admin` (admins only, citizens get 403)

| Method | Path | Notes |
|---|---|---|
| GET | `/stats` | Live dashboard numbers (see below) |
| GET | `/complaints` | Same as the public list, plus filters `priority` (comma list), `departmentId`, `from`, `to` (dates), `hasDuplicates=true`. Items add `reporter { id, name, email, phone }` and `pendingDuplicates` |
| GET | `/complaints/:id` | Full record: reporter, `statusHistory` (with admin names), `assignments` history, `duplicateSuggestions` |
| PATCH | `/complaints/:id/status` | `status`, `note?`, `rejectionReason` (required, ≥5 chars, when rejecting). Records history and notifies the reporter. Any status can be set, so reopening is allowed. Setting the current status → `409` |
| PATCH | `/complaints/:id` | `priority?`, `categoryId?` |
| POST | `/complaints/:id/assign` | `departmentId`, `note?`. The previous assignment is kept as history |
| POST | `/complaints/:id/detect-duplicates` | Re-run AI detection → `{ added, suggestions }` |
| GET | `/duplicates` | Review queue. `?status=pending\|confirmed\|dismissed` |
| PATCH | `/duplicates/:id` | `decision`: `confirmed` (sets the newer complaint's `duplicateOf` to the older one) or `dismissed`. Status is never changed automatically |
| GET | `/departments` | `{ items: [{ id, name, description, openComplaints }] }` |
| GET | `/categories` | All categories, including inactive, with `defaultDepartment` and `complaintCount` |
| POST | `/categories` | `slug` (lowercase-with-hyphens), `name`, `description?`, `defaultDepartmentId?` |
| PATCH | `/categories/:id` | `name?`, `description?`, `defaultDepartmentId?` (nullable), `isActive?`. Categories are deactivated, never deleted |

**Duplicate suggestion object:** `{ id, score, components: { text, geo, category, time, distanceM, daysApart }, reviewStatus, reviewedBy, reviewedAt, complaint: {…newer…}, likelyOriginal: {…older…} }`

**`/stats` response fields**

| Field | Meaning |
|---|---|
| `total` | All complaints |
| `byStatus` | Count for each of the 5 statuses |
| `pending` | `submitted + under_review` (no one is working on it yet) |
| `inProgress`, `resolved`, `rejected` | Counts |
| `resolutionRate` | `resolved / total × 100`, 1 decimal place (0 if there are no complaints) |
| `avgResolutionHours` | Mean hours from filing to resolution, over resolved complaints (`null` if none) |
| `last7Days` | Complaints filed in the last 7 days |
| `byPriority`, `byCategory`, `byDepartment` | Breakdowns. `byDepartment` includes an "Unassigned" row |
| `last30Days` | `[{ date, reported, resolved }]` × 30 days, for a trend chart |
| `pendingDuplicateSuggestions` | Size of the AI review queue |

## Health

`GET /api/health` → `{ ok: true, database: "connected" }`, or `503` if the database is unreachable.
