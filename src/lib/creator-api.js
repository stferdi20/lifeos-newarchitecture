import { apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';

export const CreatorInspo = createCrudApi({
  basePath: '/creator-inspo',
  collectionKey: 'creators',
  itemKey: 'creator',
});

export function enrichCreator(payload) {
  return apiPost('/creator-inspo/enrich', payload);
}
