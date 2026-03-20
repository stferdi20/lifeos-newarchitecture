import { HttpError } from '../lib/http.js';
import { getCardForUser, listLinkedTasksForCard, updateCardForUser } from './boards.js';
import { getGoogleAccessToken } from './google.js';
import { getTaskForUser, updateTaskForUser } from './tasks.js';
import { createTaskForUser } from './tasks.js';

const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

function buildTaskNotes(task) {
  const lines = [
    task.description || '',
    task.workspace_name ? `Workspace: ${task.workspace_name}` : '',
    task.card_title ? `Card: ${task.card_title}` : '',
  ].filter(Boolean);

  return lines.join('\n\n');
}

function toGoogleDue(task) {
  if (!task?.due_date) return undefined;
  const time = task?.due_time && /^\d{2}:\d{2}$/.test(task.due_time) ? task.due_time : '09:00';
  return new Date(`${task.due_date}T${time}:00`).toISOString();
}

function fromGoogleDue(value) {
  if (!value) return { due_date: null, due_time: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { due_date: String(value).slice(0, 10), due_time: null };
  }

  return {
    due_date: date.toISOString().slice(0, 10),
    due_time: date.toISOString().slice(11, 16),
  };
}

async function googleTasksRequest(method, path, accessToken, body = null) {
  const res = await fetch(`${GOOGLE_TASKS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new HttpError(502, `Google Tasks API error: ${errorText}`);
  }

  if (res.status === 204) return {};
  return res.json();
}

async function getDefaultTaskList(accessToken) {
  const payload = await googleTasksRequest('GET', '/users/@me/lists?maxResults=20', accessToken);
  const list = payload.items?.[0];
  if (!list?.id) {
    throw new HttpError(409, 'No Google Task list is available for this account.');
  }
  return list;
}

function buildRemoteTaskPayload(task) {
  const payload = {
    title: task.title || 'Untitled task',
    notes: buildTaskNotes(task),
    status: task.status === 'done' ? 'completed' : 'needsAction',
  };

  const due = toGoogleDue(task);
  if (due) payload.due = due;

  return payload;
}

export async function createLinkedGoogleTask(userId, taskId) {
  const task = await getTaskForUser(userId, taskId);
  const accessToken = await getGoogleAccessToken(userId, 'tasks');
  const list = await getDefaultTaskList(accessToken);
  const remoteTask = await googleTasksRequest(
    'POST',
    `/lists/${encodeURIComponent(list.id)}/tasks`,
    accessToken,
    buildRemoteTaskPayload(task),
  );

  return updateTaskForUser(userId, taskId, {
    google_task_id: remoteTask.id,
    google_task_list_id: list.id,
    google_sync_status: 'linked',
    google_last_synced_at: new Date().toISOString(),
    reminder_enabled: true,
    reminder_source: task.reminder_source || 'task',
  });
}

export async function updateLinkedGoogleTask(userId, taskId) {
  const task = await getTaskForUser(userId, taskId);
  if (!task.google_task_id) {
    return createLinkedGoogleTask(userId, taskId);
  }

  const accessToken = await getGoogleAccessToken(userId, 'tasks');
  const listId = task.google_task_list_id || (await getDefaultTaskList(accessToken)).id;
  const remoteTask = await googleTasksRequest(
    'PATCH',
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(task.google_task_id)}`,
    accessToken,
    buildRemoteTaskPayload(task),
  );

  return updateTaskForUser(userId, taskId, {
    google_task_id: remoteTask.id,
    google_task_list_id: listId,
    google_sync_status: 'linked',
    google_last_synced_at: new Date().toISOString(),
    reminder_enabled: true,
  });
}

export async function fetchLinkedGoogleTask(userId, taskId) {
  const task = await getTaskForUser(userId, taskId);
  if (!task.google_task_id || !task.google_task_list_id) {
    throw new HttpError(409, 'This task is not linked to Google Tasks.');
  }

  const accessToken = await getGoogleAccessToken(userId, 'tasks');
  const remoteTask = await googleTasksRequest(
    'GET',
    `/lists/${encodeURIComponent(task.google_task_list_id)}/tasks/${encodeURIComponent(task.google_task_id)}`,
    accessToken,
  );

  const due = fromGoogleDue(remoteTask.due);
  return updateTaskForUser(userId, taskId, {
    title: remoteTask.title || task.title,
    description: remoteTask.notes || task.description,
    status: remoteTask.status === 'completed' ? 'done' : 'todo',
    due_date: due.due_date,
    due_time: due.due_time,
    google_sync_status: 'linked',
    google_last_synced_at: new Date().toISOString(),
    reminder_enabled: true,
  });
}

export async function disconnectLinkedGoogleTask(userId, taskId) {
  await getTaskForUser(userId, taskId);
  return updateTaskForUser(userId, taskId, {
    google_task_id: null,
    google_task_list_id: null,
    google_sync_status: 'disconnected',
    google_last_synced_at: new Date().toISOString(),
    reminder_enabled: false,
  });
}

export async function syncLinkedGoogleTasks(userId, taskIds = []) {
  const tasks = [];
  for (const taskId of taskIds) {
    try {
      const task = await fetchLinkedGoogleTask(userId, taskId);
      tasks.push(task);
    } catch {
      const fallbackTask = await getTaskForUser(userId, taskId).catch(() => null);
      if (fallbackTask) tasks.push(fallbackTask);
    }
  }
  return tasks;
}

export async function createReminderFromCard(userId, cardId) {
  const card = await getCardForUser(userId, cardId);
  const existingTasks = await listLinkedTasksForCard(userId, cardId);
  const existingReminder = existingTasks.find((entry) => entry.reminder_enabled && entry.google_task_id && !entry.source_checklist_item_id);
  if (existingReminder) return existingReminder;

  const createdTask = await createTaskForUser(userId, {
    title: card.title,
    description: card.description || '',
    status: card.status === 'done' ? 'done' : 'todo',
    priority: card.priority || 'medium',
    due_date: card.due_date || undefined,
    workspace_id: card.workspace_id,
    card_id: card.id,
    reminder_source: 'card',
  });

  return createLinkedGoogleTask(userId, createdTask.id);
}

export async function createReminderFromChecklist(userId, cardId, checklistItemId) {
  const card = await getCardForUser(userId, cardId);
  const checklist = Array.isArray(card.checklist) ? card.checklist : [];
  const item = checklist.find((entry) => entry?.id === checklistItemId);
  if (!item?.text) {
    throw new HttpError(404, 'Checklist item not found.');
  }

  if (item.linked_task_id) {
    const linkedTask = await getTaskForUser(userId, item.linked_task_id).catch(() => null);
    if (linkedTask?.google_task_id) return linkedTask;
  }

  const createdTask = await createTaskForUser(userId, {
    title: item.text,
    status: item.done ? 'done' : 'todo',
    priority: card.priority || 'medium',
    due_date: card.due_date || undefined,
    workspace_id: card.workspace_id,
    card_id: card.id,
    source_checklist_item_id: checklistItemId,
    reminder_source: 'checklist',
  });

  const nextChecklist = checklist.map((entry) => (
    entry.id === checklistItemId
      ? { ...entry, linked_task_id: createdTask.id, done: createdTask.status === 'done' }
      : entry
  ));

  await updateCardForUser(userId, card.id, { checklist: nextChecklist });
  return createLinkedGoogleTask(userId, createdTask.id);
}
