'use client';

import { useAuthStore } from './auth-store';

// Use a relative base so requests go through the same origin (HTTPS) and the
// reverse proxy forwards /api/* to the API service. Avoids mixed-content
// blocking when the dashboard is served over HTTPS.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Safely parses a response body as JSON; empty body resolves to `undefined`. */
async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text || text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON (e.g. plain-text error, HTML from a proxy) — return the raw text
    // so callers can surface it instead of crashing on `.json()`.
    return { raw: text };
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) headers.set('authorization', `Bearer ${token}`);
  }
  if (rest.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...rest, headers });

  if (res.status === 401 && auth && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init);
    useAuthStore.getState().logout();
  }

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed (${res.status})`;
    const body = await readJsonSafe(res);
    if (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)) {
      const err = (body as { error?: { code?: string; message?: string } }).error;
      code = err?.code ?? code;
      message = err?.message ?? message;
    } else if (body && typeof body === 'object' && 'raw' in (body as Record<string, unknown>)) {
      message = String((body as { raw: string }).raw).slice(0, 300) || message;
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  const data = await readJsonSafe(res);
  if (data === undefined) return undefined as T;
  // If the body was non-JSON, surface it as raw text rather than an object.
  if (data && typeof data === 'object' && 'raw' in (data as Record<string, unknown>)) {
    return (data as { raw: string }).raw as unknown as T;
  }
  return data as T;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken, updateTokens } = useAuthStore.getState();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await readJsonSafe(res)) as { accessToken: string; refreshToken: string };
      if (data && data.accessToken && data.refreshToken) {
        updateTokens(data.accessToken, data.refreshToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Revokes the current refresh token server-side (best-effort, fire-and-forget).
 * Used on logout so a stolen token cannot be replayed afterward.
 */
export async function logoutServer(): Promise<void> {
  const { accessToken, refreshToken } = useAuthStore.getState();
  if (!refreshToken) return;
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: accessToken ? `Bearer ${accessToken}` : '',
      },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    /* local logout still proceeds */
  }
}
