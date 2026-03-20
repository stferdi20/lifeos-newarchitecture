import { apiGet, apiPost } from '@/lib/api-client';

const GOOGLE_SERVICES = ['drive', 'docs', 'calendar', 'tasks'];

function normalizeConnections(connections = []) {
  const byService = new Map((connections || []).map((entry) => [entry.service, entry]));
  return GOOGLE_SERVICES.map((service) => ({
    service,
    status: byService.get(service)?.status || 'disconnected',
    scope: byService.get(service)?.scope || '',
    last_connected_at: byService.get(service)?.last_connected_at || null,
    disconnected_at: byService.get(service)?.disconnected_at || null,
  }));
}

export function listGoogleConnections() {
  return apiGet('/google/connections').then((res) => normalizeConnections(res.connections || []));
}

export function connectGoogleService(service) {
  return apiPost(`/google/connect/${service}`, {}).then((res) => res);
}

export function disconnectGoogleService(service) {
  return apiPost(`/google/disconnect/${service}`, {}).then((res) => res);
}
