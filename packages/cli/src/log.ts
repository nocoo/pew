/**
 * Tiny CLI logger with consistent icon alignment.
 *
 * Every method writes: `icon + " " + message + "\n"` to stderr.
 * Icon column is always 1 Unicode character, so text starts at column 2.
 * No timestamps — pew sync runs are short (<10s).
 */

import { pc } from "@nocoo/base-cli";

function write(icon: string, msg: string): void {
  process.stderr.write(`${icon} ${msg}\n`);
}

export const log = {
  /** Phase start (magenta ◐) */
  start(msg: string): void {
    write(pc.magenta("◐"), msg);
  },

  /** Success (green ✔) */
  success(msg: string): void {
    write(pc.green("✔"), msg);
  },

  /** Info (cyan ℹ) */
  info(msg: string): void {
    write(pc.cyan("ℹ"), msg);
  },

  /** Warning (yellow ⚠) */
  warn(msg: string): void {
    write(pc.yellow("⚠"), msg);
  },

  /** Error (red ✖) */
  error(msg: string): void {
    write(pc.red("✖"), msg);
  },

  /** Plain text with no icon prefix (indented to align with icon messages) */
  text(msg: string): void {
    process.stderr.write(`  ${msg}\n`);
  },

  /** Empty line */
  blank(): void {
    process.stderr.write("\n");
  },
};
