/**
 * Normalize an unknown error value into a user-displayable string.
 *
 * Centralizes the `err instanceof Error ? err.message : "Unknown error"`
 * pattern that previously lived inside every mutate-style client hook,
 * so the fallback wording stays consistent and per-hook business
 * fallbacks (e.g. "Registration failed") are easy to opt into via the
 * second argument.
 *
 * @param err     - Anything thrown / received from a Promise rejection.
 * @param fallback - String to return when `err` carries no usable message.
 *                   Defaults to "Unknown error".
 */
export function toErrorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error) return err.message;
  return fallback;
}
