-- Apply after the web app and read Worker no longer use these features.
-- Children first; preserve users, usage data and session_records.project_ref.
DROP TABLE IF EXISTS showcase_upvotes;
DROP TABLE IF EXISTS showcases;
DROP TABLE IF EXISTS project_tags;
DROP TABLE IF EXISTS project_aliases;
DROP TABLE IF EXISTS projects;
