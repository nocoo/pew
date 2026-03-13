-- Lightweight labels for projects
CREATE TABLE IF NOT EXISTS project_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_project
  ON project_tags(project_id);

CREATE INDEX IF NOT EXISTS idx_project_tags_user_tag
  ON project_tags(user_id, tag);
