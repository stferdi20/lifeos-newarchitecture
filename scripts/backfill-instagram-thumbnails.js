#!/usr/bin/env node

function parseArgs(argv) {
  const result = {
    baseUrl: 'https://lifeos-self-hosted.vercel.app',
    token: process.env.LIFEOS_ACCESS_TOKEN || '',
    limit: 500,
    dryRun: false,
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
      case '--limit':
        result.limit = Math.max(Number(next) || 1, 1);
        index += 1;
        break;
      case '--dry-run':
        result.dryRun = true;
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

function normalizeUrl(value = '') {
  return String(value || '').trim();
}

function isInstagramResource(resource = {}) {
  return ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(String(resource.resource_type || ''));
}

function isPublicSupabaseThumbnail(url = '') {
  return /\/storage\/v1\/object\/public\/resource-thumbnails\//i.test(String(url || ''));
}

function needsThumbnailRepair(resource = {}) {
  const thumbnail = normalizeUrl(resource.thumbnail);
  if (!thumbnail) return true;
  if (!/^https?:\/\//i.test(thumbnail)) return true;
  if (isPublicSupabaseThumbnail(thumbnail)) return false;
  if (/drive\.google|googleusercontent/i.test(thumbnail)) return true;
  return true;
}

function isQueuedOrProcessing(resource = {}) {
  return ['queued', 'processing'].includes(String(resource.download_status || ''));
}

function shouldRepairResource(resource = {}) {
  if (!isInstagramResource(resource)) return false;
  if (isQueuedOrProcessing(resource)) return true;
  return ['', 'uploaded', 'downloaded', 'complete', 'completed'].includes(String(resource.download_status || '')) && needsThumbnailRepair(resource);
}

async function repairResource(baseUrl, token, resource) {
  const response = await apiRequest(baseUrl, token, `/api/instagram-downloader/resources/${resource.id}/retry`, {
    method: 'POST',
  });
  return response;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.token) {
    throw new Error('Missing access token. Pass --token or set LIFEOS_ACCESS_TOKEN.');
  }

  const me = await apiRequest(options.baseUrl, options.token, '/api/auth/me');
  console.log(`Authenticated as ${me.user?.email || me.user?.id || 'unknown user'}`);

  const { resources = [] } = await apiRequest(options.baseUrl, options.token, '/api/resources/query', {
    method: 'POST',
    body: {
      sort: '-updated_date',
      limit: options.limit,
    },
  });

  const targets = resources.filter((resource) => shouldRepairResource(resource));
  console.log(`Found ${targets.length} Instagram resources that need queue or thumbnail repair.`);

  let queuedCount = 0;
  let repairedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const resource of targets) {
    const status = String(resource.download_status || 'unknown');
    const thumbnail = normalizeUrl(resource.thumbnail);
    const reason = isQueuedOrProcessing(resource)
      ? `queue state is ${status}`
      : `thumbnail is not stored in Supabase (${thumbnail || 'missing'})`;

    console.log(`\n[${resource.id}] ${String(resource.title || resource.url || resource.source_url || 'Instagram resource')}`);
    console.log(`Reason: ${reason}`);

    if (options.dryRun) {
      skippedCount += 1;
      continue;
    }

    try {
      await repairResource(options.baseUrl, options.token, resource);
      if (isQueuedOrProcessing(resource)) {
        queuedCount += 1;
      } else {
        repairedCount += 1;
      }
      console.log('Queued repair request successfully.');
    } catch (error) {
      failedCount += 1;
      console.error(`Repair failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\nSummary');
  console.log(`- queued or reconciled: ${queuedCount}`);
  console.log(`- thumbnail repairs triggered: ${repairedCount}`);
  console.log(`- skipped: ${skippedCount}`);
  console.log(`- failed: ${failedCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
