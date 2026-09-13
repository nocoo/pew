-- Apply after the web app and read Worker no longer use badges.
-- Delete assignments before definitions to respect foreign keys.
DROP TABLE IF EXISTS badge_assignments;
DROP TABLE IF EXISTS badges;
