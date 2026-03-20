import { HttpError, pickDefinedEntries, toSlug } from '../lib/http.js';
import { getAccessibleWorkspaceIds, getServiceRoleClient } from '../lib/supabase.js';

function normalizeTaskPayload(payload = {}) {
  return pickDefinedEntries({
    task_kind: payload.task_kind || 'standalone',
    title: payload.title?.trim() || '',
    description: payload.description?.trim() || null,
    status: payload.status || 'todo',
    priority: payload.priority || 'medium',
    due_date: payload.due_date || null,
    due_time: payload.due_time || null,
    workspace_id: payload.workspace_id || null,
    card_id: payload.card_id || null,
    source_checklist_item_id: payload.source_checklist_item_id || null,
    google_task_id: payload.google_task_id || null,
    google_task_list_id: payload.google_task_list_id || null,
    google_sync_status: payload.google_sync_status || null,
    google_last_synced_at: payload.google_last_synced_at || null,
    reminder_enabled: typeof payload.reminder_enabled === 'boolean' ? payload.reminder_enabled : false,
    reminder_source: payload.reminder_source || null,
  });
}

export async function listStandaloneTasksForUser(userId) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('tasks')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

export async function listWorkspacesForUser(userId) {
  const admin = getServiceRoleClient();
  const workspaceIds = await getAccessibleWorkspaceIds(userId);
  if (!workspaceIds.length) return [];

  const result = await admin
    .from('workspaces')
    .select('*')
    .in('id', workspaceIds)
    .order('position', { ascending: true });

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

export async function listCardsForUser(userId) {
  const admin = getServiceRoleClient();
  const workspaceIds = await getAccessibleWorkspaceIds(userId);
  if (!workspaceIds.length) return [];

  const result = await admin
    .from('cards')
    .select('id,title,workspace_id,list_id,due_date,created_at,updated_at')
    .in('workspace_id', workspaceIds)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

export async function getTaskForUser(userId, taskId) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Task not found.');
  return result.data;
}

export async function createTaskForUser(userId, payload) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('tasks')
    .insert({
      owner_user_id: userId,
      ...normalizeTaskPayload(payload),
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data;
}

export async function updateTaskForUser(userId, taskId, payload) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('tasks')
    .update(normalizeTaskPayload(payload))
    .eq('id', taskId)
    .eq('owner_user_id', userId)
    .select('*')
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Task not found.');
  return result.data;
}

export async function deleteTaskForUser(userId, taskId) {
  const admin = getServiceRoleClient();
  const existing = await getTaskForUser(userId, taskId);
  const result = await admin
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('owner_user_id', userId);

  if (result.error) throw new HttpError(500, result.error.message);
  return existing;
}

export async function createWorkspaceForUser(userId, payload) {
  const admin = getServiceRoleClient();
  const name = payload.name?.trim();
  if (!name) throw new HttpError(400, 'Workspace name is required.');

  const result = await admin
    .from('workspaces')
    .insert({
      owner_user_id: userId,
      name,
      slug: toSlug(name),
      position: payload.position ?? 0,
      is_archived: false,
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);

  await admin
    .from('workspace_memberships')
    .upsert({
      workspace_id: result.data.id,
      user_id: userId,
      role: 'owner',
    }, { onConflict: 'workspace_id,user_id' });

  return result.data;
}
