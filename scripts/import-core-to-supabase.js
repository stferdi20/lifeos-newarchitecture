import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSupabaseAdminClient,
  deterministicUuid,
  inferLegacyListKey,
  isStandaloneTaskRecord,
  isUuid,
  loadLocalEnv,
  normalizeAttachments,
  normalizeChecklist,
  normalizeDateOnly,
  normalizeLabels,
  parseArgs,
  readJson,
  toSlug,
} from './core-migration-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.resolve(__dirname, '../migration-data/base44-core-export.json');

const LEGACY_LISTS = [
  { key: 'todo', name: 'To Do', position: 0 },
  { key: 'doing', name: 'In Progress', position: 10 },
  { key: 'done', name: 'Done', position: 20 },
  { key: 'archived', name: 'Archived', position: 30 },
];

function resolveMode(payload, requestedMode) {
  if (requestedMode && requestedMode !== 'auto') return requestedMode;

  const hasModernData = Boolean(
    payload?.modern?.workspaces?.length
    || payload?.modern?.lists?.length
    || payload?.modern?.cards?.length,
  );

  return hasModernData ? 'modern' : 'legacy';
}

function toWorkspaceRow(source, userId) {
  const slugBase = toSlug(source.name || source.id);
  const slugSuffix = String(source.id || '').replace(/[^a-zA-Z0-9]+/g, '').slice(-8).toLowerCase();
  return {
    id: deterministicUuid('workspace', source.id),
    owner_user_id: userId,
    name: source.name || `Workspace ${source.id}`,
    slug: slugSuffix ? `${slugBase}-${slugSuffix}`.slice(0, 80) : slugBase,
    position: source.position ?? 0,
    is_archived: Boolean(source.is_archived || source.status === 'archived'),
    drive_folder_id: source.drive_folder_id || null,
    metadata: {
      source: {
        provider: 'base44',
        model: 'workspace',
        id: source.id,
      },
    },
  };
}

function toListRow(source, workspaceId) {
  return {
    id: deterministicUuid('list', source.id),
    workspace_id: workspaceId,
    name: source.name || 'Untitled List',
    position: source.position ?? 0,
    is_archived: Boolean(source.is_archived),
    drive_folder_id: source.drive_folder_id || null,
  };
}

function toCardRow(source, workspaceId, listId, createdBy) {
  return {
    id: deterministicUuid('card', source.id),
    workspace_id: workspaceId,
    list_id: listId,
    created_by: createdBy,
    title: source.title || source.name || 'Untitled Card',
    description: source.description || null,
    status: source.status || 'todo',
    priority: source.priority || 'medium',
    start_date: normalizeDateOnly(source.start_date),
    due_date: normalizeDateOnly(source.due_date),
    due_time: source.due_time || null,
    position: source.position ?? source.sort_order ?? 0,
    drive_folder_id: source.drive_folder_id || null,
    checklist: normalizeChecklist(source.checklist),
    attached_files: normalizeAttachments(source.attached_files),
    labels: normalizeLabels(source.labels),
    cover: source.cover || null,
    estimate: source.estimate || null,
    dependencies: Array.isArray(source.dependencies) ? source.dependencies.filter(Boolean) : [],
    is_archived: Boolean(source.is_archived),
    metadata: {
      source: {
        provider: 'base44',
        model: 'card',
        id: source.id,
      },
    },
  };
}

function toStandaloneTaskRow(source, userId, workspaceId, cardId) {
  return {
    id: deterministicUuid('task', source.id),
    owner_user_id: userId,
    workspace_id: workspaceId || null,
    card_id: cardId || null,
    source_checklist_item_id: source.source_checklist_item_id || null,
    task_kind: source.task_kind || 'standalone',
    title: source.title || 'Untitled Task',
    description: source.description || null,
    status: source.status || 'todo',
    priority: source.priority || 'medium',
    due_date: normalizeDateOnly(source.due_date),
    due_time: source.due_time || null,
    google_task_id: source.google_task_id || null,
    google_task_list_id: source.google_task_list_id || null,
    google_sync_status: source.google_sync_status || null,
    google_last_synced_at: source.google_last_synced_at || null,
    reminder_enabled: Boolean(source.reminder_enabled),
    reminder_source: source.reminder_source || null,
    metadata: {
      source: {
        provider: 'base44',
        model: 'task',
        id: source.id,
      },
    },
  };
}

function toCommentRow(source, userId, workspaceId, cardId) {
  return {
    id: deterministicUuid('comment', source.id),
    workspace_id: workspaceId,
    card_id: cardId,
    author_user_id: userId,
    body: source.body || '',
    is_deleted: Boolean(source.is_deleted),
  };
}

function toAttachmentRows(cardRow, ownerUserId) {
  return normalizeAttachments(cardRow.attached_files).map((attachment, index) => ({
    id: deterministicUuid('card-attachment', `${cardRow.id}:${attachment.id || index}`),
    owner_user_id: ownerUserId,
    workspace_id: cardRow.workspace_id,
    card_id: cardRow.id,
    storage_bucket: attachment.storage_bucket || null,
    storage_path: attachment.storage_path || null,
    external_url: attachment.url || attachment.webViewLink || null,
    external_provider: attachment.provider || null,
    file_name: attachment.name,
    mime_type: attachment.mimeType || null,
    file_size: attachment.size ?? null,
    metadata: attachment,
  }));
}

async function upsertRows(admin, table, rows, onConflict = 'id') {
  if (!rows.length) return;
  const result = await admin.from(table).upsert(rows, { onConflict });
  if (result.error) {
    throw new Error(`Failed to upsert ${table}: ${result.error.message}`);
  }
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const input = path.resolve(process.cwd(), args.input || DEFAULT_INPUT);
  const payload = await readJson(input);
  const mode = resolveMode(payload, args.mode || 'auto');
  const userId = args['user-id'] || process.env.LIFEOS_MIGRATION_USER_ID || process.env.LIFEOS_DEV_USER_ID || '';

  if (!userId) {
    throw new Error('Missing --user-id, LIFEOS_MIGRATION_USER_ID, or LIFEOS_DEV_USER_ID for the import owner.');
  }
  if (!isUuid(userId)) {
    throw new Error('Import owner must be a valid Supabase auth user UUID.');
  }

  const admin = createSupabaseAdminClient();

  const workspaceRows = [];
  const listRows = [];
  const cardRows = [];
  const taskRows = [];
  const commentRows = [];
  const attachmentRows = [];

  if (mode === 'modern') {
    const workspaceIdMap = new Map();
    for (const workspace of payload.modern?.workspaces || []) {
      const row = toWorkspaceRow(workspace, userId);
      workspaceIdMap.set(workspace.id, row.id);
      workspaceRows.push(row);
    }

    for (const list of payload.modern?.lists || []) {
      const workspaceId = workspaceIdMap.get(list.workspace_id);
      if (!workspaceId) continue;
      listRows.push(toListRow(list, workspaceId));
    }

    const listIdMap = new Map((payload.modern?.lists || []).map((list) => [list.id, deterministicUuid('list', list.id)]));
    const cardIdMap = new Map();
    for (const card of payload.modern?.cards || []) {
      const workspaceId = workspaceIdMap.get(card.workspace_id);
      if (!workspaceId) continue;
      const row = toCardRow(card, workspaceId, listIdMap.get(card.list_id) || null, userId);
      cardRows.push(row);
      cardIdMap.set(card.id, row.id);
      attachmentRows.push(...toAttachmentRows(row, userId));
    }

    for (const task of (payload.modern?.tasks || []).filter(isStandaloneTaskRecord)) {
      taskRows.push(toStandaloneTaskRow(
        task,
        userId,
        workspaceIdMap.get(task.workspace_id) || null,
        cardIdMap.get(task.card_id) || null,
      ));
    }

    for (const comment of payload.modern?.comments || []) {
      const cardId = cardIdMap.get(comment.card_id);
      if (!cardId) continue;
      const sourceCard = (payload.modern?.cards || []).find((card) => card.id === comment.card_id);
      const workspaceId = workspaceIdMap.get(sourceCard?.workspace_id);
      if (!workspaceId) continue;
      commentRows.push(toCommentRow(comment, userId, workspaceId, cardId));
    }
  } else {
    const workspaceIdMap = new Map();
    for (const project of payload.legacy?.projects || []) {
      const row = toWorkspaceRow(project, userId);
      workspaceIdMap.set(project.id, row.id);
      workspaceRows.push(row);

      for (const legacyList of LEGACY_LISTS) {
        listRows.push({
          id: deterministicUuid('legacy-list', `${project.id}:${legacyList.key}`),
          workspace_id: row.id,
          name: legacyList.name,
          position: legacyList.position,
          is_archived: legacyList.key === 'archived',
          drive_folder_id: null,
        });
      }
    }

    for (const task of payload.legacy?.tasks || []) {
      const sourceWorkspaceId = task.project_id || task.workspace_id;
      const workspaceId = workspaceIdMap.get(sourceWorkspaceId);
      if (!workspaceId) continue;
      const legacyListKey = inferLegacyListKey(task);
      const listId = deterministicUuid('legacy-list', `${sourceWorkspaceId}:${legacyListKey}`);
      const row = toCardRow(
        {
          ...task,
          id: task.id,
          status: legacyListKey === 'doing' ? 'doing' : legacyListKey === 'done' ? 'done' : legacyListKey === 'archived' ? 'archived' : 'todo',
        },
        workspaceId,
        listId,
        userId,
      );
      cardRows.push(row);
      attachmentRows.push(...toAttachmentRows(row, userId));
    }
  }

  await upsertRows(admin, 'workspaces', workspaceRows);
  await upsertRows(
    admin,
    'workspace_memberships',
    workspaceRows.map((workspace) => ({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner',
    })),
    'workspace_id,user_id',
  );
  await upsertRows(admin, 'lists', listRows);
  await upsertRows(admin, 'cards', cardRows);
  await upsertRows(admin, 'tasks', taskRows);
  await upsertRows(admin, 'comments', commentRows);
  await upsertRows(admin, 'attachments', attachmentRows);

  console.log(JSON.stringify({
    input,
    mode,
    userId,
    imported: {
      workspaces: workspaceRows.length,
      lists: listRows.length,
      cards: cardRows.length,
      tasks: taskRows.length,
      comments: commentRows.length,
      attachments: attachmentRows.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
