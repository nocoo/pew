-- Migration: Hash legacy plaintext project_ref values
--
-- Before commit 3f44a88, the Claude Code parser stored raw path-encoded
-- directory names (e.g. "-Users-nocoo-workspace-pew") as project_ref.
-- After that commit, all parsers use SHA-256(raw)[0:16] hex hashes.
--
-- D1 SQLite does not have a built-in SHA-256 function, so this migration
-- cannot hash in-place. Instead we NULL out any project_ref values that
-- are not valid 16-char hex strings. These sessions will get correct
-- hashed project_refs on the next CLI sync.
--
-- Detection: a valid hash is exactly 16 chars long AND contains only
-- [0-9a-f]. We strip all hex chars via nested REPLACE; if anything
-- remains, the value is not a valid hash.
--
-- Also clean up project_aliases that reference old plaintext project_refs.

-- Step 1: Delete project_aliases with non-hex project_refs.
DELETE FROM project_aliases
WHERE LENGTH(project_ref) != 16
   OR LENGTH(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        REPLACE(REPLACE(
          project_ref,
          '0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),
          '7',''),'8',''),'9',''),'a',''),'b',''),'c',''),'d',''),
          'e',''),'f','')
      ) > 0;

-- Step 2: NULL out non-hex project_refs in session_records.
-- On next sync the CLI will re-populate with proper hashes.
UPDATE session_records
SET project_ref = NULL, updated_at = datetime('now')
WHERE project_ref IS NOT NULL
  AND (
    LENGTH(project_ref) != 16
    OR LENGTH(
         REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         REPLACE(REPLACE(
           project_ref,
           '0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),
           '7',''),'8',''),'9',''),'a',''),'b',''),'c',''),'d',''),
           'e',''),'f','')
       ) > 0
  );
