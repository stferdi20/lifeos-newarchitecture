import { Hono } from 'hono';
import { HttpError } from '../lib/http.js';
import { getServiceRoleClient, requireUser } from '../lib/supabase.js';
import {
  assertGoogleService,
  buildGoogleConnectUrl,
  disconnectGoogleService,
  exchangeGoogleCode,
  getGoogleAccessToken,
  listGoogleConnections,
} from '../services/google.js';

const googleRoutes = new Hono();

async function resolveGoogleRouteUser(c) {
  const token = String(c.req.query('token') || '').trim();
  if (token) {
    const admin = getServiceRoleClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new HttpError(401, 'Unauthorized');
    }
    return { user: data.user };
  }

  return requireUser(c);
}

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

googleRoutes.get('/drive-files/:fileId/content', async (c) => {
  const auth = await resolveGoogleRouteUser(c);
  const fileId = String(c.req.param('fileId') || '').trim();
  if (!fileId) {
    throw new HttpError(400, 'Missing Google Drive file id.');
  }

  const accessToken = await getGoogleAccessToken(auth.user.id, 'drive');
  const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!upstream.ok || !upstream.body) {
    throw new HttpError(upstream.status || 502, 'Failed to load Google Drive file content.');
  }

  const headers = new Headers();
  headers.set('Cache-Control', 'private, max-age=300');
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
});

export default googleRoutes;
