// ────────────────────────────────────────────────────────────────
// The authenticated-fetch primitives.
//
// `requestJson` is the one place the server's `{ error: { code, message } }`
// envelope is unwrapped, so every hand-written endpoint reports the server's
// own reason rather than a status line. Lifted out of
// `components/changes/api.ts` (which re-exports it unchanged) when a second
// family of endpoints needed it: that module pulls in the auth provider, and
// the primitives have to stay importable without React or a device.
// ────────────────────────────────────────────────────────────────

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Parse `{ error: { code, message } }` bodies; fall back to the status text. */
export async function requestJson<T>(
  fetchImpl: AuthedFetch,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchImpl(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.message) message = body.error.message;
      code = body?.error?.code;
    } catch {
      // Not JSON; the status line is the best we have.
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
