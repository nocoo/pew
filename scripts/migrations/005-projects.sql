-- Migration 005: projects + project_aliases tables
-- Two-layer project management: user-defined projects with alias mappings
-- from (user_id, source, project_ref) to a project.

-- User-defined logical projects
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,               -- nanoid
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects(user_id);

-- Map (user_id, source, project_ref) → project
CREATE TABLE IF NOT EXISTS project_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, project_ref)
);

CREATE INDEX IF NOT EXISTS idx_project_aliases_project
  ON project_aliases(project_id);

CREATE INDEX IF NOT EXISTS idx_project_aliases_lookup
  ON project_aliases(user_id, source, project_ref);
