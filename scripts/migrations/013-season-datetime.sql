-- Upgrade season start_date/end_date from YYYY-MM-DD to ISO 8601 datetime.
-- Existing values get T00:00:00Z appended (preserving UTC semantics).
UPDATE seasons SET start_date = start_date || 'T00:00:00Z' WHERE length(start_date) = 10;
UPDATE seasons SET end_date = end_date || 'T00:00:00Z' WHERE length(end_date) = 10;
