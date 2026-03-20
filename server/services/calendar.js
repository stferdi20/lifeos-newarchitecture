import { z } from 'zod';
import { routeStructuredJson } from '../lib/llm-router.js';

const calendarSchema = z.object({
  title: z.string().default(''),
  date: z.string().default(''),
  start_time: z.string().default(''),
  end_time: z.string().default(''),
  is_deadline: z.boolean().default(false),
  location: z.string().default(''),
  location_detail: z.string().default(''),
  meet_link: z.string().default(''),
  description: z.string().default(''),
  category: z.enum(['personal', 'work', 'academic', 'church', 'family', 'love']).default('personal'),
  event_type: z.enum(['offline', 'online', 'time_block', 'deadline']).default('offline'),
  recurrence_days: z.array(z.number()).default([]),
  recurrence_weeks: z.number().default(1),
  recurrence_end_date: z.string().default(''),
  tags: z.array(z.string()).default([]),
});

export async function parseCalendarText({ text, timeZone, userId = null }) {
  const now = new Date();
  const prompt = `Parse this event description into JSON.

Reference time:
- local date: ${now.toLocaleDateString('en-CA', { timeZone })}
- local time: ${now.toLocaleTimeString('en-GB', { hour12: false, timeZone })}
- time zone: ${timeZone}

Input:
${text}

Rules:
- Resolve relative dates using the provided timezone.
- Use YYYY-MM-DD for date.
- Use HH:MM 24h format for times.
- If no end time exists, leave it empty.
- Keep tags short and lowercase.
- Return JSON only.`;

  return routeStructuredJson({
    taskType: 'calendar.parse',
    prompt,
    schema: calendarSchema,
    userId,
    metadata: {
      requestSummary: text.slice(0, 200),
    },
  });
}
