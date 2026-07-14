#!/usr/bin/env node
/**
 * Standalone helper spawned by admission-primitive.test.ts.
 *
 * Each worker attempts writeFileSync(gate, "", { flag: "wx" }) on the
 * same target path and prints its outcome to stdout so the parent test
 * can tally winners vs losers.
 *
 * Plain CommonJS so both node and bun runtimes can spawn it directly
 * without a TS loader.
 */

"use strict";

const { writeFileSync, existsSync } = require("node:fs");

const gate = process.argv[2];
if (!gate) {
  process.stdout.write("no-gate\n");
  process.exit(2);
}

// Synchronize the burst: parent writes a start file and every worker
// busy-waits until it appears.
const startPath = process.argv[3];
if (typeof startPath === "string" && startPath.length > 0) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(startPath)) {
    if (Date.now() > deadline) break;
  }
}

try {
  writeFileSync(gate, String(process.pid), { flag: "wx" });
  process.stdout.write("winner\n");
  process.exit(0);
} catch (err) {
  const code = err?.code ?? "unknown";
  process.stdout.write(`loser:${code}\n`);
  process.exit(0);
}
