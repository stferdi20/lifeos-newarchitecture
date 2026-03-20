import { apiGet } from '@/lib/api-client';

export async function fetchNews(query = 'technology') {
  const res = await apiGet(`/news?query=${encodeURIComponent(query)}`);
  return res?.articles || [];
}

export async function fetchTrends() {
  const res = await apiGet('/trends');
  return res?.trends || [];
}
