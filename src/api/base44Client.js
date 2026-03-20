import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import {
  createBoardCard,
  createBoardList,
  createBoardWorkspace,
  createCardComment,
  deleteBoardCard,
  deleteBoardList,
  deleteBoardWorkspace,
  listBoardCards,
  listBoardLists,
  listBoardWorkspaces,
  listCardActivity,
  listCardComments,
  listCardLinkedTasks,
  updateBoardCard,
  updateBoardList,
  updateBoardWorkspace,
  updateCardComment,
  createSignedUpload,
  signStoredFile,
} from '@/lib/projects-api';
import { getSupabaseBrowserClient, getSupabaseAccessToken } from '@/lib/supabase-browser';
import { runtimeConfig } from '@/lib/runtime-config';

const GENERIC_COMPAT_ENTITIES = new Set([
  'Habit',
  'HabitLog',
  'Resource',
  'LifeArea',
  'ProjectResource',
  'CardResource',
  'PromptTemplate',
  'Investment',
  'MediaEntry',
  'CreatorInspo',
  'Note',
  'Tool',
  'EventTemplate',
  'ProjectCategory',
]);

function decorateLegacyTimestamps(record) {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    created_date: record.created_date || record.created_at || new Date().toISOString(),
    updated_date: record.updated_date || record.updated_at || record.created_date || record.created_at || new Date().toISOString(),
  };
}

function normalizeFields(fields) {
  if (!fields) return null;
  return Array.isArray(fields) ? fields : String(fields).split(',').map((field) => field.trim()).filter(Boolean);
}

function compareFieldValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const dateA = Date.parse(a);
  const dateB = Date.parse(b);
  if (Number.isFinite(dateA) && Number.isFinite(dateB)) {
    return dateA - dateB;
  }

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function projectFields(record, fields) {
  if (!fields?.length) return record;
  const projected = { id: record.id };
  for (const field of fields) {
    if (field in record) projected[field] = record[field];
  }
  return projected;
}

function sortRows(rows = [], sort = '-created_date') {
  const token = String(sort || '-created_date');
  const descending = token.startsWith('-');
  const field = descending ? token.slice(1) : token;
  return [...rows].sort((left, right) => {
    const compared = compareFieldValues(left?.[field], right?.[field]);
    return descending ? -compared : compared;
  });
}

function matchesFilter(record, filter = {}) {
  return Object.entries(filter || {}).every(([key, expected]) => {
    const actual = record?.[key];
    if (Array.isArray(expected)) {
      return Array.isArray(actual) && expected.every((value) => actual.includes(value));
    }
    return actual === expected;
  });
}

function applyCollectionShape(rows = [], { filter = {}, sort = '-created_date', limit = 1000, skip = 0, fields = null } = {}) {
  const normalizedFields = normalizeFields(fields);
  return sortRows(
    rows
      .map(decorateLegacyTimestamps)
      .filter((row) => matchesFilter(row, filter)),
    sort,
  )
    .slice(skip, skip + limit)
    .map((row) => projectFields(row, normalizedFields));
}

async function listAllBoardLists() {
  const workspaces = await listBoardWorkspaces();
  const nested = await Promise.all(workspaces.map((workspace) => listBoardLists(workspace.id)));
  return nested.flat().map(decorateLegacyTimestamps);
}

async function listAllBoardCards() {
  const workspaces = await listBoardWorkspaces();
  const nested = await Promise.all(workspaces.map((workspace) => listBoardCards(workspace.id)));
  return nested.flat().map(decorateLegacyTimestamps);
}

async function listAllTasks() {
  const res = await apiGet('/tasks');
  return (res?.tasks || []).map(decorateLegacyTimestamps);
}

async function compatEntityList(entityName, sort, limit, skip, fields) {
  const res = await apiGet(`/compat/entities/${encodeURIComponent(entityName)}?${new URLSearchParams({
    ...(sort ? { sort } : {}),
    ...(limit ? { limit: String(limit) } : {}),
    ...(skip ? { skip: String(skip) } : {}),
    ...(fields ? { fields: normalizeFields(fields).join(',') } : {}),
  }).toString()}`);
  return (res?.rows || []).map(decorateLegacyTimestamps);
}

async function compatEntityFilter(entityName, query, sort, limit, skip, fields) {
  const res = await apiPost(`/compat/entities/${encodeURIComponent(entityName)}/query`, {
    filter: query || {},
    sort,
    limit,
    skip,
    fields: normalizeFields(fields),
  });
  return (res?.rows || []).map(decorateLegacyTimestamps);
}

async function compatEntityGet(entityName, id) {
  const res = await apiGet(`/compat/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`);
  return decorateLegacyTimestamps(res?.row || null);
}

async function compatEntityCreate(entityName, payload) {
  const res = await apiPost(`/compat/entities/${encodeURIComponent(entityName)}`, payload);
  return decorateLegacyTimestamps(res?.row || null);
}

async function compatEntityUpdate(entityName, id, payload) {
  const res = await apiPatch(`/compat/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, payload);
  return decorateLegacyTimestamps(res?.row || null);
}

async function compatEntityDelete(entityName, id) {
  const res = await apiDelete(`/compat/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`);
  return decorateLegacyTimestamps(res?.row || null);
}

async function compatEntityBulkCreate(entityName, payload) {
  const res = await apiPost(`/compat/entities/${encodeURIComponent(entityName)}/bulk`, payload);
  return (res?.rows || []).map(decorateLegacyTimestamps);
}

async function uploadCompatFile(file) {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error('Supabase browser client is not configured.');
  }

  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const safeName = String(file.name || 'file')
    .replace(ext, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file';
  const uploadPath = `compat/${Date.now()}-${safeName}${ext}`;
  const { upload, bucket } = await createSignedUpload(uploadPath);
  const { error } = await client.storage.from(bucket).uploadToSignedUrl(upload.path, upload.token, file);
  if (error) throw error;

  const signedUrl = await signStoredFile(bucket, upload.path, 60 * 60 * 24 * 365);
  return {
    file_url: signedUrl,
    fileUrl: signedUrl,
    url: signedUrl,
    bucket,
    path: upload.path,
  };
}

async function invokeLegacyCompatFunction(name, payload = {}) {
  return apiPost(`/compat/functions/${encodeURIComponent(name)}`, payload);
}

function createGenericEntityHandler(entityName) {
  return {
    async list(sort = '-created_date', limit = 1000, skip = 0, fields) {
      return compatEntityList(entityName, sort, limit, skip, fields);
    },
    async filter(query = {}, sort = '-created_date', limit = 1000, skip = 0, fields) {
      return compatEntityFilter(entityName, query, sort, limit, skip, fields);
    },
    async get(id) {
      return compatEntityGet(entityName, id);
    },
    async create(data) {
      return compatEntityCreate(entityName, data);
    },
    async update(id, data) {
      return compatEntityUpdate(entityName, id, data);
    },
    async delete(id) {
      return compatEntityDelete(entityName, id);
    },
    async bulkCreate(rows) {
      return compatEntityBulkCreate(entityName, rows);
    },
  };
}

function createCoreEntityHandler(entityName) {
  if (entityName === 'Workspace') {
    return {
      async list(sort = 'position', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listBoardWorkspaces(), { sort, limit, skip, fields });
      },
      async filter(query = {}, sort = 'position', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listBoardWorkspaces(), { filter: query, sort, limit, skip, fields });
      },
      async get(id) {
        return decorateLegacyTimestamps((await listBoardWorkspaces()).find((row) => row.id === id) || null);
      },
      async create(data) {
        return decorateLegacyTimestamps(await createBoardWorkspace(data));
      },
      async update(id, data) {
        return decorateLegacyTimestamps(await updateBoardWorkspace(id, data));
      },
      async delete(id) {
        return decorateLegacyTimestamps(await deleteBoardWorkspace(id));
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => createBoardWorkspace(row).then(decorateLegacyTimestamps)));
      },
    };
  }

  if (entityName === 'Project') {
    return {
      async list(sort = 'position', limit = 1000, skip = 0, fields) {
        const rows = (await listBoardWorkspaces()).map((workspace) => decorateLegacyTimestamps({
          ...workspace,
          status: workspace.is_archived ? 'archived' : 'active',
        }));
        return applyCollectionShape(rows, { sort, limit, skip, fields });
      },
      async filter(query = {}, sort = 'position', limit = 1000, skip = 0, fields) {
        const rows = (await this.list(sort, 5000, 0)).filter((row) => matchesFilter(row, query));
        return applyCollectionShape(rows, { sort, limit, skip, fields });
      },
      async get(id) {
        return decorateLegacyTimestamps((await this.list('-created_date', 5000, 0)).find((row) => row.id === id) || null);
      },
      async create(data) {
        return decorateLegacyTimestamps({
          ...(await createBoardWorkspace(data)),
          status: 'active',
        });
      },
      async update(id, data) {
        const updated = await updateBoardWorkspace(id, data);
        return decorateLegacyTimestamps({
          ...updated,
          status: updated.is_archived ? 'archived' : 'active',
        });
      },
      async delete(id) {
        return decorateLegacyTimestamps(await deleteBoardWorkspace(id));
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => this.create(row)));
      },
    };
  }

  if (entityName === 'List') {
    return {
      async list(sort = 'position', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listAllBoardLists(), { sort, limit, skip, fields });
      },
      async filter(query = {}, sort = 'position', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listAllBoardLists(), { filter: query, sort, limit, skip, fields });
      },
      async get(id) {
        return decorateLegacyTimestamps((await listAllBoardLists()).find((row) => row.id === id) || null);
      },
      async create(data) {
        return decorateLegacyTimestamps(await createBoardList(data));
      },
      async update(id, data) {
        return decorateLegacyTimestamps(await updateBoardList(id, data));
      },
      async delete(id) {
        return decorateLegacyTimestamps(await deleteBoardList(id));
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => createBoardList(row).then(decorateLegacyTimestamps)));
      },
    };
  }

  if (entityName === 'Card') {
    return {
      async list(sort = '-created_date', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listAllBoardCards(), { sort, limit, skip, fields });
      },
      async filter(query = {}, sort = '-created_date', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listAllBoardCards(), { filter: query, sort, limit, skip, fields });
      },
      async get(id) {
        return decorateLegacyTimestamps((await listAllBoardCards()).find((row) => row.id === id) || null);
      },
      async create(data) {
        return decorateLegacyTimestamps(await createBoardCard(data));
      },
      async update(id, data) {
        return decorateLegacyTimestamps(await updateBoardCard(id, data));
      },
      async delete(id) {
        return decorateLegacyTimestamps(await deleteBoardCard(id));
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => createBoardCard(row).then(decorateLegacyTimestamps)));
      },
    };
  }

  if (entityName === 'Task') {
    return {
      async list(sort = '-created_date', limit = 1000, skip = 0, fields) {
        return applyCollectionShape(await listAllTasks(), { sort, limit, skip, fields });
      },
      async filter(query = {}, sort = '-created_date', limit = 1000, skip = 0, fields) {
        if (query.card_id) {
          return applyCollectionShape(await listCardLinkedTasks(query.card_id), { sort, limit, skip, fields });
        }
        return applyCollectionShape(await listAllTasks(), { filter: query, sort, limit, skip, fields });
      },
      async get(id) {
        const rows = await listAllTasks();
        return decorateLegacyTimestamps(rows.find((row) => row.id === id) || null);
      },
      async create(data) {
        return decorateLegacyTimestamps((await apiPost('/tasks', data))?.task || null);
      },
      async update(id, data) {
        return decorateLegacyTimestamps((await apiPatch(`/tasks/${id}`, data))?.task || null);
      },
      async delete(id) {
        return decorateLegacyTimestamps((await apiDelete(`/tasks/${id}`))?.task || null);
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => apiPost('/tasks', row).then((res) => decorateLegacyTimestamps(res?.task || null))));
      },
    };
  }

  if (entityName === 'CardComment') {
    return {
      async list(_sort = '-created_date', _limit = 1000, _skip = 0) {
        return [];
      },
      async filter(query = {}, sort = '-created_date', limit = 1000, skip = 0, fields) {
        if (!query.card_id) return [];
        return applyCollectionShape(await listCardComments(query.card_id), { sort, limit, skip, fields });
      },
      async create(data) {
        if (!data?.card_id) throw new Error('CardComment requires card_id.');
        return decorateLegacyTimestamps(await createCardComment(data.card_id, data.body || ''));
      },
      async update(id, data) {
        return decorateLegacyTimestamps(await updateCardComment(id, data));
      },
      async delete(id) {
        return decorateLegacyTimestamps(await updateCardComment(id, { is_deleted: true }));
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => this.create(row)));
      },
    };
  }

  if (entityName === 'CardActivityEvent') {
    return {
      async list() {
        return [];
      },
      async filter(query = {}, sort = '-created_date', limit = 1000, skip = 0, fields) {
        if (!query.card_id) return [];
        return applyCollectionShape(await listCardActivity(query.card_id), { sort, limit, skip, fields });
      },
      async create(data) {
        return decorateLegacyTimestamps({
          id: crypto.randomUUID(),
          ...data,
          created_date: new Date().toISOString(),
        });
      },
      async update(id, data) {
        return decorateLegacyTimestamps({ id, ...data });
      },
      async delete(id) {
        return { id };
      },
      async bulkCreate(rows) {
        return Promise.all((rows || []).map((row) => this.create(row)));
      },
    };
  }

  return null;
}

const entitiesProxy = new Proxy({}, {
  get(_target, entityName) {
    if (typeof entityName !== 'string' || entityName === 'then' || entityName.startsWith('_')) {
      return undefined;
    }

    const special = createCoreEntityHandler(entityName);
    if (special) return special;

    if (GENERIC_COMPAT_ENTITIES.has(entityName)) {
      return createGenericEntityHandler(entityName);
    }

    return createGenericEntityHandler(entityName);
  },
});

async function authMe() {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error('Supabase browser client is not configured.');
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw error || new Error('Authentication required.');
  }

  return {
    id: data.user.id,
    email: data.user.email || '',
    full_name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || '',
    name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || '',
    role: data.user.user_metadata?.role || 'user',
  };
}

async function invokeCompatLlm(payload = {}) {
  const hasSchema = Boolean(payload.response_json_schema);
  const endpoint = hasSchema ? '/ai/structured' : '/ai/text';
  const res = await apiPost(endpoint, {
    taskType: hasSchema ? 'generic.structured' : 'generic.text',
    prompt: payload.prompt || '',
    policy: {
      tier: payload.model?.includes?.('pro') ? 'premium' : payload.model?.includes?.('flash') ? 'cheap' : 'standard',
      temperature: payload.temperature,
      maxTokens: payload.max_tokens || payload.maxTokens,
    },
    metadata: {
      requestSummary: String(payload.prompt || '').slice(0, 120),
    },
    groundWithGoogleSearch: Boolean(payload.add_context_from_internet),
  });

  return hasSchema ? res.data : (res.text || '');
}

export const base44 = {
  entities: entitiesProxy,
  auth: {
    me: authMe,
    async updateMe(data) {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error('Supabase browser client is not configured.');
      const { data: result, error } = await client.auth.updateUser({ data });
      if (error) throw error;
      return result.user;
    },
    redirectToLogin(nextUrl) {
      const target = nextUrl ? `/Login?next=${encodeURIComponent(nextUrl)}` : '/Login';
      window.location.assign(target);
    },
    logout(redirectUrl) {
      const client = getSupabaseBrowserClient();
      const nextUrl = redirectUrl || '/Login';
      client?.auth.signOut().finally(() => {
        window.location.assign(nextUrl);
      });
    },
    async isAuthenticated() {
      try {
        await authMe();
        return true;
      } catch {
        return false;
      }
    },
    async setToken(token) {
      if (!token) return;
      const client = getSupabaseBrowserClient();
      if (!client) return;
      await client.auth.setSession({
        access_token: token,
        refresh_token: token,
      }).catch(() => null);
    },
  },
  functions: {
    async invoke(functionName, data) {
      return invokeLegacyCompatFunction(functionName, data || {});
    },
  },
  integrations: {
    Core: {
      InvokeLLM: invokeCompatLlm,
      UploadFile: async ({ file }) => uploadCompatFile(file),
      async SearchWeb({ query }) {
        return invokeCompatLlm({
          prompt: `Search the web for "${query}" and return a concise plain-text summary with key links.`,
          add_context_from_internet: true,
        });
      },
    },
  },
  async setToken(token) {
    return this.auth.setToken(token);
  },
  getConfig() {
    return {
      serverUrl: runtimeConfig.apiBaseUrl,
      appId: 'lifeos-compat',
      requiresAuth: true,
    };
  },
  async getAccessToken() {
    return getSupabaseAccessToken();
  },
};
