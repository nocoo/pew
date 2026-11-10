import { runLocalE2e } from "./e2e-utils";

process.exit(await runLocalE2e("ui", process.argv.slice(2)));
