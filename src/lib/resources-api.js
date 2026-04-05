import { apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';
import { normalizeResourceUrl } from '@/lib/resource-url';

export const RESOURCE_CARD_LIST_FIELDS = [
  'id',
  'resource_type',
  'title',
  'instagram_display_title',
  'author',
  'instagram_author_handle',
  'instagram_media_type_label',
  'instagram_review_state',
  'summary',
  'why_it_matters',
  'who_its_for',
  'explanation_for_newbies',
  'main_topic',
  'tags',
  'key_points',
  'actionable_points',
  'use_cases',
  'area_id',
  'is_archived',
  'status',
  'resource_score',
  'github_stars',
  'url',
  'created_date',
  'thumbnail',
  'drive_folder_url',
  'drive_files',
  'instagram_media_items',
  'download_status',
  'capture_status',
  'capture_status_message',
  'youtube_transcript_excerpt',
  'youtube_transcript_status',
  'enrichment_warning',
];

export const LIFE_AREA_FILTER_FIELDS = ['id', 'name', 'icon'];
export const PROJECT_RESOURCE_LINK_FIELDS = ['id', 'project_id', 'resource_id', 'note_id'];

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

export async function listResourceCards(limit = 200) {
  return Resource.list('-created_date', limit, 0, RESOURCE_CARD_LIST_FIELDS);
}

export async function listLifeAreaFilters() {
  return LifeArea.list('name', 1000, 0, LIFE_AREA_FILTER_FIELDS);
}

export async function listProjectResourceLinks(filter = {}, limit = 1000) {
  return ProjectResource.filter(filter, '-created_date', limit, 0, PROJECT_RESOURCE_LINK_FIELDS);
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
