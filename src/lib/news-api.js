import { apiGet } from '@/lib/api-client';

function buildQuery(params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });

  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function fetchNews({ query = '', category = 'general', limit = 8 } = {}) {
  return apiGet(`/news${buildQuery({ query, category, limit })}`);
}

export async function fetchTopNews({ limit = 4 } = {}) {
  return apiGet(`/news/top${buildQuery({ limit })}`);
}

export async function fetchTrends() {
  const res = await apiGet('/trends');
  return res?.trends || [];
}
