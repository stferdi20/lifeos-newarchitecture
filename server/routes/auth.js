import { Hono } from 'hono';
import { ensureProfile, getRequestAuth, requireUser } from '../lib/supabase.js';

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
  };
}

const authRoutes = new Hono();

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
