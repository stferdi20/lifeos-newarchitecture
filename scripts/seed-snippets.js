import { createCompatEntity } from '../server/services/compat-store.js';
import { loadLocalEnv, parseArgs } from './core-migration-helpers.js';

const SAMPLE_SNIPPETS = [
  {
    title: 'Warm Follow-Up',
    snippet_type: 'text',
    body_text: [
      'Hey! Just checking back in on this.',
      '',
      'If you want, I can help turn the next step into something concrete and lightweight so it is easier to move forward.',
    ].join('\n'),
    tags: ['message', 'follow-up', 'general'],
    is_favorite: true,
  },
  {
    title: 'Structured Planning Prompt',
    snippet_type: 'text',
    body_text: [
      'Help me turn this rough idea into an implementation plan.',
      '',
      'Please include:',
      '- a simple summary of the goal',
      '- the main user flows',
      '- backend and frontend changes',
      '- edge cases and failure modes',
      '- a practical test checklist',
    ].join('\n'),
    tags: ['prompt', 'planning', 'workflow'],
    is_favorite: false,
  },
];

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const userId = args['user-id'] || process.env.LIFEOS_DEV_USER_ID || '';

  if (!userId) {
    throw new Error('Missing --user-id and LIFEOS_DEV_USER_ID. Pass the auth user UUID to seed snippets.');
  }

  const created = [];
  for (const snippet of SAMPLE_SNIPPETS) {
    const record = await createCompatEntity(userId, 'Snippet', snippet);
    created.push({ id: record.id, title: record.title });
  }

  console.log(JSON.stringify({
    seeded: created.length,
    snippets: created,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
