import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import {
  assertGoogleService,
  buildGoogleConnectUrl,
  disconnectGoogleService,
  exchangeGoogleCode,
  listGoogleConnections,
} from '../services/google.js';

const googleRoutes = new Hono();

googleRoutes.get('/connections', async (c) => {
  const auth = await requireUser(c);
  const connections = await listGoogleConnections(auth.user.id);
  return c.json({ connections });
});

googleRoutes.post('/connect/:service', async (c) => {
  const auth = await requireUser(c);
  const service = assertGoogleService(c.req.param('service'));
  const authUrl = buildGoogleConnectUrl(service, auth.user.id);
  return c.json({ service, authUrl });
});

googleRoutes.post('/disconnect/:service', async (c) => {
  const auth = await requireUser(c);
  const result = await disconnectGoogleService(auth.user.id, c.req.param('service'));
  return c.json(result);
});

googleRoutes.get('/callback', async (c) => {
  const result = await exchangeGoogleCode(c.req.url);
  return c.html(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Google Connected</title></head>
  <body style="font-family: sans-serif; background: #10131a; color: white; padding: 32px;">
    <h1 style="margin: 0 0 12px;">Google ${result.service} connected</h1>
    <p style="opacity: 0.8;">You can close this window and return to LifeOS.</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'lifeos-google-oauth-complete', service: ${JSON.stringify(result.service)} }, '*');
      }
      window.setTimeout(() => window.close(), 800);
    </script>
  </body>
</html>`);
});

export default googleRoutes;
