#!/bin/bash
# Benchmark: warm pre-commit (L1 cache hit + G2 cache hit)
# Models the typical case: small commit with no source-file changes affecting tests
set +e

START_TOTAL=$(date +%s.%N)
TMP_DIR=$(mktemp -d)

# Warm caches first (idempotent, not counted)
bun run test:coverage:cached > /dev/null 2>&1 || true
bun run lint:typecheck:cached > /dev/null 2>&1 || true
bun run test:security > /dev/null 2>&1 || true

START_RUN=$(date +%s.%N)

# Pre-commit phase (parallel)
(
  S=$(date +%s.%N); bun run test:coverage:cached > /dev/null 2>&1; E=$(date +%s.%N)
  echo "$E - $S" | bc > "$TMP_DIR/l1"
) &
P1=$!
(
  S=$(date +%s.%N); bun run lint:typecheck:cached > /dev/null 2>&1; E=$(date +%s.%N)
  echo "$E - $S" | bc > "$TMP_DIR/tsc"
) &
P2=$!
(
  S=$(date +%s.%N); bunx lint-staged > /dev/null 2>&1; E=$(date +%s.%N)
  echo "$E - $S" | bc > "$TMP_DIR/lint"
) &
P3=$!
wait $P1 $P2 $P3
PRECOMMIT=$(echo "$(date +%s.%N) - $START_RUN" | bc)

# G2
START_G2=$(date +%s.%N)
bun run test:security > /dev/null 2>&1
END_G2=$(date +%s.%N)
G2=$(echo "$END_G2 - $START_G2" | bc)

L1=$(cat "$TMP_DIR/l1")
TSC=$(cat "$TMP_DIR/tsc")
LINT=$(cat "$TMP_DIR/lint")
rm -rf "$TMP_DIR"

END=$(date +%s.%N)
TOTAL=$(echo "$END - $START_RUN" | bc)

echo "METRIC total_s=$TOTAL"
echo "METRIC precommit_s=$PRECOMMIT"
echo "METRIC l1_tests_s=$L1"
echo "METRIC g1a_typecheck_s=$TSC"
echo "METRIC g1b_lintstaged_s=$LINT"
echo "METRIC g2_security_s=$G2"
echo "✅ Warm hook benchmark complete"
