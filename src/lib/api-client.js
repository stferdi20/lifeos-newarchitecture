import { runtimeConfig } from '@/lib/runtime-config';
import { getSupabaseAccessToken } from '@/lib/supabase-browser';

async function request(method, path, body) {
  const headers = {
    'Content-Type': 'application/json',
  };

  const accessToken = await getSupabaseAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
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
