import { createClient } from '@supabase/supabase-js';
import { getServerEnv, hasSupabaseServerConfig } from '../config/env.js';
import { HttpError } from './http.js';

let serviceRoleClient = null;

export function getServiceRoleClient() {
  const env = getServerEnv();

  if (!hasSupabaseServerConfig()) {
    throw new HttpError(500, 'Supabase server configuration is missing.');
  }

  if (!serviceRoleClient) {
    serviceRoleClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serviceRoleClient;
}

export async function getRequestAuth(c) {
  const cached = c.get('auth');
  if (cached) return cached;

  const env = getServerEnv();
  const authorization = c.req.header('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';

  if (token && hasSupabaseServerConfig()) {
    const admin = getServiceRoleClient();
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data?.user) {
      const auth = { user: data.user, authMode: 'supabase', accessToken: token };
      c.set('auth', auth);
      return auth;
    }
  }

  if (env.NODE_ENV !== 'production' && env.LIFEOS_DEV_USER_ID) {
    const auth = {
      user: {
        id: env.LIFEOS_DEV_USER_ID,
        email: env.LIFEOS_DEV_USER_EMAIL || 'dev@lifeos.local',
        user_metadata: {
          full_name: env.LIFEOS_DEV_USER_NAME || 'LifeOS Dev',
        },
      },
      authMode: 'dev-bypass',
      accessToken: '',
    };
    c.set('auth', auth);
    return auth;
  }

  const auth = { user: null, authMode: 'anonymous', accessToken: '' };
  c.set('auth', auth);
  return auth;
}

export async function requireUser(c) {
  const auth = await getRequestAuth(c);
  if (!auth.user?.id) {
    throw new HttpError(401, 'Unauthorized');
  }

  return auth;
}

export async function ensureProfile(user) {
  if (!user?.id || !hasSupabaseServerConfig()) return null;

  const admin = getServiceRoleClient();
  const payload = {
    id: user.id,
    email: user.email || null,
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
  };

  await admin.from('profiles').upsert(payload, { onConflict: 'id' });
  return payload;
}

export async function getAccessibleWorkspaceIds(userId) {
  const admin = getServiceRoleClient();
  const ownedResult = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId);

  if (ownedResult.error) throw new HttpError(500, ownedResult.error.message);

  const membershipResult = await admin
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId);

  if (membershipResult.error) throw new HttpError(500, membershipResult.error.message);

  const ids = new Set([
    ...(ownedResult.data || []).map((row) => row.id),
    ...(membershipResult.data || []).map((row) => row.workspace_id),
  ]);

  return [...ids];
}
