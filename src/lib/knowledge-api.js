import { apiGet } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';

export const Note = createCrudApi({
  basePath: '/notes',
  collectionKey: 'notes',
  itemKey: 'note',
});

export const Tool = createCrudApi({
  basePath: '/tools',
  collectionKey: 'tools',
  itemKey: 'tool',
});

export async function listKnowledgeGraphData() {
  const [notesRes, resourcesRes, toolsRes] = await Promise.all([
    apiGet('/notes'),
    apiGet('/resources'),
    apiGet('/tools'),
  ]);

  return {
    notes: notesRes?.notes || [],
    resources: resourcesRes?.resources || [],
    tools: toolsRes?.tools || [],
  };
}
