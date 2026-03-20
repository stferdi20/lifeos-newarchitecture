import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

let envLoaded = false;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }

  return args;
}

function parseEnvFile(contents) {
  const entries = {};

  for (const rawLine of String(contents || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

export async function loadLocalEnv({ cwd = process.cwd() } = {}) {
  if (envLoaded) return;

  const candidates = [
    '.env',
    '.env.local',
  ];

  for (const relativePath of candidates) {
    const filePath = path.resolve(cwd, relativePath);
    try {
      const contents = await fs.readFile(filePath, 'utf8');
      const parsed = parseEnvFile(contents);
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in process.env) || process.env[key] === '') {
          process.env[key] = value;
        }
      }
    } catch {
      // Missing env files are expected in some setups.
    }
  }

  envLoaded = true;
}

export function getBase44Config() {
  return {
    appId: process.env.BASE44_APP_ID || process.env.VITE_BASE44_APP_ID || '',
    token: process.env.BASE44_ACCESS_TOKEN || process.env.BASE44_TOKEN || '',
    functionsVersion: process.env.BASE44_FUNCTIONS_VERSION || process.env.VITE_BASE44_FUNCTIONS_VERSION || '',
    appBaseUrl: process.env.BASE44_APP_BASE_URL || process.env.VITE_BASE44_APP_BASE_URL || '',
    serverUrl: process.env.BASE44_BACKEND_URL || process.env.VITE_BASE44_BACKEND_URL || '',
  };
}

export function createBase44MigrationClient() {
  const config = getBase44Config();
  if (!config.appId) {
    throw new Error('Missing BASE44_APP_ID or VITE_BASE44_APP_ID.');
  }

  const resolvedServerUrl = config.serverUrl || config.appBaseUrl || '';
  if (!resolvedServerUrl) {
    throw new Error('Missing BASE44_APP_BASE_URL or BASE44_BACKEND_URL.');
  }

  const baseApiUrl = new URL('/api', resolvedServerUrl).toString().replace(/\/$/, '');
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'X-App-Id': String(config.appId),
  };

  if (config.functionsVersion) {
    defaultHeaders['Base44-Functions-Version'] = config.functionsVersion;
  }

  if (config.token) {
    defaultHeaders.Authorization = `Bearer ${config.token}`;
  }

  async function request(method, endpoint, { query = null, body = undefined } = {}) {
    const url = new URL(`${baseApiUrl}${endpoint}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    const res = await fetch(url, {
      method,
      headers: defaultHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || `Base44 request failed with status ${res.status}.`);
    }
    return data;
  }

  const entities = new Proxy({}, {
    get(_target, entityName) {
      if (typeof entityName !== 'string' || entityName === 'then' || entityName.startsWith('_')) {
        return undefined;
      }

      const entityPath = `/apps/${encodeURIComponent(config.appId)}/entities/${encodeURIComponent(entityName)}`;
      return {
        async list(sort, limit, skip, fields) {
          return request('GET', entityPath, {
            query: {
              sort,
              limit,
              skip,
              fields: Array.isArray(fields) ? fields.join(',') : fields,
            },
          });
        },
        async filter(query, sort, limit, skip, fields) {
          return request('GET', entityPath, {
            query: {
              q: JSON.stringify(query || {}),
              sort,
              limit,
              skip,
              fields: Array.isArray(fields) ? fields.join(',') : fields,
            },
          });
        },
        async get(id) {
          return request('GET', `${entityPath}/${encodeURIComponent(id)}`);
        },
        async create(data) {
          return request('POST', entityPath, { body: data });
        },
        async update(id, data) {
          return request('PUT', `${entityPath}/${encodeURIComponent(id)}`, { body: data });
        },
        async delete(id) {
          return request('DELETE', `${entityPath}/${encodeURIComponent(id)}`);
        },
        async bulkCreate(data) {
          return request('POST', `${entityPath}/bulk`, { body: data });
        },
      };
    },
  });

  return { entities };
}

export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function safeEntityList(client, entityName, sort = '-created_date', limit = 1000) {
  try {
    const entity = client.entities?.[entityName];
    if (!entity?.list) return [];
    return await entity.list(sort, limit);
  } catch {
    return [];
  }
}

export function deterministicUuid(scope, sourceId) {
  const hash = createHash('sha256').update(`${scope}:${sourceId}`).digest('hex');
  const hex = `${hash.slice(0, 8)}${hash.slice(8, 12)}4${hash.slice(13, 16)}a${hash.slice(17, 20)}${hash.slice(20, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'workspace';
}

export function normalizeDateOnly(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 10);
}

export function normalizeLabels(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function normalizeChecklist(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          id: deterministicUuid('checklist-item', `${index}:${entry}`),
          text: entry.trim(),
          done: false,
          linked_task_id: '',
        };
      }

      return {
        id: entry?.id || deterministicUuid('checklist-item', `${index}:${entry?.text || 'item'}`),
        text: String(entry?.text || '').trim(),
        done: Boolean(entry?.done),
        linked_task_id: entry?.linked_task_id || '',
      };
    })
    .filter((entry) => entry.text);
}

export function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => ({
      id: entry?.id || deterministicUuid('attachment', `${index}:${entry?.name || entry?.url || 'attachment'}`),
      name: String(entry?.name || '').trim() || `Attachment ${index + 1}`,
      url: entry?.url || entry?.webViewLink || '',
      webViewLink: entry?.webViewLink || entry?.url || '',
      mimeType: entry?.mimeType || '',
      size: entry?.size ?? null,
      provider: entry?.provider || 'imported',
      file_type: entry?.file_type || '',
      storage_bucket: entry?.storage_bucket || null,
      storage_path: entry?.storage_path || null,
    }))
    .filter((entry) => entry.name);
}

export function isStandaloneTaskRecord(task) {
  const kind = String(task?.task_kind || task?.kind || task?.type || '').toLowerCase();
  if (kind === 'standalone' || kind === 'task') return true;
  if (task?.card_id || task?.source_checklist_item_id) return true;
  if (task?.project_id || task?.list_id) return false;
  return true;
}

export function inferLegacyListKey(task) {
  const status = String(task?.status || 'todo').toLowerCase();
  if (status === 'done' || status === 'completed') return 'done';
  if (status === 'archived') return 'archived';
  if (status === 'doing' || status === 'in_progress' || status === 'in-progress') return 'doing';
  return 'todo';
}

export async function ensureOutputDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJson(filePath, payload) {
  await ensureOutputDirectory(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}
