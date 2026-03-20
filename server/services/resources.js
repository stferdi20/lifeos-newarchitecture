import { parseHTML } from 'linkedom';
import { z } from 'zod';
import { routeStructuredJson } from '../lib/llm-router.js';

const resourceSchema = z.object({
  title: z.string().default(''),
  summary: z.string().default(''),
  main_topic: z.string().default(''),
  score: z.number().min(1).max(10).default(5),
  tags: z.array(z.string()).default([]),
  insights: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
});

function stripText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageSummary(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'LifeOS/1.0 (+https://lifeos.local)',
    },
  });

  const html = await res.text();
  const { document } = parseHTML(html);
  const title = stripText(document.querySelector('title')?.textContent || '');
  const bodyText = stripText(document.body?.textContent || '').slice(0, 12000);

  return {
    title,
    content: bodyText,
  };
}

export async function analyzeResource({ url, title = '', content = '', userId = null }) {
  const extracted = content
    ? { title, content: stripText(content).slice(0, 12000) }
    : await fetchPageSummary(url);

  const prompt = `Analyze this resource and return structured JSON.

URL: ${url}
Title: ${title || extracted.title || 'Unknown'}
Content excerpt:
${extracted.content || 'No content available'}

Return JSON with:
- title
- summary
- main_topic
- score (1-10)
- tags (3-8 short lowercase tags)
- insights (3-6 bullets)
- actions (0-5 practical action items)`;

  return routeStructuredJson({
    taskType: 'resource.analyze',
    prompt,
    schema: resourceSchema,
    userId,
    metadata: {
      requestSummary: `resource:${url}`,
    },
  });
}
