#!/bin/sh
# No login shell, dotenv loading, runtime disk cache, reports or test runners.
exec env BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun --no-env-file "$(dirname "$0")/ponytail-audit.ts" "$@"
