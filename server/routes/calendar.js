import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HttpError } from '../lib/http.js';
import { requireUser } from '../lib/supabase.js';
import { parseCalendarText } from '../services/calendar.js';
import {
  createCalendarEvents,
  deleteCalendarEvent,
  fetchCalendarEvents,
  updateCalendarEvent,
} from '../services/google-calendar.js';

const parseSchema = z.object({
  text: z.string().min(1),
  timeZone: z.string().default('Australia/Melbourne'),
});

const syncSchema = z.object({
  action: z.enum(['fetch', 'create', 'update', 'delete']).default('fetch'),
  calendarId: z.string().optional(),
  payload: z.record(z.any()).optional(),
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
  timeZone: z.string().optional(),
  timezone: z.string().optional(),
  eventId: z.string().optional(),
  seriesId: z.string().optional(),
  recurringEventId: z.string().optional(),
  deleteMode: z.enum(['single', 'series']).optional(),
});

const calendarRoutes = new Hono();

calendarRoutes.post('/parse', zValidator('json', parseSchema), async (c) => {
  const auth = await requireUser(c);
  const result = await parseCalendarText({
    ...c.req.valid('json'),
    userId: auth.user.id,
  });

  return c.json({
    event: result.data,
    provider: result.provider,
    model: result.model,
  });
});

calendarRoutes.post('/sync', zValidator('json', syncSchema), async (c) => {
  const auth = await requireUser(c);
  const body = c.req.valid('json');
  const payload = {
    ...(body.payload || {}),
    calendarId: body.calendarId,
    timeMin: body.timeMin,
    timeMax: body.timeMax,
    timeZone: body.timeZone || body.timezone,
    timezone: body.timezone || body.timeZone,
    eventId: body.eventId,
    seriesId: body.seriesId,
    recurringEventId: body.recurringEventId,
    deleteMode: body.deleteMode,
  };

  if (body.action === 'fetch') {
    return c.json(await fetchCalendarEvents(auth.user.id, payload));
  }

  if (body.action === 'create') {
    return c.json(await createCalendarEvents(auth.user.id, payload), 201);
  }

  if (body.action === 'update') {
    return c.json(await updateCalendarEvent(auth.user.id, payload));
  }

  if (body.action === 'delete') {
    return c.json(await deleteCalendarEvent(auth.user.id, payload));
  }

  throw new HttpError(400, `Unsupported calendar action "${body.action}".`);
});

export default calendarRoutes;
