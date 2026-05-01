/**
 * Pure array utility helpers.
 *
 * Keep this file dependency-free and side-effect-free so it is safe to
 * import from any layer (route handlers, server components, client
 * components, lib code). Add only helpers whose contract is small and
 * obvious enough that the call site reads better than an inline reduce.
 */

/**
 * Numeric-only keys of `T`. Used to constrain `sumBy` so that only fields
 * whose value is a `number` may be summed. Compile-time guard: passing a
 * non-numeric key is a TypeScript error, no runtime check needed.
 */
type NumericKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

/**
 * Sum a numeric field across an array of objects.
 *
 * - Empty array → `0`.
 * - The key must reference a `number` field (compile-time enforced via
 *   `NumericKeys<T>`); attempts to sum a non-numeric or computed
 *   expression will not compile.
 * - For computed expressions (`x.a * x.b`, `x.a ?? 0`, etc.) keep the
 *   inline `arr.reduce(...)` — this helper deliberately does not expose
 *   a callback overload to avoid drifting back into shape-B territory.
 */
export function sumBy<T, K extends NumericKeys<T>>(
  arr: readonly T[],
  key: K,
): number {
  let total = 0;
  for (const item of arr) {
    total += item[key] as number;
  }
  return total;
}
