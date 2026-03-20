import { apiPost } from '@/lib/api-client';

export function parseCalendarInput({ text, timeZone }) {
  return apiPost('/calendar/parse', { text, timeZone }).then((res) => res.event);
}

export function fetchCalendarEvents({ timeMin, timeMax, timeZone, calendarId = 'primary', maxResults } = {}) {
  return apiPost('/calendar/sync', {
    action: 'fetch',
    calendarId,
    timeMin,
    timeMax,
    timeZone,
    payload: {
      maxResults,
    },
  }).then((res) => res.events || []);
}

export function createCalendarEvent(payload) {
  return apiPost('/calendar/sync', {
    action: 'create',
    payload,
  }).then((res) => res);
}

export function updateCalendarEvent(eventId, payload) {
  return apiPost('/calendar/sync', {
    action: 'update',
    eventId,
    payload,
  }).then((res) => res.event);
}

export function deleteCalendarEvent({ eventId, seriesId = null, deleteMode = 'single' }) {
  return apiPost('/calendar/sync', {
    action: 'delete',
    eventId,
    seriesId,
    deleteMode,
  });
}
