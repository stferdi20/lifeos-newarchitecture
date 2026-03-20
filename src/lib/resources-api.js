import { apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';

export const Resource = createCrudApi({
  basePath: '/resources',
  collectionKey: 'resources',
  itemKey: 'resource',
});

export const LifeArea = createCrudApi({
  basePath: '/life-areas',
  collectionKey: 'lifeAreas',
  itemKey: 'lifeArea',
  defaultSort: 'name',
});

export const ProjectResource = createCrudApi({
  basePath: '/project-resources',
  collectionKey: 'projectResources',
  itemKey: 'projectResource',
});

export const CardResource = createCrudApi({
  basePath: '/card-resources',
  collectionKey: 'cardResources',
  itemKey: 'cardResource',
});

export async function analyzeResourceUrl(payload) {
  const res = await apiPost('/resources/analyze', payload);
  return res?.analysis || null;
}
