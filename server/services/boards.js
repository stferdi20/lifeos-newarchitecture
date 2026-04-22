import { HttpError, pickDefinedEntries, toSlug } from '../lib/http.js';
import { getAccessibleWorkspaceIds, getServiceRoleClient } from '../lib/supabase.js';

const DEFAULT_LISTS = [
  { name: 'Backlog', position: 0 },
  { name: 'To Do', position: 10 },
  { name: 'In Progress', position: 20 },
  { name: 'Done', position: 30 },
  { name: 'Archived', position: 40 },
];

function normalizeListName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLabels(value) {
  return normalizeArray(value)
    .map((entry) => ({
      id: entry?.id || crypto.randomUUID(),
      text: String(entry?.text || '').trim(),
      color: String(entry?.color || '#64748b'),
    }))
    .filter((entry) => entry.text);
}

function normalizeChecklist(value) {
  return normalizeArray(value)
    .map((entry) => ({
      id: entry?.id || crypto.randomUUID(),
      text: String(entry?.text || '').trim(),
      done: Boolean(entry?.done),
      linked_task_id: entry?.linked_task_id || '',
    }))
    .filter((entry) => entry.text);
}

function normalizeAttachments(value) {
  return normalizeArray(value)
    .map((entry) => ({
      id: entry?.id || crypto.randomUUID(),
      name: String(entry?.name || '').trim() || 'Untitled attachment',
      url: entry?.url || entry?.webViewLink || '',
      webViewLink: entry?.webViewLink || entry?.url || '',
      mimeType: entry?.mimeType || '',
      size: entry?.size ?? null,
      provider: entry?.provider || 'supabase_storage',
      file_type: entry?.file_type || inferAttachmentType(entry),
      created_at: entry?.created_at || new Date().toISOString(),
      storage_bucket: entry?.storage_bucket || null,
      storage_path: entry?.storage_path || null,
    }))
    .filter((entry) => entry.name);
}

function inferAttachmentType(entry) {
  if (entry?.mimeType?.startsWith('image/')) return 'image';
  if (entry?.mimeType === 'application/pdf') return 'pdf';
  if (entry?.provider === 'link') return 'link';
  return 'file';
}

function normalizeDependencies(value) {
  return normalizeArray(value).map((entry) => String(entry)).filter(Boolean);
}

function mapWorkspace(workspace) {
  return {
    id: workspace.id,
    name: workspace.name || '',
    position: workspace.position ?? 0,
    is_archived: Boolean(workspace.is_archived),
    drive_folder_id: workspace.drive_folder_id || '',
  };
}

function mapList(list) {
  return {
    id: list.id,
    workspace_id: list.workspace_id,
    name: list.name || '',
    position: list.position ?? 0,
    is_archived: Boolean(list.is_archived),
  };
}

function mapCard(card) {
  return {
    id: card.id,
    workspace_id: card.workspace_id,
    list_id: card.list_id || '',
    title: card.title || '',
    description: card.description || '',
    status: card.status || 'todo',
    priority: card.priority || 'medium',
    start_date: card.start_date || '',
    due_date: card.due_date || '',
    position: card.position ?? 0,
    labels: normalizeLabels(card.labels),
    checklist: normalizeChecklist(card.checklist),
    attached_files: normalizeAttachments(card.attached_files),
    cover: card.cover || null,
    estimate: card.estimate || '',
    dependencies: normalizeDependencies(card.dependencies),
    drive_folder_id: card.drive_folder_id || '',
    is_archived: Boolean(card.is_archived),
    created_at: card.created_at || null,
    updated_at: card.updated_at || null,
  };
}

function mapComment(comment) {
  return {
    id: comment.id,
    card_id: comment.card_id,
    author_id: comment.author_user_id || null,
    body: comment.body || '',
    is_deleted: Boolean(comment.is_deleted),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
}

function mapActivity(event) {
  return {
    id: event.id,
    card_id: event.card_id,
    actor_id: event.actor_id || null,
    type: event.type,
    metadata: event.metadata || null,
    created_at: event.created_at,
  };
}

function normalizeCardPayload(payload = {}) {
  return pickDefinedEntries({
    workspace_id: payload.workspace_id || null,
    list_id: payload.list_id || null,
    title: payload.title?.trim() || '',
    description: payload.description?.trim() || null,
    status: payload.status || 'todo',
    priority: payload.priority || 'medium',
    start_date: payload.start_date || null,
    due_date: payload.due_date || null,
    position: payload.position ?? 0,
    labels: normalizeLabels(payload.labels),
    checklist: normalizeChecklist(payload.checklist),
    attached_files: normalizeAttachments(payload.attached_files),
    cover: payload.cover || null,
    estimate: payload.estimate || null,
    dependencies: normalizeDependencies(payload.dependencies),
    drive_folder_id: payload.drive_folder_id || null,
    is_archived: typeof payload.is_archived === 'boolean' ? payload.is_archived : false,
  });
}

function normalizeListPayload(payload = {}) {
  return pickDefinedEntries({
    workspace_id: payload.workspace_id,
    name: payload.name?.trim() || '',
    position: payload.position ?? 0,
    is_archived: typeof payload.is_archived === 'boolean' ? payload.is_archived : false,
  });
}

function normalizeWorkspacePayload(payload = {}) {
  return pickDefinedEntries({
    name: payload.name?.trim() || '',
    slug: toSlug(payload.name || payload.slug || ''),
    position: payload.position ?? 0,
    is_archived: typeof payload.is_archived === 'boolean' ? payload.is_archived : false,
    drive_folder_id: payload.drive_folder_id || null,
  });
}

async function ensureWorkspaceAccess(userId, workspaceId) {
  const accessibleWorkspaceIds = await getAccessibleWorkspaceIds(userId);
  if (!accessibleWorkspaceIds.includes(workspaceId)) {
    throw new HttpError(404, 'Workspace not found.');
  }
}

async function ensureDefaultListsForWorkspace(admin, workspaceId, lists = []) {
  const listsByName = new Map(lists.map((list) => [normalizeListName(list.name), list]));
  const inserts = [];
  const updates = [];

  for (const defaultList of DEFAULT_LISTS) {
    const existing = listsByName.get(normalizeListName(defaultList.name));
    if (!existing) {
      inserts.push({
        workspace_id: workspaceId,
        name: defaultList.name,
        position: defaultList.position,
        is_archived: false,
      });
      continue;
    }

    if (existing.is_archived || existing.position !== defaultList.position) {
      updates.push(
        admin
          .from('lists')
          .update({
            position: defaultList.position,
            is_archived: false,
          })
          .eq('id', existing.id),
      );
    }
  }

  if (inserts.length) {
    const insertResult = await admin.from('lists').insert(inserts);
    if (insertResult.error) throw new HttpError(500, insertResult.error.message);
  }

  const updateResults = await Promise.all(updates);
  const updateError = updateResults.find((result) => result.error)?.error;
  if (updateError) throw new HttpError(500, updateError.message);

  return inserts.length > 0 || updates.length > 0;
}

export async function listBoardWorkspacesForUser(userId) {
  const admin = getServiceRoleClient();
  const workspaceIds = await getAccessibleWorkspaceIds(userId);
  if (!workspaceIds.length) return [];

  const result = await admin
    .from('workspaces')
    .select('*')
    .in('id', workspaceIds)
    .order('position', { ascending: true });

  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || []).map(mapWorkspace);
}

export async function createBoardWorkspaceForUser(userId, payload) {
  const admin = getServiceRoleClient();
  const normalized = normalizeWorkspacePayload(payload);
  if (!normalized.name) throw new HttpError(400, 'Workspace name is required.');

  const created = await admin
    .from('workspaces')
    .insert({
      owner_user_id: userId,
      ...normalized,
    })
    .select('*')
    .single();

  if (created.error) throw new HttpError(500, created.error.message);

  await admin.from('workspace_memberships').upsert({
    workspace_id: created.data.id,
    user_id: userId,
    role: 'owner',
  }, { onConflict: 'workspace_id,user_id' });

  const defaultListsInsert = await admin
    .from('lists')
    .insert(DEFAULT_LISTS.map((list) => ({
      workspace_id: created.data.id,
      name: list.name,
      position: list.position,
      is_archived: false,
    })));

  if (defaultListsInsert.error) throw new HttpError(500, defaultListsInsert.error.message);

  return mapWorkspace(created.data);
}

export async function updateBoardWorkspaceForUser(userId, workspaceId, payload) {
  await ensureWorkspaceAccess(userId, workspaceId);
  const admin = getServiceRoleClient();
  const normalized = normalizeWorkspacePayload(payload);
  if (payload.name !== undefined && !normalized.name) {
    throw new HttpError(400, 'Workspace name is required.');
  }

  const result = await admin
    .from('workspaces')
    .update(normalized)
    .eq('id', workspaceId)
    .select('*')
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Workspace not found.');
  return mapWorkspace(result.data);
}

export async function deleteBoardWorkspaceForUser(userId, workspaceId) {
  await ensureWorkspaceAccess(userId, workspaceId);
  const admin = getServiceRoleClient();
  const result = await admin.from('workspaces').delete().eq('id', workspaceId).eq('owner_user_id', userId);
  if (result.error) throw new HttpError(500, result.error.message);
  return { id: workspaceId };
}

export async function listListsForWorkspace(userId, workspaceId) {
  await ensureWorkspaceAccess(userId, workspaceId);
  const admin = getServiceRoleClient();
  const fetchLists = () => admin
    .from('lists')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true });

  const result = await fetchLists();
  if (result.error) throw new HttpError(500, result.error.message);

  const didRepairDefaults = await ensureDefaultListsForWorkspace(admin, workspaceId, result.data || []);
  if (!didRepairDefaults) return (result.data || []).map(mapList);

  const repairedResult = await fetchLists();
  if (repairedResult.error) throw new HttpError(500, repairedResult.error.message);
  return (repairedResult.data || []).map(mapList);
}

export async function createListForWorkspace(userId, payload) {
  await ensureWorkspaceAccess(userId, payload.workspace_id);
  const admin = getServiceRoleClient();
  const normalized = normalizeListPayload(payload);
  if (!normalized.name) throw new HttpError(400, 'List name is required.');

  const result = await admin
    .from('lists')
    .insert(normalized)
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return mapList(result.data);
}

export async function updateListForWorkspace(userId, listId, payload) {
  const admin = getServiceRoleClient();
  const existing = await admin.from('lists').select('*').eq('id', listId).maybeSingle();
  if (existing.error) throw new HttpError(500, existing.error.message);
  if (!existing.data) throw new HttpError(404, 'List not found.');
  await ensureWorkspaceAccess(userId, existing.data.workspace_id);

  const normalized = normalizeListPayload({ ...existing.data, ...payload });
  const result = await admin
    .from('lists')
    .update(normalized)
    .eq('id', listId)
    .select('*')
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'List not found.');
  return mapList(result.data);
}

export async function deleteListForWorkspace(userId, listId) {
  const admin = getServiceRoleClient();
  const existing = await admin.from('lists').select('*').eq('id', listId).maybeSingle();
  if (existing.error) throw new HttpError(500, existing.error.message);
  if (!existing.data) throw new HttpError(404, 'List not found.');
  await ensureWorkspaceAccess(userId, existing.data.workspace_id);

  const result = await admin.from('lists').delete().eq('id', listId);
  if (result.error) throw new HttpError(500, result.error.message);
  return { id: listId };
}

export async function listCardsForWorkspace(userId, workspaceId, options = {}) {
  await ensureWorkspaceAccess(userId, workspaceId);
  const admin = getServiceRoleClient();
  let query = admin
    .from('cards')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true });

  if (!options.includeArchived) {
    query = query.eq('is_archived', false).neq('status', 'archived');
  }

  const result = await query;
  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || []).map(mapCard);
}

export async function getCardForUser(userId, cardId) {
  const admin = getServiceRoleClient();
  const result = await admin.from('cards').select('*').eq('id', cardId).maybeSingle();
  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Card not found.');
  await ensureWorkspaceAccess(userId, result.data.workspace_id);
  return result.data;
}

export async function createCardForUser(userId, payload) {
  await ensureWorkspaceAccess(userId, payload.workspace_id);
  const admin = getServiceRoleClient();
  const normalized = normalizeCardPayload(payload);
  if (!normalized.title) throw new HttpError(400, 'Card title is required.');

  const result = await admin
    .from('cards')
    .insert({
      created_by: userId,
      ...normalized,
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return mapCard(result.data);
}

export async function updateCardForUser(userId, cardId, payload) {
  const admin = getServiceRoleClient();
  const existing = await getCardForUser(userId, cardId);
  const normalized = normalizeCardPayload({ ...existing, ...payload });
  if (payload.title !== undefined && !normalized.title) throw new HttpError(400, 'Card title is required.');

  const result = await admin
    .from('cards')
    .update(normalized)
    .eq('id', cardId)
    .select('*')
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Card not found.');

  if (payload.title !== undefined && existing.title !== normalized.title) {
    await logActivityEvent({
      workspace_id: existing.workspace_id,
      card_id: existing.id,
      actor_id: userId,
      type: 'card_renamed',
      metadata: {
        from: existing.title,
        to: normalized.title,
      },
    }).catch(() => null);
  }

  return mapCard(result.data);
}

export async function deleteCardForUser(userId, cardId) {
  const admin = getServiceRoleClient();
  const existing = await getCardForUser(userId, cardId);
  const result = await admin.from('cards').delete().eq('id', cardId);
  if (result.error) throw new HttpError(500, result.error.message);
  return mapCard(existing);
}

export async function reorderCardsForUser(userId, updates) {
  const admin = getServiceRoleClient();
  const cardIds = updates.map((entry) => entry.id);
  if (!cardIds.length) return [];

  const existingResult = await admin.from('cards').select('*').in('id', cardIds);
  if (existingResult.error) throw new HttpError(500, existingResult.error.message);

  const existingCards = existingResult.data || [];
  const existingById = new Map(existingCards.map((card) => [card.id, card]));
  const listIds = [...new Set(updates.map((entry) => entry.list_id).filter(Boolean))];
  const listsResult = listIds.length ? await admin.from('lists').select('*').in('id', listIds) : { data: [] };
  if (listsResult.error) throw new HttpError(500, listsResult.error.message);
  const listsById = new Map((listsResult.data || []).map((list) => [list.id, list]));

  for (const update of updates) {
    const existing = existingById.get(update.id);
    if (!existing) throw new HttpError(404, `Card ${update.id} not found.`);
    await ensureWorkspaceAccess(userId, existing.workspace_id);

    const nextList = listsById.get(update.list_id);
    if (!nextList || nextList.workspace_id !== existing.workspace_id) {
      throw new HttpError(400, 'Cards can only be reordered within lists of the same workspace.');
    }
  }

  const updatedCards = [];
  for (const update of updates) {
    const existing = existingById.get(update.id);
    const result = await admin
      .from('cards')
      .update({
        list_id: update.list_id,
        status: update.status || existing.status,
        position: update.position ?? existing.position ?? 0,
      })
      .eq('id', update.id)
      .select('*')
      .single();

    if (result.error) throw new HttpError(500, result.error.message);
    updatedCards.push(result.data);

    if (existing.list_id !== update.list_id) {
      await logActivityEvent({
        workspace_id: existing.workspace_id,
        card_id: existing.id,
        actor_id: userId,
        type: 'card_moved',
        metadata: {
          from: existing.list_id,
          to: update.list_id,
          from_name: listsById.get(existing.list_id)?.name || null,
          to_name: listsById.get(update.list_id)?.name || null,
        },
      }).catch(() => null);
    }
  }

  return updatedCards.map(mapCard);
}

export async function listLinkedTasksForCard(userId, cardId) {
  const card = await getCardForUser(userId, cardId);
  const admin = getServiceRoleClient();
  const result = await admin
    .from('tasks')
    .select('*')
    .eq('card_id', card.id)
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false });

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

export async function listCardCommentsForUser(userId, cardId) {
  const card = await getCardForUser(userId, cardId);
  const admin = getServiceRoleClient();
  const result = await admin
    .from('comments')
    .select('*')
    .eq('card_id', card.id)
    .order('created_at', { ascending: true });

  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || []).map(mapComment);
}

export async function createCardCommentForUser(userId, cardId, payload) {
  const card = await getCardForUser(userId, cardId);
  const admin = getServiceRoleClient();
  const result = await admin
    .from('comments')
    .insert({
      workspace_id: card.workspace_id,
      card_id: card.id,
      author_user_id: userId,
      body: payload.body?.trim() || '',
      is_deleted: false,
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);

  await logActivityEvent({
    workspace_id: card.workspace_id,
    card_id: card.id,
    actor_id: userId,
    type: 'comment_added',
    metadata: null,
  }).catch(() => null);

  return mapComment(result.data);
}

export async function updateCardCommentForUser(userId, commentId, payload) {
  const admin = getServiceRoleClient();
  const existing = await admin.from('comments').select('*').eq('id', commentId).maybeSingle();
  if (existing.error) throw new HttpError(500, existing.error.message);
  if (!existing.data) throw new HttpError(404, 'Comment not found.');
  await ensureWorkspaceAccess(userId, existing.data.workspace_id);

  const result = await admin
    .from('comments')
    .update({
      body: payload.body?.trim() || '',
      is_deleted: typeof payload.is_deleted === 'boolean' ? payload.is_deleted : existing.data.is_deleted,
    })
    .eq('id', commentId)
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return mapComment(result.data);
}

export async function listCardActivityForUser(userId, cardId) {
  const card = await getCardForUser(userId, cardId);
  const admin = getServiceRoleClient();
  const result = await admin
    .from('activity_events')
    .select('*')
    .eq('card_id', card.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || []).map(mapActivity);
}

export async function logActivityEvent(payload) {
  if (!payload?.card_id || !payload?.workspace_id || !payload?.type) return null;

  const admin = getServiceRoleClient();
  const result = await admin
    .from('activity_events')
    .insert({
      workspace_id: payload.workspace_id,
      card_id: payload.card_id,
      actor_id: payload.actor_id || null,
      type: payload.type,
      metadata: payload.metadata || null,
    })
    .select('*')
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  return mapActivity(result.data);
}

export async function addCardAttachmentMetadataForUser(userId, cardId, payload) {
  const admin = getServiceRoleClient();
  const card = await getCardForUser(userId, cardId);
  const attachments = normalizeAttachments([...(card.attached_files || []), payload]);
  const addedAttachment = attachments[attachments.length - 1];

  const updateResult = await admin
    .from('cards')
    .update({ attached_files: attachments })
    .eq('id', card.id)
    .select('*')
    .single();

  if (updateResult.error) throw new HttpError(500, updateResult.error.message);

  await admin
    .from('attachments')
    .insert({
      owner_user_id: userId,
      workspace_id: card.workspace_id,
      card_id: card.id,
      storage_bucket: addedAttachment.storage_bucket,
      storage_path: addedAttachment.storage_path,
      external_url: addedAttachment.url || null,
      external_provider: addedAttachment.provider || null,
      file_name: addedAttachment.name,
      mime_type: addedAttachment.mimeType || null,
      file_size: addedAttachment.size ?? null,
      metadata: addedAttachment,
    })
    .then(() => null)
    .catch(() => null);

  await logActivityEvent({
    workspace_id: card.workspace_id,
    card_id: card.id,
    actor_id: userId,
    type: 'attachment_added',
    metadata: {
      attachment_name: addedAttachment.name,
    },
  }).catch(() => null);

  return {
    attachment: addedAttachment,
    card: mapCard(updateResult.data),
  };
}

export async function removeCardAttachmentMetadataForUser(userId, cardId, attachmentId) {
  const admin = getServiceRoleClient();
  const card = await getCardForUser(userId, cardId);
  const attachments = normalizeAttachments(card.attached_files || []).filter((entry) => entry.id !== attachmentId);

  const result = await admin
    .from('cards')
    .update({ attached_files: attachments })
    .eq('id', card.id)
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return mapCard(result.data);
}
