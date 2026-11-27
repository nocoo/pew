import { runLocalE2e } from "./e2e-utils";

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
process.exitCode = await runLocalE2e("ui", args);
