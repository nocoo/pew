/**
 * Shared API error parsing helper.
 * Extracts `{ error: string }` from non-OK responses and throws a descriptive Error.
 */
export async function throwApiError(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
}
