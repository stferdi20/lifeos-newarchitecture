import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const DEFAULT_TIMEZONE = 'Australia/Melbourne';

function buildTaskNotes(task: any, extras: Record<string, string> = {}) {
  const lines = [
    task.description || '',
    extras.workspace ? `Workspace: ${extras.workspace}` : '',
    extras.card ? `Card: ${extras.card}` : '',
    extras.source ? `Reminder source: ${extras.source}` : '',
  ].filter(Boolean);

  return lines.join('\n\n');
}

function normalizeChecklist(items: any[] = []) {
  return (items || [])
    .map((item) => {
      if (typeof item === 'string') {
        return { id: crypto.randomUUID(), text: item.trim(), done: false, linked_task_id: '' };
      }

      return {
        id: item?.id || crypto.randomUUID(),
        text: String(item?.text || '').trim(),
        done: Boolean(item?.done),
        linked_task_id: item?.linked_task_id || '',
      };
    })
    .filter((item) => item.text);
}

function toGoogleDue(task: any) {
  if (!task?.due_date) return undefined;

  const time = task?.due_time && /^\d{2}:\d{2}$/.test(task.due_time) ? task.due_time : '09:00';
  return new Date(`${task.due_date}T${time}:00`).toISOString();
}

function fromGoogleDue(due?: string) {
  if (!due) return { due_date: undefined, due_time: undefined };
  const parsed = new Date(due);
  if (Number.isNaN(parsed.getTime())) {
    return { due_date: due.slice(0, 10), due_time: undefined };
  }

  const iso = parsed.toISOString();
  const time = iso.slice(11, 16);
  return {
    due_date: iso.slice(0, 10),
    due_time: time === '00:00' ? undefined : time,
  };
}

function getLocalUpdatedAt(task: any) {
  return Date.parse(task?.updated_date || task?.created_date || '') || 0;
}

function getRemoteUpdatedAt(remoteTask: any) {
  return Date.parse(remoteTask?.updated || remoteTask?.completed || '') || 0;
}

async function gtasks(method: string, path: string, accessToken: string, body: any = null) {
  const res = await fetch(`${GOOGLE_TASKS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Tasks API error: ${err}`);
  }

  if (res.status === 204) return {};
  return res.json();
}

async function getDefaultTaskList(accessToken: string) {
  const data = await gtasks('GET', '/users/@me/lists?maxResults=20', accessToken);
  const list = (data.items || [])[0];
  if (!list?.id) throw new Error('No Google Task list is available for this account.');
  return list;
}

function buildRemoteTaskPayload(task: any, extras: Record<string, string> = {}) {
  const payload: Record<string, any> = {
    title: task.title || 'Untitled reminder',
    notes: buildTaskNotes(task, extras),
    status: task.status === 'done' ? 'completed' : 'needsAction',
  };

  const due = toGoogleDue(task);
  if (due) payload.due = due;
  return payload;
}

function buildReminderMetadata(source: string, remoteTask: any, listId: string) {
  return {
    google_task_id: remoteTask.id,
    google_task_list_id: listId,
    google_sync_status: 'linked',
    google_last_synced_at: new Date().toISOString(),
    reminder_enabled: true,
    reminder_source: source,
  };
}

async function persistTaskLink(base44: any, taskId: string, source: string, remoteTask: any, listId: string) {
  return base44.entities.Task.update(taskId, buildReminderMetadata(source, remoteTask, listId));
}

async function createOrUpdateRemoteTask(
  accessToken: string,
  task: any,
  extras: Record<string, string>,
  forceCreate = false,
) {
  const listId = task.google_task_list_id || (await getDefaultTaskList(accessToken)).id;
  const payload = buildRemoteTaskPayload(task, extras);

  if (!forceCreate && task.google_task_id) {
    const remoteTask = await gtasks(
      'PATCH',
      `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(task.google_task_id)}`,
      accessToken,
      payload,
    );
    return { remoteTask, listId };
  }

  const remoteTask = await gtasks(
    'POST',
    `/lists/${encodeURIComponent(listId)}/tasks`,
    accessToken,
    payload,
  );
  return { remoteTask, listId };
}

async function syncTaskWithGoogle(base44: any, accessToken: string, task: any) {
  if (!task?.google_task_id || !task?.google_task_list_id) return task;

  try {
    const remoteTask = await gtasks(
      'GET',
      `/lists/${encodeURIComponent(task.google_task_list_id)}/tasks/${encodeURIComponent(task.google_task_id)}`,
      accessToken,
    );

    const lastSyncedAt = Date.parse(task.google_last_synced_at || '') || 0;
    const localUpdatedAt = getLocalUpdatedAt(task);
    const remoteUpdatedAt = getRemoteUpdatedAt(remoteTask);

    const remoteHasChanges = remoteUpdatedAt > lastSyncedAt;
    const localHasChanges = localUpdatedAt > lastSyncedAt;

    if (remoteHasChanges && (!localHasChanges || remoteUpdatedAt >= localUpdatedAt)) {
      const due = fromGoogleDue(remoteTask.due);
      const updatedTask = await base44.entities.Task.update(task.id, {
        title: remoteTask.title || task.title,
        description: remoteTask.notes || task.description || '',
        status: remoteTask.status === 'completed' ? 'done' : (task.status === 'done' ? 'todo' : task.status),
        due_date: due.due_date,
        due_time: due.due_time,
        google_sync_status: 'linked',
        google_last_synced_at: new Date().toISOString(),
        reminder_enabled: true,
      });
      return updatedTask;
    }

    if (localHasChanges) {
      const extras = await getTaskSyncExtras(base44, task);
      const { remoteTask: patchedTask } = await createOrUpdateRemoteTask(accessToken, task, extras, false);
      const updatedTask = await base44.entities.Task.update(task.id, {
        google_sync_status: 'linked',
        google_last_synced_at: new Date().toISOString(),
        google_task_id: patchedTask.id,
        google_task_list_id: task.google_task_list_id,
        reminder_enabled: true,
      });
      return updatedTask;
    }

    return base44.entities.Task.update(task.id, {
      google_sync_status: 'linked',
      google_last_synced_at: new Date().toISOString(),
      reminder_enabled: true,
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('Requested entity was not found')) {
      return base44.entities.Task.update(task.id, {
        google_sync_status: 'disconnected',
        reminder_enabled: false,
      });
    }

    return base44.entities.Task.update(task.id, {
      google_sync_status: 'error',
    });
  }
}

async function loadCardContext(base44: any, cardId: string) {
  const card = await base44.entities.Card.get(cardId).catch(() => base44.entities.Task.get(cardId));
  if (!card) throw new Error('Card not found.');

  const workspaceId = card.workspace_id || card.project_id || '';
  let workspaceName = '';
  if (workspaceId) {
    const workspace = await base44.entities.Workspace.get(workspaceId)
      .catch(() => base44.entities.Project.get(workspaceId))
      .catch(() => null);
    workspaceName = workspace?.name || '';
  }

  return { card, workspaceId, workspaceName };
}

async function getTaskSyncExtras(base44: any, task: any) {
  const extras: Record<string, string> = {
    source: task?.reminder_source || 'task',
  };

  if (task?.workspace_id) {
    const workspace = await base44.entities.Workspace.get(task.workspace_id)
      .catch(() => base44.entities.Project.get(task.workspace_id))
      .catch(() => null);
    if (workspace?.name) extras.workspace = workspace.name;
  }

  if (task?.card_id) {
    const card = await base44.entities.Card.get(task.card_id)
      .catch(() => base44.entities.Task.get(task.card_id))
      .catch(() => null);
    if (card?.title) extras.card = card.title;
  }

  return extras;
}

async function upsertChecklistLink(base44: any, card: any, checklistItemId: string, taskId: string, doneOverride?: boolean) {
  const checklist = normalizeChecklist(card.checklist || []).map((item) => {
    if (item.id !== checklistItemId) return item;
    return {
      ...item,
      linked_task_id: taskId,
      done: typeof doneOverride === 'boolean' ? doneOverride : item.done,
    };
  });

  await (base44.entities.Card?.update
    ? base44.entities.Card.update(card.id, { checklist })
    : base44.entities.Task.update(card.id, { checklist }));

  return checklist;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googletasks');
    const body = await req.json();
    const { action } = body;

    if (action === 'createLinkedTask') {
      const task = await base44.entities.Task.get(body.taskId);
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 });

      const extras = await getTaskSyncExtras(base44, task);
      const { remoteTask, listId } = await createOrUpdateRemoteTask(accessToken, task, extras, !task.google_task_id);
      const updatedTask = await persistTaskLink(base44, task.id, task.reminder_source || 'task', remoteTask, listId);
      return Response.json({ task: updatedTask, googleTask: remoteTask });
    }

    if (action === 'updateLinkedTask') {
      const task = await base44.entities.Task.get(body.taskId);
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 });
      if (!task.google_task_id) return Response.json({ error: 'Task is not linked to Google' }, { status: 400 });

      const extras = await getTaskSyncExtras(base44, task);
      const { remoteTask, listId } = await createOrUpdateRemoteTask(accessToken, task, extras, false);
      const updatedTask = await persistTaskLink(base44, task.id, task.reminder_source || 'task', remoteTask, listId);
      return Response.json({ task: updatedTask, googleTask: remoteTask });
    }

    if (action === 'fetchLinkedTask') {
      const task = await base44.entities.Task.get(body.taskId);
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 });
      const updatedTask = await syncTaskWithGoogle(base44, accessToken, task);
      return Response.json({ task: updatedTask });
    }

    if (action === 'disconnectLinkedTask') {
      const task = await base44.entities.Task.get(body.taskId);
      if (!task) return Response.json({ error: 'Task not found' }, { status: 404 });
      const updatedTask = await base44.entities.Task.update(task.id, {
        google_sync_status: 'disconnected',
        reminder_enabled: false,
      });
      return Response.json({ task: updatedTask });
    }

    if (action === 'syncLinkedTasks') {
      const taskIds = Array.isArray(body.taskIds) ? body.taskIds.filter(Boolean) : [];
      const tasks = await Promise.all(taskIds.map(async (taskId: string) => {
        const task = await base44.entities.Task.get(taskId).catch(() => null);
        if (!task?.google_task_id) return task;
        return syncTaskWithGoogle(base44, accessToken, task);
      }));

      return Response.json({ tasks: tasks.filter(Boolean) });
    }

    if (action === 'createFromCard') {
      const { card, workspaceId, workspaceName } = await loadCardContext(base44, body.cardId);
      const existingTask = (await base44.entities.Task.filter({ card_id: card.id }).catch(() => []))
        .find((entry: any) => entry?.reminder_source === 'card');

      const task = existingTask
        ? await base44.entities.Task.update(existingTask.id, {
          title: existingTask.title || card.title,
          description: existingTask.description || card.description || '',
          due_date: existingTask.due_date || card.due_date || undefined,
          priority: existingTask.priority || card.priority || 'medium',
          status: card.status === 'done' ? 'done' : (existingTask.status || 'todo'),
          workspace_id: existingTask.workspace_id || workspaceId || undefined,
          card_id: card.id,
          reminder_source: 'card',
        })
        : await base44.entities.Task.create({
          task_kind: 'standalone',
          title: card.title || 'Card reminder',
          description: card.description || '',
          due_date: card.due_date || undefined,
          priority: card.priority || 'medium',
          status: card.status === 'done' ? 'done' : 'todo',
          workspace_id: workspaceId || undefined,
          card_id: card.id,
          reminder_source: 'card',
          reminder_enabled: true,
        });

      const { remoteTask, listId } = await createOrUpdateRemoteTask(accessToken, task, {
        workspace: workspaceName,
        card: card.title || '',
        source: 'card',
      }, !task.google_task_id);
      const updatedTask = await persistTaskLink(base44, task.id, 'card', remoteTask, listId);
      return Response.json({ task: updatedTask, googleTask: remoteTask });
    }

    if (action === 'createFromChecklist') {
      const { card, workspaceId, workspaceName } = await loadCardContext(base44, body.cardId);
      const checklist = normalizeChecklist(card.checklist || []);
      const checklistItem = checklist.find((item) => item.id === body.checklistItemId);
      if (!checklistItem) return Response.json({ error: 'Checklist item not found' }, { status: 404 });

      const existingTask = checklistItem.linked_task_id
        ? await base44.entities.Task.get(checklistItem.linked_task_id).catch(() => null)
        : null;

      const task = existingTask
        ? await base44.entities.Task.update(existingTask.id, {
          title: checklistItem.text,
          status: checklistItem.done ? 'done' : existingTask.status || 'todo',
          workspace_id: existingTask.workspace_id || workspaceId || undefined,
          card_id: card.id,
          source_checklist_item_id: checklistItem.id,
          reminder_source: 'checklist',
          reminder_enabled: true,
        })
        : await base44.entities.Task.create({
          task_kind: 'standalone',
          title: checklistItem.text,
          description: '',
          priority: card.priority || 'medium',
          status: checklistItem.done ? 'done' : 'todo',
          workspace_id: workspaceId || undefined,
          card_id: card.id,
          source_checklist_item_id: checklistItem.id,
          reminder_source: 'checklist',
          reminder_enabled: true,
        });

      await upsertChecklistLink(base44, card, checklistItem.id, task.id, checklistItem.done);

      const { remoteTask, listId } = await createOrUpdateRemoteTask(accessToken, task, {
        workspace: workspaceName,
        card: card.title || '',
        source: 'checklist',
      }, !task.google_task_id);
      const updatedTask = await persistTaskLink(base44, task.id, 'checklist', remoteTask, listId);
      return Response.json({ task: updatedTask, googleTask: remoteTask });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
