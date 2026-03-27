import { apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';

export const Snippet = createCrudApi({
  basePath: '/snippets',
  collectionKey: 'snippets',
  itemKey: 'snippet',
  defaultSort: '-updated_date',
});

export async function trackSnippetCopy(snippetId) {
  const res = await apiPost(`/snippets/${encodeURIComponent(snippetId)}/track-copy`, {});
  return res?.snippet || null;
}
