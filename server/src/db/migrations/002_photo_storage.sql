-- Photos stored inside PostgreSQL (STORAGE_DRIVER=database).
-- Used on hosts without a persistent disk (e.g. Render's free plan), so photos
-- survive restarts without needing a separate image service. Each row is one
-- re-encoded WebP (max 1600 px, usually 50-300 KB).
CREATE TABLE IF NOT EXISTS photos (
  key        VARCHAR(64) PRIMARY KEY,
  data       BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
