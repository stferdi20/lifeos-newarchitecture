import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

function normalizeFields(fields) {
  if (!fields) return null;
  return Array.isArray(fields) ? fields : String(fields).split(',').map((field) => field.trim()).filter(Boolean);
}

function buildCollectionQuery({ sort, limit, skip, fields, filter } = {}) {
  const params = new URLSearchParams();
  if (sort) params.set('sort', sort);
  if (limit != null) params.set('limit', String(limit));
  if (skip != null) params.set('skip', String(skip));
  const normalizedFields = normalizeFields(fields);
  if (normalizedFields?.length) params.set('fields', normalizedFields.join(','));
  if (filter && Object.keys(filter).length) params.set('q', JSON.stringify(filter));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function createCrudApi({
  basePath,
  collectionKey,
  itemKey,
  defaultSort = '-created_date',
}) {
  return {
    async list(sort = defaultSort, limit = 1000, skip = 0, fields) {
      const res = await apiGet(`${basePath}${buildCollectionQuery({ sort, limit, skip, fields })}`);
      return res?.[collectionKey] || [];
    },
    async filter(filter = {}, sort = defaultSort, limit = 1000, skip = 0, fields) {
      const res = await apiPost(`${basePath}/query`, {
        filter,
        sort,
        limit,
        skip,
        fields: normalizeFields(fields),
      });
      return res?.[collectionKey] || [];
    },
    async get(id) {
      const res = await apiGet(`${basePath}/${encodeURIComponent(id)}`);
      return res?.[itemKey] || null;
    },
    async create(data) {
      const res = await apiPost(basePath, data);
      return res?.[itemKey] || null;
    },
    async update(id, data) {
      const res = await apiPatch(`${basePath}/${encodeURIComponent(id)}`, data);
      return res?.[itemKey] || null;
    },
    async delete(id) {
      const res = await apiDelete(`${basePath}/${encodeURIComponent(id)}`);
      return res?.[itemKey] || null;
    },
    async bulkCreate(rows) {
      const res = await apiPost(`${basePath}/bulk`, rows);
      return res?.[collectionKey] || [];
    },
  };
}
