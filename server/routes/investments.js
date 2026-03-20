import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { HttpError, safeJson } from '../lib/http.js';
import { createCompatCrudRoute } from './compat-crud.js';
import { invokeCompatFunction } from '../services/compat-functions.js';
import { fetchUsdToIdrRate, searchCrypto } from '../services/market-data.js';

const investmentRoutes = createCompatCrudRoute({
  entityType: 'Investment',
  collectionKey: 'investments',
  itemKey: 'investment',
  defaultSort: 'name',
});

investmentRoutes.post('/prices', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, 'fetchPrices', body);
  return c.json(data);
});

investmentRoutes.post('/search-stocks', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, 'searchStocks', body);
  return c.json(data);
});

investmentRoutes.post('/search-crypto', async (c) => {
  await requireUser(c);
  const body = await safeJson(c.req.raw);
  const query = String(body.query || '').trim();

  if (!query) {
    throw new HttpError(400, 'Crypto search query is required.');
  }

  const results = await searchCrypto(query);
  return c.json({ results });
});

investmentRoutes.get('/fx/usd-idr', async (c) => {
  await requireUser(c);
  const result = await fetchUsdToIdrRate();
  return c.json(result);
});

export default investmentRoutes;
