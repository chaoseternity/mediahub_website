/**
 * Client-side helper for loading the member directory from GET /api/users.
 *
 * Admins receive full user records; all other members receive a minimal
 * directory (id, name, image). Callers must therefore treat
 * email and other fields as optional.
 */
export interface DirectoryUser {
  id: number;
  name: string;
  image: string | null;
  email?: string;
}

export type UserDirectoryResult =
  | { ok: true; users: DirectoryUser[] }
  | { ok: false; users: []; error: string };

export async function fetchUserDirectory(signal?: AbortSignal): Promise<UserDirectoryResult> {
  try {
    const res = await fetch("/api/users", { signal });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Request failed (${res.status})`;
      return { ok: false, users: [], error: `Could not load member list: ${msg}` };
    }
    if (!Array.isArray(data)) {
      return { ok: false, users: [], error: "Could not load member list: unexpected response" };
    }
    return { ok: true, users: data as DirectoryUser[] };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, users: [], error: "aborted" };
    }
    return { ok: false, users: [], error: "Could not load member list: network error" };
  }
}

/** Case-insensitive match against name and (when present) email. */
export function matchesUserSearch(u: DirectoryUser, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (u.name ?? "").toLowerCase().includes(q) ||
    (u.email ?? "").toLowerCase().includes(q)
  );
}
