import { apiGet, apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';

export const MediaEntry = createCrudApi({
  basePath: '/media',
  collectionKey: 'mediaEntries',
  itemKey: 'mediaEntry',
});

export function searchMedia(payload) {
  return apiPost('/media/search', payload);
}

export function enrichMedia(payload) {
  return apiPost('/media/enrich', payload);
}

export function fetchMediaHealthRaw() {
  return apiGet('/media/health');
}

export function bulkUpdateMediaEntries(payload) {
  return apiPost('/media/bulk-update', payload);
}
