import { apiPost } from '@/lib/api-client';

export function searchTcgCards(payload) {
  return apiPost('/tcg/search', payload);
}

export function fetchTcgPrice(payload) {
  return apiPost('/tcg/price', payload);
}
