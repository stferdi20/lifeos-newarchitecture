#!/usr/bin/env node

import { chooseHeuristicArea, isWeakAreaAssignment } from '../server/services/resource-area-heuristics.js';

function stripText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseArgs(argv) {
  const result = {
    baseUrl: 'https://lifeos-self-hosted.vercel.app',
    token: process.env.LIFEOS_ACCESS_TOKEN || '',
    batchSize: 1,
    dryRun: false,
    skipInstagram: true,
    filters: {
      search: '',
      type: 'all',
      area_id: 'all',
      archived: 'active',
      project_id: '',
      tag: '',
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--base-url':
        result.baseUrl = next;
        index += 1;
        break;
      case '--token':
        result.token = next;
        index += 1;
        break;
      case '--batch-size':
        result.batchSize = Math.max(Number(next) || 1, 1);
        index += 1;
        break;
      case '--project-id':
        result.filters.project_id = next || '';
        index += 1;
        break;
      case '--search':
        result.filters.search = next || '';
        index += 1;
        break;
      case '--type':
        result.filters.type = next || 'all';
        index += 1;
        break;
      case '--area-id':
        result.filters.area_id = next || 'all';
        index += 1;
        break;
      case '--tag':
        result.filters.tag = next || '';
        index += 1;
        break;
      case '--archived':
        result.filters.archived = next || 'active';
        index += 1;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--include-instagram':
        result.skipInstagram = false;
        break;
      default:
        break;
    }
  }

  result.token = String(result.token || '').replace(/^['"]|['"]$/g, '');
  result.baseUrl = String(result.baseUrl || '').replace(/\/+$/, '');
  return result;
}

async function apiRequest(baseUrl, token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

function isInstagramResource(resource) {
  return ['instagram_reel', 'instagram_carousel'].includes(String(resource?.resource_type || ''));
}

function shouldIncludeResource(resource, filters, skipInstagram) {
  if (!resource || resource.is_archived) return false;
  if (skipInstagram && isInstagramResource(resource)) return false;
  if (String(resource.resource_type || '') === 'note') return false;
  if (filters.type !== 'all' && resource.resource_type !== filters.type) return false;
  if (filters.area_id !== 'all' && resource.area_id !== filters.area_id) return false;
  if (filters.tag && !(Array.isArray(resource.tags) ? resource.tags : []).includes(filters.tag)) return false;
  if (filters.search) {
    const haystack = [
      resource.title,
      resource.summary,
      resource.main_topic,
      resource.why_it_matters,
      resource.who_its_for,
      Array.isArray(resource.tags) ? resource.tags.join(' ') : '',
      resource.content,
    ].join(' ').toLowerCase();
    const terms = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

function buildPatchFromHeuristic(resource, areas) {
  if (!isWeakAreaAssignment({
    areaName: resource.area_name,
    areaNeedsReview: resource.area_needs_review,
  })) {
    return null;
  }

  const heuristic = chooseHeuristicArea({
    areas,
    title: resource.title,
    summary: resource.summary,
    whyItMatters: resource.why_it_matters,
    mainTopic: resource.main_topic,
    tags: resource.tags,
    description: resource.description || resource.article_description || resource.website_description || '',
    content: resource.content,
    resourceType: resource.resource_type,
  });

  if (!heuristic.areaName) return null;
  const area = areas.find((entry) => entry.name === heuristic.areaName);
  if (!area) return null;

  return {
    area_id: area.id,
    area_name: area.name,
    area_needs_review: heuristic.confidence !== 'high',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.token) {
    throw new Error('Missing access token. Pass --token or set LIFEOS_ACCESS_TOKEN.');
  }

  const me = await apiRequest(options.baseUrl, options.token, '/api/auth/me');
  console.log(`Authenticated as ${me.user?.email || me.user?.id || 'unknown user'}`);

  const [{ lifeAreas }, { resources }] = await Promise.all([
    apiRequest(options.baseUrl, options.token, '/api/life-areas'),
    apiRequest(options.baseUrl, options.token, '/api/resources/query', {
      method: 'POST',
      body: { sort: '-created_date', limit: 5000 },
    }),
  ]);

  const targets = (resources || [])
    .filter((resource) => shouldIncludeResource(resource, options.filters, options.skipInstagram));

  console.log(`Found ${targets.length} active non-IG resources to process.`);

  let updatedCount = 0;
  let correctedCount = 0;
  let failedCount = 0;
  let remainingKnowledgeCount = 0;
  let remainingNeedsReviewCount = 0;

  for (const resource of targets) {
    const beforeArea = stripText(resource.area_name);
    console.log(`\n[${resource.id}] ${stripText(resource.title || resource.url || resource.source_url)}`);
    console.log(`Before area: ${beforeArea || '(none)'}`);

    if (options.dryRun) {
      const dryRunPatch = buildPatchFromHeuristic(resource, lifeAreas || []);
      console.log(`Dry run only. Suggested correction: ${dryRunPatch?.area_name || 'none'}`);
      continue;
    }

    try {
      await apiRequest(options.baseUrl, options.token, '/api/resources/re-enrich', {
        method: 'POST',
        body: {
          resource_ids: [resource.id],
          batch_size: options.batchSize,
        },
      });

      const { resource: updatedResource } = await apiRequest(options.baseUrl, options.token, `/api/resources/${resource.id}`);
      updatedCount += 1;

      const patch = buildPatchFromHeuristic(updatedResource, lifeAreas || []);
      let corrected = false;
      let finalResource = updatedResource;

      if (patch) {
        const response = await apiRequest(options.baseUrl, options.token, `/api/resources/${resource.id}`, {
          method: 'PATCH',
          body: {
            ...updatedResource,
            ...patch,
            id: updatedResource.id,
            created_date: updatedResource.created_date,
          },
        });
        corrected = true;
        correctedCount += 1;
        finalResource = response.resource || finalResource;
      }

      if (stripText(finalResource.area_name).toLowerCase() === 'knowledge') remainingKnowledgeCount += 1;
      if (finalResource.area_needs_review) remainingNeedsReviewCount += 1;

      console.log(`After area: ${stripText(finalResource.area_name) || '(none)'}`);
      console.log(`Enrichment status: ${stripText(finalResource.enrichment_status) || '(none)'}`);
      console.log(`Needs review: ${finalResource.area_needs_review ? 'yes' : 'no'}`);
      console.log(`Manual correction: ${corrected ? 'yes' : 'no'}`);
    } catch (error) {
      failedCount += 1;
      console.error(`Failed: ${error.message}`);
    }
  }

  console.log('\nSummary');
  console.log(`Updated: ${updatedCount}`);
  console.log(`Corrected: ${correctedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Remaining Knowledge: ${remainingKnowledgeCount}`);
  console.log(`Remaining area_needs_review: ${remainingNeedsReviewCount}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
