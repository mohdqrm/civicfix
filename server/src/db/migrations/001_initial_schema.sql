-- CivicFix initial schema
-- Applied by scripts/migrate.js (each migration runs once, inside a transaction).

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(20)  NOT NULL DEFAULT 'citizen'
                 CHECK (role IN ('citizen', 'admin')),
  phone          VARCHAR(20),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Emails are unique regardless of letter case.
CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));

CREATE TABLE departments (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL UNIQUE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id                     SERIAL PRIMARY KEY,
  slug                   VARCHAR(50)  NOT NULL UNIQUE,
  name                   VARCHAR(100) NOT NULL UNIQUE,
  description            TEXT,
  default_department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE complaints (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id       INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title             VARCHAR(120) NOT NULL CHECK (char_length(title) >= 5),
  description       TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  status            VARCHAR(20) NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted', 'under_review', 'in_progress', 'resolved', 'rejected')),
  priority          VARCHAR(10) NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  latitude          NUMERIC(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude         NUMERIC(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  landmark          VARCHAR(200),
  image_url         TEXT,
  image_key         TEXT,
  rejection_reason  TEXT,
  duplicate_of      INTEGER REFERENCES complaints(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  -- A rejected complaint must always carry an explanation.
  CONSTRAINT rejected_needs_reason
    CHECK (status <> 'rejected' OR (rejection_reason IS NOT NULL AND char_length(rejection_reason) >= 5)),
  CONSTRAINT not_duplicate_of_self CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);
CREATE INDEX complaints_status_idx      ON complaints (status);
CREATE INDEX complaints_category_idx    ON complaints (category_id);
CREATE INDEX complaints_user_idx        ON complaints (user_id);
CREATE INDEX complaints_created_at_idx  ON complaints (created_at DESC);
CREATE INDEX complaints_location_idx    ON complaints (latitude, longitude);

-- Append-only audit trail of every status change.
CREATE TABLE status_history (
  id            SERIAL PRIMARY KEY,
  complaint_id  INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  old_status    VARCHAR(20),
  new_status    VARCHAR(20) NOT NULL,
  note          TEXT,
  changed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_history_complaint_idx ON status_history (complaint_id, created_at);

-- Department assignments; history is kept, the current one has is_current = true.
CREATE TABLE assignments (
  id             SERIAL PRIMARY KEY,
  complaint_id   INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  assigned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT,
  is_current     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one current assignment per complaint.
CREATE UNIQUE INDEX assignments_one_current_idx ON assignments (complaint_id) WHERE is_current;
CREATE INDEX assignments_department_idx ON assignments (department_id) WHERE is_current;

-- AI duplicate suggestions awaiting human review.
CREATE TABLE duplicate_suggestions (
  id            SERIAL PRIMARY KEY,
  complaint_id  INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  candidate_id  INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  score         NUMERIC(5, 4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  components    JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (review_status IN ('pending', 'confirmed', 'dismissed')),
  reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dup_not_self CHECK (complaint_id <> candidate_id),
  CONSTRAINT dup_unique_pair UNIQUE (complaint_id, candidate_id)
);
CREATE INDEX duplicate_suggestions_pending_idx ON duplicate_suggestions (review_status);

CREATE TABLE notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  complaint_id  INTEGER REFERENCES complaints(id) ON DELETE CASCADE,
  message       TEXT NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);
