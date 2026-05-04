import { throwApiError } from "@/lib/api-error";

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    await throwApiError(res);
  }
  return res.json() as Promise<T>;
}
