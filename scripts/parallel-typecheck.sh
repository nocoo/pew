#!/bin/bash
# Parallel TypeScript type checking for all packages
# Properly captures exit codes from all background processes

set -e

PIDS=()
RESULTS=()

# Start all tsc processes in background
tsc --noEmit -p packages/core/tsconfig.json &
PIDS+=($!)

tsc --noEmit -p packages/cli/tsconfig.json &
PIDS+=($!)

bun run --cwd packages/web typecheck &
PIDS+=($!)

tsc --noEmit -p packages/worker/tsconfig.json &
PIDS+=($!)

tsc --noEmit -p packages/worker-read/tsconfig.json &
PIDS+=($!)

# Wait for each process and collect exit codes
EXIT_CODE=0
for PID in "${PIDS[@]}"; do
  wait $PID || EXIT_CODE=1
done

exit $EXIT_CODE
