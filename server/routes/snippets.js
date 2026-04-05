import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '../lib/http.js';
import { requireUser } from '../lib/supabase.js';
import { safeJson } from '../lib/http.js';
import {
  createCompatEntity,
  deleteCompatEntity,
  getCompatEntity,
  listCompatEntities,
  updateCompatEntity,
} from '../services/compat-store.js';

const snippetRoutes = new Hono();

const baseSnippetSchema = z.object({
  title: z.string().trim().max(160).optional().nullable(),
  snippet_type: z.enum(['text', 'image']),
  body_text: z.string().nullable().optional(),
  plain_text_preview: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  storage_bucket: z.string().nullable().optional(),
  storage_path: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(24).optional(),
  workspace_id: z.string().nullable().optional(),
  is_favorite: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

const createSnippetSchema = baseSnippetSchema.superRefine((value, ctx) => {
  if (value.snippet_type === 'text') {
    if (!value.body_text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body_text'],
        message: 'Text snippets require body_text.',
      });
    }
    return;
  }

  if (!value.image_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['image_url'],
      message: 'Image snippets require image_url.',
    });
  }
  if (!value.storage_bucket?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['storage_bucket'],
      message: 'Image snippets require storage_bucket.',
    });
  }
  if (!value.storage_path?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['storage_path'],
      message: 'Image snippets require storage_path.',
    });
  }
});

const updateSnippetSchema = baseSnippetSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required.' },
);

function normalizeTags(tags = []) {
  const seen = new Set();
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function truncateSnippetText(value, maxLength = 72) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function findFirstMeaningfulLine(bodyText = '') {
  return String(bodyText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function deriveSnippetTitle({ snippetType, title = '', bodyText = '' }) {
  const explicitTitle = String(title || '').trim();
  if (explicitTitle) return explicitTitle;
  if (snippetType !== 'text') return '';
  return truncateSnippetText(findFirstMeaningfulLine(bodyText), 72);
}

function buildPlainTextPreview(bodyText = '', title = '') {
  const trimmedTitle = String(title || '').trim();
  const lines = String(bodyText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let previewSource = lines.join(' ');
  if (trimmedTitle) {
    const firstLine = lines[0] || '';
    if (firstLine.localeCompare(trimmedTitle, undefined, { sensitivity: 'accent' }) === 0) {
      previewSource = lines.slice(1).join(' ');
    } else if (firstLine.startsWith(trimmedTitle)) {
      const remainingFirstLine = firstLine.slice(trimmedTitle.length).trim();
      previewSource = [remainingFirstLine, ...lines.slice(1)].filter(Boolean).join(' ');
    }
  }

  const normalized = previewSource.replace(/\s+/g, ' ').trim();
  if (!normalized) return trimmedTitle;
  return truncateSnippetText(normalized, 220);
}

function normalizeSnippetPayload(payload = {}, existing = null) {
  const snippetType = payload.snippet_type || existing?.snippet_type || 'text';
  const bodyText = payload.body_text ?? existing?.body_text ?? null;
  const normalizedBodyText = bodyText == null ? null : String(bodyText);
  const imageUrl = payload.image_url ?? existing?.image_url ?? null;
  const title = deriveSnippetTitle({
    snippetType,
    title: payload.title ?? existing?.title ?? '',
    bodyText: normalizedBodyText || '',
  });

  const base = {
    ...existing,
    ...payload,
    title,
    snippet_type: snippetType,
    tags: normalizeTags(payload.tags ?? existing?.tags ?? []),
    workspace_id: payload.workspace_id ?? existing?.workspace_id ?? null,
    is_favorite: payload.is_favorite ?? existing?.is_favorite ?? false,
    copy_count: Number(payload.copy_count ?? existing?.copy_count ?? 0) || 0,
    last_copied_at: payload.last_copied_at ?? existing?.last_copied_at ?? null,
    metadata: payload.metadata ?? existing?.metadata ?? {},
  };

  if (snippetType === 'text') {
    return {
      ...base,
      title,
      body_text: normalizedBodyText,
      plain_text_preview: payload.plain_text_preview ?? buildPlainTextPreview(normalizedBodyText || '', title),
      image_url: null,
      storage_bucket: null,
      storage_path: null,
      mime_type: null,
      width: null,
      height: null,
    };
  }

  return {
    ...base,
    title,
    body_text: normalizedBodyText,
    plain_text_preview: payload.plain_text_preview ?? buildPlainTextPreview(normalizedBodyText || '', title),
    image_url: imageUrl,
    storage_bucket: payload.storage_bucket ?? existing?.storage_bucket ?? null,
    storage_path: payload.storage_path ?? existing?.storage_path ?? null,
    mime_type: payload.mime_type ?? existing?.mime_type ?? null,
    width: payload.width ?? existing?.width ?? null,
    height: payload.height ?? existing?.height ?? null,
  };
}

function assertNormalizedSnippet(record) {
  const parsed = createSnippetSchema.safeParse(record);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid snippet payload.');
  }
  return parsed.data;
}

async function parseAndNormalizeCreatePayload(c) {
  const body = await safeJson(c.req.raw);
  const parsed = createSnippetSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid snippet payload.');
  }
  return normalizeSnippetPayload(parsed.data);
}

async function parseAndNormalizeUpdatePayload(c, existing) {
  const body = await safeJson(c.req.raw);
  const parsed = updateSnippetSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid snippet update payload.');
  }
  const normalized = normalizeSnippetPayload(parsed.data, existing);
  assertNormalizedSnippet(normalized);
  return normalized;
}

snippetRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query();
  const snippets = await listCompatEntities(auth.user.id, 'Snippet', {
    filter: query.q ? JSON.parse(query.q) : {},
    sort: query.sort || '-updated_date',
    limit: query.limit,
    skip: query.skip,
    fields: query.fields ? query.fields.split(',') : null,
  });
  return c.json({ snippets });
});

snippetRoutes.post('/query', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const snippets = await listCompatEntities(auth.user.id, 'Snippet', {
    ...body,
    sort: body.sort || '-updated_date',
  });
  return c.json({ snippets });
});

snippetRoutes.post('/', async (c) => {
  const auth = await requireUser(c);
  const snippet = await createCompatEntity(auth.user.id, 'Snippet', await parseAndNormalizeCreatePayload(c));
  return c.json({ snippet }, 201);
});

snippetRoutes.get('/:recordId', async (c) => {
  const auth = await requireUser(c);
  const snippet = await getCompatEntity(auth.user.id, 'Snippet', c.req.param('recordId'));
  return c.json({ snippet });
});

snippetRoutes.patch('/:recordId', async (c) => {
  const auth = await requireUser(c);
  const existing = await getCompatEntity(auth.user.id, 'Snippet', c.req.param('recordId'));
  const snippet = await updateCompatEntity(
    auth.user.id,
    'Snippet',
    c.req.param('recordId'),
    await parseAndNormalizeUpdatePayload(c, existing),
  );
  return c.json({ snippet });
});

snippetRoutes.post('/:recordId/track-copy', async (c) => {
  const auth = await requireUser(c);
  const existing = await getCompatEntity(auth.user.id, 'Snippet', c.req.param('recordId'));
  const snippet = await updateCompatEntity(auth.user.id, 'Snippet', c.req.param('recordId'), {
    copy_count: (Number(existing.copy_count) || 0) + 1,
    last_copied_at: new Date().toISOString(),
  });
  return c.json({ snippet });
});

snippetRoutes.delete('/:recordId', async (c) => {
  const auth = await requireUser(c);
  const snippet = await deleteCompatEntity(auth.user.id, 'Snippet', c.req.param('recordId'));
  return c.json({ snippet });
});

export default snippetRoutes;
