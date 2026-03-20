import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const CATEGORY_COLORS = {
  personal: '3',
  work: '9',
  academic: '2',
  church: '5',
  family: '11',
  love: '4',
};

const GCAL_API = 'https://www.googleapis.com/calendar/v3';
const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function parseDateOnly(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-');
}

function addDays(date: Date, days: number) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function getDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const offsetValue = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+0';
  const match = offsetValue.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60) + minutes) * 60_000;
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));
  const secondPass = new Date(utcGuess - getTimeZoneOffsetMs(firstPass, timeZone));
  return secondPass;
}

function buildUntilStamp(date: string, timeZone: string) {
  const utcDate = zonedDateTimeToUtc(date, '23:59', timeZone);
  return utcDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatLocalReference(now: Date, timeZone: string) {
  const local = getDateParts(now, timeZone);
  return {
    iso: now.toISOString(),
    timeZone,
    localDate: local.date,
    localTime: `${local.time}:${local.second}`,
    weekday: local.weekday,
  };
}

function normalizeRecurringStart(date: string | undefined, recurrenceDays: number[] | undefined, fallbackDate: string) {
  const selectedDays = (recurrenceDays || []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (selectedDays.length === 0) return date || fallbackDate;

  const baseDate = parseDateOnly(date) || parseDateOnly(fallbackDate);
  if (!baseDate) return date || fallbackDate;

  if (date) {
    const parsedDate = parseDateOnly(date);
    if (parsedDate && selectedDays.includes(parsedDate.getUTCDay())) {
      return date;
    }
  }

  const currentDay = baseDate.getUTCDay();
  const sortedCandidates = [...selectedDays].sort((a, b) => {
    const aDistance = (a - currentDay + 7) % 7;
    const bDistance = (b - currentDay + 7) % 7;
    return aDistance - bDistance || a - b;
  });

  return formatDateOnly(addDays(baseDate, (sortedCandidates[0] - currentDay + 7) % 7));
}

function buildRRule(days: number[], weeks: number, recurrenceEndDate: string | undefined, timeZone: string) {
  const byDay = days
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .map((day) => DAY_NAMES[day])
    .join(',');

  if (!byDay) return undefined;

  if (recurrenceEndDate) {
    return [`RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${buildUntilStamp(recurrenceEndDate, timeZone)}`];
  }

  if (weeks > 1) {
    return [`RRULE:FREQ=WEEKLY;COUNT=${days.length * weeks};BYDAY=${byDay}`];
  }

  return undefined;
}

async function gcal(method, path, accessToken, body = null) {
  const res = await fetch(`${GCAL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar API error: ${err}`);
  }

  if (res.status === 204) return {};
  return res.json();
}

async function parseNaturalLanguage(base44, text: string, timeZone: string) {
  const reference = formatLocalReference(new Date(), timeZone);
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `Parse this event description into structured data.

Reference time:
- local date: ${reference.localDate}
- local weekday: ${reference.weekday}
- local time: ${reference.localTime}
- timezone: ${reference.timeZone}
- utc timestamp: ${reference.iso}

Input: "${text}"

Extract:
- title: event title
- date: ISO date string (YYYY-MM-DD). If recurring, this must be the first actual occurrence that matches the recurrence weekday.
- start_time: HH:MM 24h format
- end_time: HH:MM 24h format (if duration mentioned, calculate end time)
- is_deadline: true if this is a deadline/due date, not an event
- location: if a physical place is mentioned, return a full Google Maps URL like "https://maps.google.com/?q=Place+Name+City" using the most specific address you can infer. If no location mentioned, return empty string.
- location_detail: any extra location specifics that do not fit in a map link. Keep it short and readable.
- meet_link: online meeting link if mentioned
- description: any additional details
- category: one of [personal, work, academic, church, family, love] - infer from context
- event_type: one of [offline, online, time_block, deadline]
- recurrence_days: array of day numbers (0=Sun,1=Mon..6=Sat) if recurring
- recurrence_weeks: number of weeks if the user says "for N weeks". Otherwise return 1.
- recurrence_end_date: ISO date string (YYYY-MM-DD) if the user specifies an end date or phrase like "until last Friday of May". Otherwise return empty string.
- tags: array of relevant lowercase tags inferred from context. Generate 2-5 meaningful tags.

Rules:
- Resolve relative dates like "tomorrow" and "next Tuesday" using the provided local date and timezone, not UTC.
- When the user gives a recurrence end phrase, convert it into recurrence_end_date.
- Return only valid JSON.`,
    response_json_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        is_deadline: { type: 'boolean' },
        location: { type: 'string' },
        location_detail: { type: 'string' },
        meet_link: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        event_type: { type: 'string' },
        recurrence_days: { type: 'array', items: { type: 'number' } },
        recurrence_weeks: { type: 'number' },
        recurrence_end_date: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    model: 'gemini_3_pro',
  });

  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const body = await req.json();
    const { action } = body;

    if (action === 'fetchEvents') {
      const { timeMin, timeMax } = body;
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      });
      const data = await gcal('GET', `/calendars/primary/events?${params}`, accessToken);
      return Response.json({ events: data.items || [] });
    }

    if (action === 'parseNL') {
      const parsed = await parseNaturalLanguage(base44, body.text, body.timezone || 'UTC');
      return Response.json({ parsed });
    }

    if (action === 'createEvent') {
      const {
        title,
        date,
        start_time,
        end_time,
        is_deadline,
        location,
        location_detail,
        meet_link,
        description,
        category,
        event_type,
        recurrence_days,
        recurrence_weeks,
        recurrence_end_date,
        tags,
        timezone,
      } = body;

      const colorId = CATEGORY_COLORS[category] || '1';
      const tz = timezone || 'Australia/Melbourne';
      const localReferenceDate = getDateParts(new Date(), tz).date;
      const normalizedDate = normalizeRecurringStart(date, recurrence_days, localReferenceDate);

      let event;

      if (is_deadline) {
        event = {
          summary: `[DEADLINE] ${title}`,
          description: [
            description,
            location_detail ? `Location detail: ${location_detail}` : '',
            tags?.length ? `Tags: ${tags.join(', ')}` : '',
            meet_link ? `Link: ${meet_link}` : '',
          ].filter(Boolean).join('\n'),
          start: { date: normalizedDate },
          end: { date: normalizedDate },
          colorId: '11',
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 1440 },
              { method: 'popup', minutes: 10080 },
            ],
          },
        };
      } else {
        const startDateTime = `${normalizedDate}T${start_time}:00`;
        const endDateTime = `${normalizedDate}T${end_time}:00`;

        event = {
          summary: title,
          description: [
            description,
            location_detail ? `Location detail: ${location_detail}` : '',
            event_type ? `Type: ${event_type}` : '',
            tags?.length ? `Tags: ${tags.join(', ')}` : '',
            meet_link ? `Meet Link: ${meet_link}` : '',
          ].filter(Boolean).join('\n'),
          start: { dateTime: startDateTime, timeZone: tz },
          end: { dateTime: endDateTime, timeZone: tz },
          location: location || undefined,
          colorId,
          reminders: { useDefault: true },
        };

        const recurrence = buildRRule(
          recurrence_days || [],
          Number(recurrence_weeks) || 1,
          recurrence_end_date || undefined,
          tz,
        );

        if (recurrence) {
          event.recurrence = recurrence;
        }
      }

      const created = await gcal('POST', '/calendars/primary/events', accessToken, event);
      return Response.json({ event: created, normalizedDate });
    }

    if (action === 'deleteEvent') {
      const targetEventId = body.deleteMode === 'series' && body.seriesId
        ? body.seriesId
        : body.eventId;

      if (!targetEventId) {
        return Response.json({ error: 'Missing eventId' }, { status: 400 });
      }

      await gcal('DELETE', `/calendars/primary/events/${encodeURIComponent(targetEventId)}`, accessToken);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
