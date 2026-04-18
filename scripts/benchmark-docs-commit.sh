#!/bin/bash
# Benchmark: simulated docs-only commit (no code staged)
# Should hit the fast-path skip in .husky/pre-commit

set +e

# Stash any current staged state, then stage a docs-only file
ORIG_STAGED=$(git diff --cached --name-only)
git stash push --keep-index --quiet 2>/dev/null || true

# Make a temp benign change to a markdown file
TMP_FILE="autoresearch.ideas.md"
echo "" >> "$TMP_FILE"
git add "$TMP_FILE"

START=$(date +%s.%N)
.husky/pre-commit > /tmp/precommit-docs.log 2>&1
EXIT=$?
END=$(date +%s.%N)
TOTAL=$(echo "$END - $START" | bc)

# Restore
git reset HEAD "$TMP_FILE" > /dev/null 2>&1
git checkout "$TMP_FILE" > /dev/null 2>&1
git stash pop --quiet 2>/dev/null || true

echo "METRIC total_s=$TOTAL"
echo "METRIC docs_only_s=$TOTAL"
exit $EXIT
