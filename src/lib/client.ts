"use client";

/** Small fetch wrapper for client components. Throws the server's error message. */
export async function call<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = res.status === 413 ? "That is too large to send in one go. Try fewer or smaller files." : `Request failed (${res.status})`;
    throw new Error((data as { error?: string }).error ?? fallback);
  }
  return data as T;
}
