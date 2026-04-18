#!/bin/bash
# Unified benchmark: pre-commit (parallel L1+G1a+G1b) + pre-push security gate
# Outputs METRIC lines for autoresearch
# Skips L2 E2E (requires dev server, network, real D1 — not deterministic for benchmarking)

set +e

START_TOTAL=$(date +%s.%N)

# ─────────────────────────────────────────────────────────────
# Pre-commit phase
# ─────────────────────────────────────────────────────────────

# G0: bun install --frozen-lockfile (skip if no package changes)
START_G0=$(date +%s.%N)
PKG_CHANGES=$(git diff --cached --name-only | grep -E "package\.json|bun\.lock" || true)
if [ -n "$PKG_CHANGES" ]; then
  bun install --frozen-lockfile > /dev/null 2>&1
fi
END_G0=$(date +%s.%N)
G0_TIME=$(echo "$END_G0 - $START_G0" | bc)

# Parallel L1 + G1a + G1b
START_PARALLEL=$(date +%s.%N)
TMP_DIR=$(mktemp -d)

(
  S=$(date +%s.%N); PEW_L1_NO_CACHE=1 bun run test:coverage:cached > /dev/null 2>&1; E=$(date +%s.%N)
  echo "$E - $S" | bc > "$TMP_DIR/l1_time"
) &
L1_PID=$!
(
  S=$(date +%s.%N); bun run lint:typecheck > /dev/null 2>&1; E=$(date +%s.%N)
  echo "$E - $S" | bc > "$TMP_DIR/g1a_time"
) &
G1A_PID=$!
(
  S=$(date +%s.%N); bunx lint-staged > /dev/null 2>&1; E=$(date +%s.%N)
  echo "$E - $S" | bc > "$TMP_DIR/g1b_time"
) &
G1B_PID=$!

wait $L1_PID
wait $G1A_PID
wait $G1B_PID

END_PARALLEL=$(date +%s.%N)
PRECOMMIT_TIME=$(echo "$END_PARALLEL - $START_G0" | bc)

L1_TIME=$(cat "$TMP_DIR/l1_time")
G1A_TIME=$(cat "$TMP_DIR/g1a_time")
G1B_TIME=$(cat "$TMP_DIR/g1b_time")
rm -rf "$TMP_DIR"

# ─────────────────────────────────────────────────────────────
# Pre-push phase: G2 security only (L2 E2E requires server)
# ─────────────────────────────────────────────────────────────
START_G2=$(date +%s.%N)
bun run test:security > /dev/null 2>&1
END_G2=$(date +%s.%N)
G2_TIME=$(echo "$END_G2 - $START_G2" | bc)

END_TOTAL=$(date +%s.%N)
TOTAL_TIME=$(echo "$END_TOTAL - $START_TOTAL" | bc)

echo "METRIC total_s=$TOTAL_TIME"
echo "METRIC precommit_s=$PRECOMMIT_TIME"
echo "METRIC g0_lockfile_s=$G0_TIME"
echo "METRIC l1_tests_s=$L1_TIME"
echo "METRIC g1a_typecheck_s=$G1A_TIME"
echo "METRIC g1b_lintstaged_s=$G1B_TIME"
echo "METRIC g2_security_s=$G2_TIME"
echo "✅ Combined benchmark complete (pre-commit parallel + G2 security)"
