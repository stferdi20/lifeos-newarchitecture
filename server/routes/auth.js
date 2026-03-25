import { Hono } from 'hono';
import { getServerEnv, hasSupabaseServerConfig } from '../config/env.js';
import { ensureProfile, getRequestAuth, requireUser } from '../lib/supabase.js';
import { HttpError, safeJson } from '../lib/http.js';

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
  };
}

function getSupabaseAuthKey() {
  const env = getServerEnv();
  return env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function getSupabaseAuthEndpoint(path) {
  const env = getServerEnv();
  return new URL(path, env.SUPABASE_URL);
}

async function exchangeSupabaseSession(path, payload) {
  if (!hasSupabaseServerConfig()) {
    throw new HttpError(500, 'Supabase server configuration is missing.');
  }

  const authKey = getSupabaseAuthKey();
  if (!authKey) {
    throw new HttpError(500, 'Supabase auth key is missing on the server.');
  }

  const response = await fetch(getSupabaseAuthEndpoint(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: authKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(response.status, data?.msg || data?.error_description || data?.error || 'Supabase authentication failed.');
  }

  return data;
}

const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const body = await safeJson(c.req);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    throw new HttpError(400, 'Email and password are required.');
  }

  const session = await exchangeSupabaseSession('/auth/v1/token?grant_type=password', {
    email,
    password,
  });

  if (session?.user) {
    await ensureProfile(session.user);
  }

  return c.json({
    access_token: session.access_token || '',
    refresh_token: session.refresh_token || '',
    expires_at: session.expires_at || null,
    token_type: session.token_type || 'bearer',
    user: session.user ? serializeUser(session.user) : null,
  });
});

authRoutes.post('/refresh', async (c) => {
  const body = await safeJson(c.req);
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';

  if (!refreshToken) {
    throw new HttpError(400, 'Refresh token is required.');
  }

  const session = await exchangeSupabaseSession('/auth/v1/token?grant_type=refresh_token', {
    refresh_token: refreshToken,
  });

  if (session?.user) {
    await ensureProfile(session.user);
  }

  return c.json({
    access_token: session.access_token || '',
    refresh_token: session.refresh_token || '',
    expires_at: session.expires_at || null,
    token_type: session.token_type || 'bearer',
    user: session.user ? serializeUser(session.user) : null,
  });
});

authRoutes.get('/me', async (c) => {
  const auth = await getRequestAuth(c);
  if (!auth.user) return c.json({ user: null, authMode: auth.authMode }, 401);

  await ensureProfile(auth.user);
  return c.json({
    user: serializeUser(auth.user),
    authMode: auth.authMode,
  });
});

authRoutes.post('/session/refresh', async (c) => {
  const auth = await requireUser(c);
  await ensureProfile(auth.user);
  return c.json({
    user: serializeUser(auth.user),
    authMode: auth.authMode,
  });
});

export default authRoutes;
