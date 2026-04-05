import { getServerEnv } from '../config/env.js';
import { decryptSecret, encryptSecret, signStatePayload, verifyStatePayload } from '../lib/crypto.js';
import { HttpError, pickDefinedEntries } from '../lib/http.js';
import { getServiceRoleClient } from '../lib/supabase.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GOOGLE_SERVICE_SCOPES = {
  drive: ['https://www.googleapis.com/auth/drive'],
  docs: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
  ],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  tasks: ['https://www.googleapis.com/auth/tasks'],
};

export function assertGoogleService(service) {
  if (!GOOGLE_SERVICE_SCOPES[service]) {
    throw new HttpError(400, `Unsupported Google service "${service}".`);
  }

  return service;
}

export function buildGoogleConnectUrl(service, userId) {
  const env = getServerEnv();
  assertGoogleService(service);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new HttpError(500, 'Google OAuth is not configured.');
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SERVICE_SCOPES[service].join(' '),
    state: signStatePayload({
      userId,
      service,
      issuedAt: Date.now(),
    }),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function storeGoogleTokens({ userId, service, tokenPayload }) {
  const admin = getServiceRoleClient();
  const expiresAt = tokenPayload.expires_in
    ? new Date(Date.now() + (Number(tokenPayload.expires_in) * 1000)).toISOString()
    : null;

  const connectionResult = await admin.from('google_connections').upsert({
    user_id: userId,
    service,
    status: 'connected',
    scope: tokenPayload.scope || GOOGLE_SERVICE_SCOPES[service].join(' '),
    last_connected_at: new Date().toISOString(),
  }, { onConflict: 'user_id,service' });
  if (connectionResult.error) throw new HttpError(500, connectionResult.error.message);

  const row = pickDefinedEntries({
    user_id: userId,
    service,
    encrypted_access_token: tokenPayload.access_token ? encryptSecret(tokenPayload.access_token) : null,
    encrypted_refresh_token: tokenPayload.refresh_token ? encryptSecret(tokenPayload.refresh_token) : undefined,
    expires_at: expiresAt,
    token_type: tokenPayload.token_type || 'Bearer',
    scope: tokenPayload.scope || GOOGLE_SERVICE_SCOPES[service].join(' '),
    updated_at: new Date().toISOString(),
  });

  const tokenResult = await admin.from('google_tokens').upsert(row, {
    onConflict: 'user_id,service',
  });

  if (tokenResult.error) throw new HttpError(500, tokenResult.error.message);
}

export async function exchangeGoogleCode(reqUrl) {
  const env = getServerEnv();
  const url = new URL(reqUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    throw new HttpError(400, `Google OAuth failed: ${oauthError}`);
  }

  if (!code || !state) {
    throw new HttpError(400, 'Missing Google OAuth code or state.');
  }

  const payload = verifyStatePayload(state);
  const service = assertGoogleService(payload.service);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokenPayload = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) {
    throw new HttpError(502, 'Failed to exchange Google OAuth code.', {
      details: tokenPayload,
    });
  }

  await storeGoogleTokens({
    userId: payload.userId,
    service,
    tokenPayload,
  });

  return { userId: payload.userId, service };
}

export async function disconnectGoogleService(userId, service) {
  assertGoogleService(service);
  const admin = getServiceRoleClient();

  await admin.from('google_tokens').delete().eq('user_id', userId).eq('service', service);

  const result = await admin
    .from('google_connections')
    .update({
      status: 'disconnected',
      disconnected_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('service', service);

  if (result.error) throw new HttpError(500, result.error.message);
  return { service, status: 'disconnected' };
}

export async function listGoogleConnections(userId) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('google_connections')
    .select('*')
    .eq('user_id', userId)
    .order('service', { ascending: true });

  if (result.error) throw new HttpError(500, result.error.message);

  const connections = result.data || [];
  return Promise.all(connections.map(async (connection) => {
    if (connection.status !== 'connected') {
      return connection;
    }

    try {
      await getGoogleAccessToken(userId, connection.service);
      return connection;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 409 || error.status === 502)) {
        return {
          ...connection,
          status: 'reconnect_required',
          reconnect_reason: error.message,
        };
      }

      throw error;
    }
  }));
}

export async function getGoogleAccessToken(userId, service) {
  assertGoogleService(service);
  const env = getServerEnv();
  const admin = getServiceRoleClient();
  const tokenResult = await admin
    .from('google_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('service', service)
    .maybeSingle();

  if (tokenResult.error) throw new HttpError(500, tokenResult.error.message);
  if (!tokenResult.data) {
    throw new HttpError(409, `Google ${service} is not connected for this account.`);
  }

  const tokenRow = tokenResult.data;
  const expiresAt = tokenRow.expires_at ? Date.parse(tokenRow.expires_at) : 0;
  const stillValid = expiresAt && expiresAt > (Date.now() + 60_000);

  if (stillValid && tokenRow.encrypted_access_token) {
    return decryptSecret(tokenRow.encrypted_access_token);
  }

  if (!tokenRow.encrypted_refresh_token) {
    throw new HttpError(409, `Google ${service} needs to be reconnected.`);
  }

  const refreshToken = decryptSecret(tokenRow.encrypted_refresh_token);
  const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const refreshPayload = await refreshRes.json().catch(() => null);
  if (!refreshRes.ok) {
    throw new HttpError(502, `Failed to refresh Google ${service} token.`, {
      details: refreshPayload,
    });
  }

  await storeGoogleTokens({
    userId,
    service,
    tokenPayload: {
      ...refreshPayload,
      refresh_token: refreshPayload.refresh_token || refreshToken,
    },
  });

  return refreshPayload.access_token;
}
