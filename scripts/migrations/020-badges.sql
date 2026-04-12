-- ============================================================
-- Badge System (doc 39)
-- Admin-assigned badges with 7-day auto-expiry
-- ============================================================

-- Badge Definitions (admin-created templates, immutable once created)
CREATE TABLE IF NOT EXISTS badges (
  id              TEXT PRIMARY KEY,                         -- nanoid
  text            TEXT NOT NULL,                            -- 1-4 characters (e.g., "MVP", "神", "S1")
  icon            TEXT NOT NULL,                            -- icon key: "shield", "star", "hexagon", etc.
  color_bg        TEXT NOT NULL,                            -- background hex: "#3B82F6"
  color_text      TEXT NOT NULL,                            -- text hex: "#FFFFFF"
  description     TEXT,                                     -- admin notes (not shown to users)
  is_archived     INTEGER NOT NULL DEFAULT 0,               -- 1=archived (hidden from assignment UI, still renderable)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_badges_created ON badges(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_badges_active ON badges(is_archived, created_at DESC);

-- Badge Assignments (user-badge links with snapshot + audit)
CREATE TABLE IF NOT EXISTS badge_assignments (
  id              TEXT PRIMARY KEY,                         -- nanoid
  badge_id        TEXT NOT NULL REFERENCES badges(id),
  user_id         TEXT NOT NULL REFERENCES users(id),

  -- Snapshot of badge appearance at assignment time (immutable audit trail)
  snapshot_text   TEXT NOT NULL,                            -- badge text at assignment
  snapshot_icon   TEXT NOT NULL,                            -- badge icon at assignment
  snapshot_bg     TEXT NOT NULL,                            -- background color at assignment
  snapshot_fg     TEXT NOT NULL,                            -- text color at assignment

  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),  -- assignment timestamp
  expires_at      TEXT NOT NULL,                            -- assigned_at + 7 days
  assigned_by     TEXT NOT NULL REFERENCES users(id),       -- admin who assigned
  note            TEXT,                                     -- admin note for this assignment

  -- Revocation tracking (null = never revoked, only set by manual admin action)
  revoked_at      TEXT,                                     -- when manually revoked by admin
  revoked_by      TEXT REFERENCES users(id),                -- admin who revoked
  revoke_reason   TEXT,                                     -- reason for revocation

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_badge_assignments_user ON badge_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_badge_assignments_badge ON badge_assignments(badge_id);
CREATE INDEX IF NOT EXISTS idx_badge_assignments_expires ON badge_assignments(expires_at);
CREATE INDEX IF NOT EXISTS idx_badge_assignments_active ON badge_assignments(user_id, revoked_at, expires_at);

-- Prevent multiple non-revoked assignments of same badge to same user
-- (covers both active and naturally-expired-but-not-revoked states)
CREATE UNIQUE INDEX IF NOT EXISTS idx_badge_assignments_unique_non_revoked
  ON badge_assignments(badge_id, user_id)
  WHERE revoked_at IS NULL;
