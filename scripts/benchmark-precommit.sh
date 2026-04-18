#!/bin/bash
# Benchmark script for pre-commit performance
# Outputs METRIC lines for autoresearch

set -e

START_TOTAL=$(date +%s.%N)

# G0: bun install --frozen-lockfile
START_G0=$(date +%s.%N)
bun install --frozen-lockfile 2>&1 > /dev/null
END_G0=$(date +%s.%N)
G0_TIME=$(echo "$END_G0 - $START_G0" | bc)

# Parallel L1 + G1a + G1b
START_PARALLEL=$(date +%s.%N)

# Create temp files for individual timing
TMP_DIR=$(mktemp -d)

(
  START=$(date +%s.%N)
  bun run test:coverage 2>&1 > /dev/null
  END=$(date +%s.%N)
  echo "$END - $START" | bc > "$TMP_DIR/l1_time"
) &
L1_PID=$!

(
  START=$(date +%s.%N)
  bun run lint:typecheck 2>&1 > /dev/null
  END=$(date +%s.%N)
  echo "$END - $START" | bc > "$TMP_DIR/g1a_time"
) &
G1A_PID=$!

(
  START=$(date +%s.%N)
  bunx lint-staged 2>&1 > /dev/null
  END=$(date +%s.%N)
  echo "$END - $START" | bc > "$TMP_DIR/g1b_time"
) &
G1B_PID=$!

wait $L1_PID
wait $G1A_PID
wait $G1B_PID

END_PARALLEL=$(date +%s.%N)
PARALLEL_TIME=$(echo "$END_PARALLEL - $START_PARALLEL" | bc)

L1_TIME=$(cat "$TMP_DIR/l1_time")
G1A_TIME=$(cat "$TMP_DIR/g1a_time")
G1B_TIME=$(cat "$TMP_DIR/g1b_time")
rm -rf "$TMP_DIR"

END_TOTAL=$(date +%s.%N)
TOTAL_TIME=$(echo "$END_TOTAL - $START_TOTAL" | bc)

# Output METRIC lines
echo "METRIC total_s=$TOTAL_TIME"
echo "METRIC g0_lockfile_s=$G0_TIME"
echo "METRIC l1_tests_s=$L1_TIME"
echo "METRIC g1a_typecheck_s=$G1A_TIME"
echo "METRIC g1b_lintstaged_s=$G1B_TIME"
echo "✅ Pre-commit benchmark complete (parallel L1+G1a+G1b)"
