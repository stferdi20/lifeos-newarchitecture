import { apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';
import { normalizeResourceUrl } from '@/lib/resource-url';

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
  return res?.resource || null;
}

function isInstagramUrl(url = '') {
  return /instagram\.com\/(?:(?:share\/)?(?:reel|p|tv))\//i.test(String(url || ''));
}

export async function captureResourceFromUrl(payload = {}) {
  const normalizedUrl = normalizeResourceUrl(payload.url || '');
  const request = { ...payload, url: normalizedUrl };
  const res = await apiPost('/resources/capture', request);
  return {
    resource: res?.resource || null,
    queued: Boolean(res?.queued),
    job: res?.job || null,
    success: Boolean(res?.success),
    deduped: Boolean(res?.deduped),
  };
}

export async function createResourceFromUrl(payload = {}) {
  const normalizedUrl = normalizeResourceUrl(payload.url || '');
  const request = { ...payload, url: normalizedUrl };

  if (isInstagramUrl(normalizedUrl)) {
    const res = await apiPost('/resources/instagram-download', request);
    return {
      resource: res?.resource || null,
      queued: Boolean(res?.queued),
      job: res?.job || null,
      download: res?.download || null,
      success: Boolean(res?.success),
    };
  }

  const result = await captureResourceFromUrl(request);
  return {
    resource: result.resource,
    queued: result.queued,
    job: result.job,
    download: null,
    success: result.success,
    deduped: result.deduped,
  };
}

export async function reEnrichResources(payload = {}) {
  return apiPost('/resources/re-enrich', payload);
}

export async function retryResourceCapture(resourceId) {
  return apiPost(`/resources/${encodeURIComponent(resourceId)}/retry-capture`, {});
}
