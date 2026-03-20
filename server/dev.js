import { serve } from '@hono/node-server';
import app from './app.js';
import { loadLocalEnv } from '../scripts/core-migration-helpers.js';

await loadLocalEnv();

const port = Number(process.env.API_PORT || 8787);
const hostname = process.env.API_HOST || '127.0.0.1';

serve({
  fetch: app.fetch,
  port,
  hostname,
});

console.log(`LifeOS API listening on http://${hostname}:${port}`);
