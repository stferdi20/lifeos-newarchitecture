import { HttpError } from '../lib/http.js';
import { getServiceRoleClient } from '../lib/supabase.js';

export const GENERIC_COMPAT_ENTITIES = new Set([
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

function assertEntity(entityType) {
  if (!GENERIC_COMPAT_ENTITIES.has(entityType)) {
    throw new HttpError(404, `Compat entity "${entityType}" is not supported.`);
  }
}

function coerceFields(fields) {
  if (!fields) return null;
  if (Array.isArray(fields)) return fields.map((field) => String(field).trim()).filter(Boolean);
  return String(fields)
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

function getRecordDate(record, key) {
  const value = record?.[key]
    ?? record?.[`${key}_date`]
    ?? record?.[`${key}_at`]
    ?? null;
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;

  const dateA = getRecordDate({ value: a }, 'value');
  const dateB = getRecordDate({ value: b }, 'value');
  if (dateA !== null && dateB !== null) return dateA - dateB;

  return String(a).localeCompare(String(b));
}

function matchesFilter(record, filter = {}) {
  return Object.entries(filter || {}).every(([key, expected]) => {
    const actual = record?.[key];

    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return false;
      return expected.every((value) => actual.includes(value));
    }

    if (expected && typeof expected === 'object') {
      if ('$in' in expected) {
        return expected.$in.includes(actual);
      }
      if ('$contains' in expected) {
        if (Array.isArray(actual)) return actual.includes(expected.$contains);
        return String(actual || '').toLowerCase().includes(String(expected.$contains || '').toLowerCase());
      }
    }

    if (actual != null && expected != null && String(actual) === String(expected)) {
      return true;
    }

    return actual === expected;
  });
}

function sortRecords(records = [], sort = '-created_date') {
  const token = String(sort || '-created_date');
  const descending = token.startsWith('-');
  const field = descending ? token.slice(1) : token;

  return [...records].sort((left, right) => {
    const leftValue = left?.[field]
      ?? left?.[field.replace(/_date$/, '_at')]
      ?? left?.[field.replace(/_at$/, '_date')]
      ?? null;
    const rightValue = right?.[field]
      ?? right?.[field.replace(/_date$/, '_at')]
      ?? right?.[field.replace(/_at$/, '_date')]
      ?? null;

    const compared = compareValues(leftValue, rightValue);
    return descending ? -compared : compared;
  });
}

function projectFields(record, fields) {
  if (!fields?.length) return record;
  const projected = { id: record.id };
  for (const field of fields) {
    if (field in record) {
      projected[field] = record[field];
    }
  }
  return projected;
}

function normalizeStoredRecord(row) {
  const data = row?.data && typeof row.data === 'object' ? { ...row.data } : {};
  if (!data.id) data.id = row.record_id;
  if (!data.created_date && row.created_at) data.created_date = row.created_at;
  if (!data.updated_date && row.updated_at) data.updated_date = row.updated_at;
  return data;
}

function withEntityMetadata(record, id = crypto.randomUUID()) {
  const now = new Date().toISOString();
  return {
    ...record,
    id: record?.id || id,
    created_date: record?.created_date || record?.created_at || now,
    updated_date: now,
  };
}

async function fetchRows(userId, entityType) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('legacy_entity_records')
    .select('record_id,data,created_at,updated_at')
    .eq('owner_user_id', userId)
    .eq('entity_type', entityType);

  if (result.error) {
    throw new HttpError(500, result.error.message);
  }

  return (result.data || []).map(normalizeStoredRecord);
}

export async function listCompatEntities(userId, entityType, options = {}) {
  assertEntity(entityType);
  const filter = options.filter || {};
  const fields = coerceFields(options.fields);
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 5000);
  const skip = Math.max(Number(options.skip) || 0, 0);
  const sort = options.sort || '-created_date';

  const records = fetchRows(userId, entityType)
    .then((rows) => rows.filter((row) => matchesFilter(row, filter)));

  const sorted = sortRecords(await records, sort);
  return sorted.slice(skip, skip + limit).map((record) => projectFields(record, fields));
}

export async function getCompatEntity(userId, entityType, recordId) {
  assertEntity(entityType);
  const admin = getServiceRoleClient();
  const result = await admin
    .from('legacy_entity_records')
    .select('record_id,data,created_at,updated_at')
    .eq('owner_user_id', userId)
    .eq('entity_type', entityType)
    .eq('record_id', recordId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, `${entityType} record not found.`);
  return normalizeStoredRecord(result.data);
}

export async function createCompatEntity(userId, entityType, payload = {}) {
  assertEntity(entityType);
  const admin = getServiceRoleClient();
  const record = withEntityMetadata(payload);

  const result = await admin
    .from('legacy_entity_records')
    .upsert({
      entity_type: entityType,
      owner_user_id: userId,
      record_id: record.id,
      data: record,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'entity_type,owner_user_id,record_id' })
    .select('record_id,data,created_at,updated_at')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeStoredRecord(result.data);
}

export async function bulkCreateCompatEntities(userId, entityType, payload = []) {
  assertEntity(entityType);
  const admin = getServiceRoleClient();
  const now = new Date().toISOString();
  const records = (Array.isArray(payload) ? payload : [])
    .map((entry) => withEntityMetadata(entry))
    .map((entry) => ({
      entity_type: entityType,
      owner_user_id: userId,
      record_id: entry.id,
      data: entry,
      updated_at: now,
    }));

  if (!records.length) return [];

  const result = await admin
    .from('legacy_entity_records')
    .upsert(records, { onConflict: 'entity_type,owner_user_id,record_id' })
    .select('record_id,data,created_at,updated_at');

  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || []).map(normalizeStoredRecord);
}

export async function updateCompatEntity(userId, entityType, recordId, payload = {}) {
  const existing = await getCompatEntity(userId, entityType, recordId);
  const admin = getServiceRoleClient();
  const merged = withEntityMetadata({
    ...existing,
    ...payload,
    id: recordId,
    created_date: existing.created_date || existing.created_at,
  }, recordId);

  const result = await admin
    .from('legacy_entity_records')
    .update({
      data: merged,
      updated_at: new Date().toISOString(),
    })
    .eq('entity_type', entityType)
    .eq('owner_user_id', userId)
    .eq('record_id', recordId)
    .select('record_id,data,created_at,updated_at')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeStoredRecord(result.data);
}

export async function deleteCompatEntity(userId, entityType, recordId) {
  const existing = await getCompatEntity(userId, entityType, recordId);
  const admin = getServiceRoleClient();
  const result = await admin
    .from('legacy_entity_records')
    .delete()
    .eq('entity_type', entityType)
    .eq('owner_user_id', userId)
    .eq('record_id', recordId);

  if (result.error) throw new HttpError(500, result.error.message);
  return existing;
}
