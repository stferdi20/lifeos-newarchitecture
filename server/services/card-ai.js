import { z } from 'zod';
import { routeStructuredJson } from '../lib/llm-router.js';

const subtasksSchema = z.object({
  subtasks: z.array(z.string()).default([]),
});

const descriptionSchema = z.object({
  description: z.string().default(''),
});

const summarySchema = z.object({
  summary: z.string().default(''),
  nextSteps: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

export async function generateCardSubtasks({ title, description, userId }) {
  return routeStructuredJson({
    taskType: 'card.subtasks',
    prompt: `Break this project card into 3-6 actionable subtasks.

Title: ${title}
Description: ${description || 'None'}

Return JSON:
{
  "subtasks": ["..."]
}`,
    schema: subtasksSchema,
    userId,
    policy: { tier: 'standard', maxTokens: 700 },
    metadata: { requestSummary: `subtasks:${title}` },
  });
}

export async function improveCardDescription({ title, description, priority, startDate, dueDate, userId }) {
  return routeStructuredJson({
    taskType: 'card.description',
    prompt: `Rewrite this project card description so it is clearer and more actionable.

Title: ${title || 'Untitled card'}
Priority: ${priority || 'medium'}
Start date: ${startDate || 'Not set'}
Due date: ${dueDate || 'Not set'}
Current description:
${description || 'No description'}

Rules:
- Keep the original intent.
- Do not invent facts.
- Use short paragraphs or bullets when useful.

Return JSON:
{
  "description": "..."
}`,
    schema: descriptionSchema,
    userId,
    policy: { tier: 'standard', maxTokens: 900 },
    metadata: { requestSummary: `description:${title}` },
  });
}

export async function summarizeCard({ title, description, checklist, priority, dueDate, userId }) {
  return routeStructuredJson({
    taskType: 'card.summary',
    prompt: `Summarize this project card for a kanban preview.

Title: ${title}
Priority: ${priority || 'medium'}
Due date: ${dueDate || 'Not set'}
Description: ${description || 'None'}
Checklist:
${(checklist || []).map((item) => `- ${item.done ? '[x]' : '[ ]'} ${item.text}`).join('\n') || 'None'}

Return JSON:
{
  "summary": "...",
  "nextSteps": ["..."],
  "risks": ["..."]
}`,
    schema: summarySchema,
    userId,
    policy: { tier: 'cheap', maxTokens: 700 },
    metadata: { requestSummary: `summary:${title}` },
  });
}
