export const GENERIC_CAPTURE_ACTIVE_STATUSES = new Set(['queued', 'processing']);

export function isGenericCaptureActive(resource) {
  return GENERIC_CAPTURE_ACTIVE_STATUSES.has(String(resource?.capture_status || ''));
}

export function isGenericCaptureFailed(resource) {
  return String(resource?.capture_status || '') === 'failed';
}

export function getGenericCaptureStatusLabel(resource) {
  const status = String(resource?.capture_status || '');
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1);
}
