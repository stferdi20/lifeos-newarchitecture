import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { safeJson, HttpError } from '../lib/http.js';
import { fetchTcgPriceUsd, searchTcgCards } from '../services/tcg.js';

const tcgRoutes = new Hono();

tcgRoutes.post('/search', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const query = String(body.query || '').trim();
  const game = String(body.game || '').trim();

  if (!query || !game) {
    throw new HttpError(400, 'TCG game and query are required.');
  }

  const results = await searchTcgCards({
    query,
    game,
    userId: auth.user.id,
  });

  return c.json({ results });
});

tcgRoutes.post('/price', async (c) => {
  await requireUser(c);
  const body = await safeJson(c.req.raw);
  const cardId = String(body.cardId || '').trim();
  const game = String(body.game || '').trim();

  if (!cardId || !game) {
    throw new HttpError(400, 'TCG game and card id are required.');
  }

  const result = await fetchTcgPriceUsd({ game, cardId });
  return c.json(result);
});

export default tcgRoutes;
