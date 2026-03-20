import { apiPost } from '@/lib/api-client';
import { createCardReminder, createChecklistReminder } from '@/lib/projects-api';
import { sanitizeTaskPayload, updateStandaloneTaskRecord } from '@/lib/tasks';

const GOOGLE_TASKS_APP_URL = 'https://tasks.google.com';

async function invokeGoogleTasks(action, payload = {}) {
  if (action === 'syncLinkedTasks') {
    return apiPost('/tasks/sync-linked', { taskIds: payload.taskIds || [] });
  }

  if (!payload.taskId) {
    throw new Error(`Google action "${action}" requires a task id.`);
  }

  const routeMap = {
    createLinkedTask: `/tasks/${payload.taskId}/reminder/create`,
    updateLinkedTask: `/tasks/${payload.taskId}/reminder/update`,
    fetchLinkedTask: `/tasks/${payload.taskId}/reminder/sync`,
    disconnectLinkedTask: `/tasks/${payload.taskId}/reminder/disconnect`,
  };

  return apiPost(routeMap[action], {});
}

export function isReminderLinked(task) {
  return Boolean(task?.reminder_enabled && task?.google_task_id);
}

export function getGoogleTasksAppUrl() {
  return GOOGLE_TASKS_APP_URL;
}

export async function createReminderForTask(taskId) {
  return invokeGoogleTasks('createLinkedTask', { taskId });
}

export async function updateReminderForTask(taskId) {
  return invokeGoogleTasks('updateLinkedTask', { taskId });
}

export async function syncReminderForTask(taskId) {
  return invokeGoogleTasks('fetchLinkedTask', { taskId });
}

export async function disconnectReminderForTask(taskId) {
  return invokeGoogleTasks('disconnectLinkedTask', { taskId });
}

export async function createReminderFromCard(cardId) {
  return { task: await createCardReminder(cardId) };
}

export async function createReminderFromChecklist(cardId, checklistItemId) {
  return { task: await createChecklistReminder(cardId, checklistItemId) };
}

export async function syncLinkedTasks(taskIds = []) {
  if (!taskIds.length) return { tasks: [] };
  return invokeGoogleTasks('syncLinkedTasks', { taskIds });
}

export async function updateTaskWithReminderSync(task, updates = {}) {
  const payload = sanitizeTaskPayload({ ...task, ...updates });
  const updatedTask = await updateStandaloneTaskRecord(task.id, payload);

  if (isReminderLinked(updatedTask)) {
    try {
      const syncRes = await updateReminderForTask(updatedTask.id);
      return syncRes?.task || updatedTask;
    } catch {
      return updatedTask;
    }
  }

  return updatedTask;
}
