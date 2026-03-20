import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

export const STANDALONE_TASK_KIND = 'standalone';

const PRIORITY_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
};

export function createChecklistItem(text, extras = {}) {
  return {
    id: extras.id || createLocalId(),
    text: text?.trim?.() || '',
    done: Boolean(extras.done),
    linked_task_id: extras.linked_task_id || '',
  };
}

export function normalizeChecklistItems(items = []) {
  return items
    .map((item) => {
      if (typeof item === 'string') return createChecklistItem(item);
      return createChecklistItem(item?.text || '', item || {});
    })
    .filter((item) => item.text);
}

export function createLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `local_${Math.random().toString(36).slice(2, 10)}`;
}

export function isStandaloneTaskRecord(task) {
  if (!task) return false;

  const kind = String(task.task_kind || task.kind || task.type || '').toLowerCase();
  if (kind === STANDALONE_TASK_KIND || kind === 'task') return true;
  if (task.card_id || task.source_checklist_item_id) return true;
  if (task.project_id || task.list_id) return false;

  return true;
}

export function sanitizeTaskPayload(payload = {}) {
  const next = {
    task_kind: STANDALONE_TASK_KIND,
    title: payload.title?.trim?.() || '',
    status: payload.status || 'todo',
    priority: payload.priority || 'medium',
    due_date: payload.due_date || undefined,
    due_time: payload.due_time || undefined,
    description: payload.description?.trim?.() || undefined,
    workspace_id: payload.workspace_id || undefined,
    card_id: payload.card_id || undefined,
    source_checklist_item_id: payload.source_checklist_item_id || undefined,
    google_task_id: payload.google_task_id || undefined,
    google_task_list_id: payload.google_task_list_id || undefined,
    google_sync_status: payload.google_sync_status || undefined,
    google_last_synced_at: payload.google_last_synced_at || undefined,
    reminder_enabled: payload.reminder_enabled ?? undefined,
    reminder_source: payload.reminder_source || undefined,
  };

  return Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export async function listStandaloneTaskRecords() {
  const res = await apiGet('/tasks');
  const standaloneRows = (res?.tasks || []).filter(isStandaloneTaskRecord);
  const linkedTaskIds = standaloneRows
    .filter((task) => task?.reminder_enabled && task?.google_task_id)
    .map((task) => task.id);

  if (!linkedTaskIds.length) return standaloneRows;

  try {
    const syncRes = await apiPost('/tasks/sync-linked', { taskIds: linkedTaskIds });
    const syncedTasks = syncRes?.tasks || [];
    if (!syncedTasks.length) return standaloneRows;

    const syncedById = new Map(syncedTasks.map((task) => [task.id, task]));
    return standaloneRows.map((task) => syncedById.get(task.id) || task);
  } catch {
    return standaloneRows;
  }
}

export async function listWorkspaceRecords() {
  const res = await apiGet('/workspaces');
  return res?.workspaces || [];
}

export async function listCardRecords() {
  const res = await apiGet('/cards');
  return res?.cards || [];
}

export async function createStandaloneTaskRecord(payload) {
  const res = await apiPost('/tasks', sanitizeTaskPayload(payload));
  return res?.task;
}

export async function updateStandaloneTaskRecord(taskId, payload) {
  const res = await apiPatch(`/tasks/${taskId}`, sanitizeTaskPayload(payload));
  return res?.task;
}

export async function deleteStandaloneTaskRecord(taskId) {
  const res = await apiDelete(`/tasks/${taskId}`);
  return res?.task;
}

export function normalizeStandaloneTasks(tasks = [], workspaces = [], cards = []) {
  const workspaceById = new Map(
    (workspaces || [])
      .filter((workspace) => !workspace?.is_archived)
      .map((workspace) => [workspace.id, workspace])
  );
  const cardById = new Map((cards || []).map((card) => [card.id, card]));

  return [...(tasks || [])]
    .map((task) => normalizeStandaloneTask(task, workspaceById, cardById))
    .sort(compareStandaloneTasks);
}

export function normalizeStandaloneTask(task, workspaceById = new Map(), cardById = new Map()) {
  const workspace = workspaceById.get(task.workspace_id) || null;
  const card = cardById.get(task.card_id) || null;

  return {
    ...task,
    task_kind: STANDALONE_TASK_KIND,
    status: task.status || 'todo',
    priority: task.priority || 'medium',
    workspace_name: workspace?.name || '',
    card_title: card?.title || task.card_title || '',
    is_overdue: isTaskOverdue(task),
    due_bucket: getTaskDueBucket(task),
  };
}

export function compareStandaloneTasks(a, b) {
  const rankDiff = getTaskUrgencyRank(a) - getTaskUrgencyRank(b);
  if (rankDiff !== 0) return rankDiff;

  const dueA = getDueTimestamp(a);
  const dueB = getDueTimestamp(b);
  if (dueA !== dueB) {
    if (!Number.isFinite(dueA)) return 1;
    if (!Number.isFinite(dueB)) return -1;
    return dueA - dueB;
  }

  const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
  if (priorityDiff !== 0) return priorityDiff;

  const updatedA = Date.parse(a.updated_date || a.created_date || '') || 0;
  const updatedB = Date.parse(b.updated_date || b.created_date || '') || 0;
  return updatedB - updatedA;
}

export function getTaskUrgencyRank(task) {
  if (task.status === 'done') return 50;
  if (isTaskOverdue(task)) return 0;
  if (getTaskDueBucket(task) === 'today') return 1;
  if (task.priority === 'high') return 2;
  if (task.due_date) return 3;
  if (task.status === 'doing') return 4;
  return 5;
}

export function isTaskOverdue(task) {
  if (!task?.due_date || task.status === 'done') return false;
  const dueTimestamp = getDueTimestamp(task);
  return Number.isFinite(dueTimestamp) && dueTimestamp < Date.now();
}

export function getTaskDueBucket(task) {
  if (!task?.due_date) return 'none';
  if (isTaskOverdue(task)) return 'overdue';

  const today = new Date();
  const due = parseDueDate(task.due_date, task.due_time || '23:59');
  if (!due) return 'none';

  const sameYear = due.getFullYear() === today.getFullYear();
  const sameMonth = due.getMonth() === today.getMonth();
  const sameDay = due.getDate() === today.getDate();
  if (sameYear && sameMonth && sameDay) return 'today';

  return 'upcoming';
}

export function getDueTimestamp(task) {
  const due = parseDueDate(task?.due_date, task?.due_time || '23:59');
  return due ? due.getTime() : Number.POSITIVE_INFINITY;
}

export function parseDueDate(dateString, timeString = '23:59') {
  if (!dateString) return null;
  const safeTime = timeString && /^\d{2}:\d{2}$/.test(timeString) ? timeString : '23:59';
  const date = new Date(`${dateString}T${safeTime}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTaskDueLabel(task) {
  if (!task?.due_date) return 'No due date';

  const due = parseDueDate(task.due_date, task.due_time || '23:59');
  if (!due) return task.due_date;

  const dateLabel = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!task.due_time) return dateLabel;

  const timeLabel = due.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dateLabel} ${timeLabel}`;
}

export function getTaskCounts(tasks = []) {
  return tasks.reduce((acc, task) => {
    if (task.status === 'todo') acc.todo += 1;
    if (task.status === 'doing') acc.doing += 1;
    if (task.status === 'done') acc.done += 1;
    if (isTaskOverdue(task)) acc.overdue += 1;
    return acc;
  }, { todo: 0, doing: 0, done: 0, overdue: 0 });
}
