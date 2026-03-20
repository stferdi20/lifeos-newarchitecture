import { HttpError } from '../lib/http.js';
import { getGoogleAccessToken } from './google.js';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const CATEGORY_COLOR_IDS = {
  personal: '3',
  work: '9',
  academic: '2',
  church: '5',
  family: '11',
  love: '4',
};

function buildAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

function buildEventDescription(payload = {}) {
  const lines = [];
  if (payload.description?.trim()) lines.push(payload.description.trim());
  if (payload.location_detail?.trim()) lines.push(`Location Detail: ${payload.location_detail.trim()}`);
  if (payload.meet_link?.trim()) lines.push(`Meeting Link: ${payload.meet_link.trim()}`);
  if (Array.isArray(payload.tags) && payload.tags.length) {
    lines.push(`Tags: ${payload.tags.map((tag) => `#${String(tag).trim().toLowerCase()}`).join(' ')}`);
  }
  return lines.join('\n\n').trim();
}

function normalizeEvent(event = {}) {
  const meetLink = event.hangoutLink
    || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri
    || null;

  return {
    ...event,
    id: event.id,
    summary: event.summary || '',
    description: event.description || '',
    start: event.start || null,
    end: event.end || null,
    location: event.location || '',
    htmlLink: event.htmlLink || '',
    recurringEventId: event.recurringEventId || null,
    colorId: event.colorId || null,
    isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
    meetLink,
    category: Object.entries(CATEGORY_COLOR_IDS).find(([, colorId]) => colorId === event.colorId)?.[0] || 'personal',
  };
}

function toEventTimes(payload = {}) {
  const timeZone = payload.timezone || payload.timeZone || 'Australia/Melbourne';

  if (payload.is_deadline) {
    return {
      start: { date: payload.date },
      end: { date: payload.date },
    };
  }

  return {
    start: {
      dateTime: `${payload.date}T${payload.start_time || '09:00'}:00`,
      timeZone,
    },
    end: {
      dateTime: `${payload.date}T${payload.end_time || payload.start_time || '10:00'}:00`,
      timeZone,
    },
  };
}

function buildGoogleEventPayload(payload = {}, dateOverride = null) {
  const effectiveDate = dateOverride || payload.date;
  if (!effectiveDate) {
    throw new HttpError(400, 'Calendar event date is required.');
  }

  const title = String(payload.title || '').trim();
  if (!title) {
    throw new HttpError(400, 'Calendar event title is required.');
  }

  const description = buildEventDescription(payload);
  const prefix = payload.is_deadline ? '[DEADLINE] ' : '';
  const timing = toEventTimes({ ...payload, date: effectiveDate });

  return {
    summary: `${prefix}${title}`,
    description,
    location: payload.location || undefined,
    colorId: CATEGORY_COLOR_IDS[payload.category] || CATEGORY_COLOR_IDS.personal,
    ...timing,
  };
}

function addDays(dateString, delta) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

function getRecurrenceDates(payload = {}) {
  const startDate = payload.date;
  if (!startDate) return [];

  if (payload.is_deadline || !Array.isArray(payload.recurrence_days) || !payload.recurrence_days.length) {
    return [startDate];
  }

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return [startDate];

  const dates = [];
  const endDate = payload.recurrence_end_date
    ? new Date(`${payload.recurrence_end_date}T00:00:00`)
    : null;
  const weeks = Math.max(Number(payload.recurrence_weeks) || 1, 1);
  const spanDays = endDate ? 366 : (weeks * 7);

  for (let offset = 0; offset < spanDays; offset += 1) {
    const currentDate = addDays(startDate, offset);
    const current = new Date(`${currentDate}T00:00:00`);
    if (endDate && current > endDate) break;
    if (!payload.recurrence_days.includes(current.getDay())) continue;
    if (!endDate && offset >= spanDays) break;
    dates.push(currentDate);
  }

  return dates.length ? dates : [startDate];
}

async function googleCalendarFetch(accessToken, path, init = {}) {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      ...buildAuthHeaders(accessToken),
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(502, 'Google Calendar request failed.', {
      details: payload,
    });
  }

  return payload;
}

export async function fetchCalendarEvents(userId, payload = {}) {
  const accessToken = await getGoogleAccessToken(userId, 'calendar');
  const calendarId = payload.calendarId || 'primary';
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: payload.timeMin || new Date().toISOString(),
  });

  if (payload.timeMax) params.set('timeMax', payload.timeMax);
  if (payload.timeZone || payload.timezone) params.set('timeZone', payload.timeZone || payload.timezone);
  if (payload.maxResults) params.set('maxResults', String(payload.maxResults));

  const result = await googleCalendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { method: 'GET' },
  );

  return {
    events: (result.items || []).map(normalizeEvent),
  };
}

export async function createCalendarEvents(userId, payload = {}) {
  const accessToken = await getGoogleAccessToken(userId, 'calendar');
  const calendarId = payload.calendarId || 'primary';
  const dates = getRecurrenceDates(payload);
  const events = [];

  for (const date of dates) {
    const eventPayload = buildGoogleEventPayload(payload, date);
    const event = await googleCalendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        body: JSON.stringify(eventPayload),
      },
    );
    events.push(normalizeEvent(event));
  }

  return {
    event: events[0] || null,
    events,
  };
}

export async function updateCalendarEvent(userId, payload = {}) {
  const accessToken = await getGoogleAccessToken(userId, 'calendar');
  const calendarId = payload.calendarId || 'primary';
  const eventId = String(payload.eventId || '').trim();

  if (!eventId) {
    throw new HttpError(400, 'Calendar event id is required for updates.');
  }

  const eventPayload = buildGoogleEventPayload(payload);
  const event = await googleCalendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(eventPayload),
    },
  );

  return {
    event: normalizeEvent(event),
  };
}

export async function deleteCalendarEvent(userId, payload = {}) {
  const accessToken = await getGoogleAccessToken(userId, 'calendar');
  const calendarId = payload.calendarId || 'primary';
  const deleteMode = payload.deleteMode || 'single';
  const eventId = deleteMode === 'series'
    ? String(payload.seriesId || payload.recurringEventId || payload.eventId || '').trim()
    : String(payload.eventId || '').trim();

  if (!eventId) {
    throw new HttpError(400, 'Calendar event id is required for deletion.');
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const details = await response.json().catch(() => null);
    throw new HttpError(502, 'Failed to delete Google Calendar event.', { details });
  }

  return {
    ok: true,
    eventId,
    deleteMode,
  };
}
