import { runtimeConfig } from '@/lib/runtime-config';
import { recordResourceProfileApi } from '@/lib/resource-profile';
import { getSupabaseAccessToken } from '@/lib/supabase-browser';

async function request(method, path, body) {
  const headers = {
    'Content-Type': 'application/json',
  };

  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const tokenStartedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const accessToken = await getSupabaseAccessToken();
  const tokenFinishedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const res = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const fetchFinishedAt = typeof performance !== 'undefined' ? performance.now() : 0;

  const jsonStartedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const data = await res.json().catch(() => null);
  const jsonFinishedAt = typeof performance !== 'undefined' ? performance.now() : 0;

  recordResourceProfileApi({
    method,
    path,
    status: res.status,
    totalMs: startedAt ? jsonFinishedAt - startedAt : 0,
    tokenMs: tokenFinishedAt - tokenStartedAt,
    fetchMs: fetchFinishedAt - fetchStartedAt,
    jsonMs: jsonFinishedAt - jsonStartedAt,
  });

  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data;
}

export function apiGet(path) {
  return request('GET', path);
}

export function apiPost(path, body) {
  return request('POST', path, body);
}

export function apiPatch(path, body) {
  return request('PATCH', path, body);
}

export function apiDelete(path) {
  return request('DELETE', path);
}
