import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

export function listBoardWorkspaces() {
  return apiGet('/workspaces').then((res) => res.workspaces || []);
}

export function createBoardWorkspace(payload) {
  return apiPost('/workspaces', payload).then((res) => res.workspace);
}

export function updateBoardWorkspace(workspaceId, payload) {
  return apiPatch(`/workspaces/${workspaceId}`, payload).then((res) => res.workspace);
}

export function deleteBoardWorkspace(workspaceId) {
  return apiDelete(`/workspaces/${workspaceId}`).then((res) => res.workspace);
}

export function listBoardLists(workspaceId) {
  return apiGet(`/lists?workspace_id=${encodeURIComponent(workspaceId)}`).then((res) => res.lists || []);
}

export function createBoardList(payload) {
  return apiPost('/lists', payload).then((res) => res.list);
}

export function updateBoardList(listId, payload) {
  return apiPatch(`/lists/${listId}`, payload).then((res) => res.list);
}

export function deleteBoardList(listId) {
  return apiDelete(`/lists/${listId}`).then((res) => res.list);
}

export function listBoardCards(workspaceId) {
  return apiGet(`/cards?workspace_id=${encodeURIComponent(workspaceId)}`).then((res) => res.cards || []);
}

export function createBoardCard(payload) {
  return apiPost('/cards', payload).then((res) => res.card);
}

export function updateBoardCard(cardId, payload) {
  return apiPatch(`/cards/${cardId}`, payload).then((res) => res.card);
}

export function deleteBoardCard(cardId) {
  return apiDelete(`/cards/${cardId}`).then((res) => res.card);
}

export function reorderBoardCards(updates) {
  return apiPost('/cards/reorder', { updates }).then((res) => res.cards || []);
}

export function listCardComments(cardId) {
  return apiGet(`/cards/${cardId}/comments`).then((res) => res.comments || []);
}

export function createCardComment(cardId, body) {
  return apiPost(`/cards/${cardId}/comments`, { body }).then((res) => res.comment);
}

export function updateCardComment(commentId, payload) {
  return apiPatch(`/cards/comments/${commentId}`, payload).then((res) => res.comment);
}

export function listCardActivity(cardId) {
  return apiGet(`/cards/${cardId}/activity`).then((res) => res.activities || []);
}

export function listCardLinkedTasks(cardId) {
  return apiGet(`/cards/${cardId}/linked-tasks`).then((res) => res.tasks || []);
}

export function syncCardLinkedTasks(cardId, taskIds) {
  return apiPost(`/cards/${cardId}/linked-tasks/sync`, { taskIds }).then((res) => res.tasks || []);
}

export function addCardAttachmentMetadata(cardId, payload) {
  return apiPost(`/cards/${cardId}/attachments/metadata`, payload);
}

export function removeCardAttachmentMetadata(cardId, attachmentId) {
  return apiDelete(`/cards/${cardId}/attachments/${attachmentId}`);
}

export function createCardReminder(cardId) {
  return apiPost(`/cards/${cardId}/reminder/create`, {}).then((res) => res.task);
}

export function createChecklistReminder(cardId, itemId) {
  return apiPost(`/cards/${cardId}/checklist/${itemId}/reminder/create`, {}).then((res) => res.task);
}

export function generateCardSubtasks(payload) {
  return apiPost('/cards/ai/subtasks', payload).then((res) => res.data);
}

export function improveCardDescription(payload) {
  return apiPost('/cards/ai/description', payload).then((res) => res.data);
}

export function summarizeCard(payload) {
  return apiPost('/cards/ai/summary', payload).then((res) => res.data);
}

export function createSignedUpload(path) {
  return apiPost('/files/upload', { path });
}

export function signStoredFile(bucket, path, expiresIn) {
  return apiPost('/files/sign', { bucket, path, expiresIn }).then((res) => res.signedUrl);
}

export function createGoogleWorkspaceDocument(payload) {
  return apiPost('/files/google-doc', payload);
}
