import { Hono } from 'hono';
import { getServerEnv } from '../config/env.js';
import { HttpError } from '../lib/http.js';
import { requireUser } from '../lib/supabase.js';
import { getNewsFeed, getTopNews } from '../services/news.js';
import { getNewsDigest, runDailyNewsDigestJob } from '../services/news-digests.js';

const newsRoutes = new Hono();

function getDigestRunSecret(c) {
  return c.req.header('x-cron-secret') || c.req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
}

function authorizeDigestRun(c) {
  const env = getServerEnv();
  const secret = getDigestRunSecret(c);

  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    throw new HttpError(401, 'Unauthorized');
  }
}

async function executeDigestRun(c, method = 'GET') {
  authorizeDigestRun(c);

  const body = method === 'POST'
    ? await c.req.json().catch(() => ({}))
    : {};
  const digestDate = body?.digest_date || c.req.query('date') || undefined;
  const userId = body?.user_id || c.req.query('user_id') || null;
  const runMode = method === 'GET' ? 'scheduled_or_linked' : 'manual';

  console.info('[news-digest] digest_run_requested', {
    method,
    runMode,
    digestDate: digestDate || 'default',
  });

  const data = await runDailyNewsDigestJob({
    userId,
    digestDate,
  });

  return c.json({
    ...data,
    run_mode: runMode,
  });
}

newsRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query('query') || '';
  const category = c.req.query('category') || 'general';
  const limit = c.req.query('limit') || '8';
  const data = await getNewsFeed({
    userId: auth.user.id,
    query,
    category,
    limit,
  });
  return c.json(data);
});

newsRoutes.get('/top', async (c) => {
  const auth = await requireUser(c);
  const limit = c.req.query('limit') || '4';
  const data = await getTopNews({
    userId: auth.user.id,
    limit,
  });
  return c.json(data);
});

newsRoutes.get('/digest', async (c) => {
  await requireUser(c);
  const digestDate = c.req.query('date') || '';
  const category = c.req.query('category') || 'all';
  const data = await getNewsDigest({
    digestDate,
    category,
  });
  return c.json(data);
});

newsRoutes.get('/digest/run', async (c) => executeDigestRun(c, 'GET'));

newsRoutes.post('/digest/run', async (c) => executeDigestRun(c, 'POST'));

export default newsRoutes;
