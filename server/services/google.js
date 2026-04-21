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

function isMissingReconnectReasonColumn(error) {
  const message = String(error?.message || '');
  return message.includes('reconnect_reason') && message.includes('schema cache');
}

async function upsertGoogleConnection(admin, row) {
  const result = await admin.from('google_connections').upsert(row, { onConflict: 'user_id,service' });
  if (!result.error || !isMissingReconnectReasonColumn(result.error)) {
    return result;
  }

  const { reconnect_reason: _reconnectReason, ...compatRow } = row;
  return admin.from('google_connections').upsert(compatRow, { onConflict: 'user_id,service' });
}

async function storeGoogleTokens({ userId, service, tokenPayload }) {
  const admin = getServiceRoleClient();
  const expiresAt = tokenPayload.expires_in
    ? new Date(Date.now() + (Number(tokenPayload.expires_in) * 1000)).toISOString()
    : null;

  const connectionResult = await upsertGoogleConnection(admin, {
    user_id: userId,
    service,
    status: 'connected',
    scope: tokenPayload.scope || GOOGLE_SERVICE_SCOPES[service].join(' '),
    last_connected_at: new Date().toISOString(),
    disconnected_at: null,
    reconnect_reason: null,
  });
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

async function markConnectionReconnectRequired(userId, service, reason) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from('google_connections')
    .update({
      status: 'reconnect_required',
      reconnect_reason: reason,
    })
    .eq('user_id', userId)
    .eq('service', service);

  if (result.error && isMissingReconnectReasonColumn(result.error)) {
    const fallbackResult = await admin
      .from('google_connections')
      .update({ status: 'reconnect_required' })
      .eq('user_id', userId)
      .eq('service', service);

    if (fallbackResult.error) throw new HttpError(500, fallbackResult.error.message);
    return;
  }

  if (result.error) throw new HttpError(500, result.error.message);
}

async function markConnectionReconnectRequiredSafely(userId, service, reason) {
  try {
    await markConnectionReconnectRequired(userId, service, reason);
  } catch {
    // Preserve the original Google auth failure if the status row cannot be updated.
  }
}

function isReconnectRequiredError(error) {
  return error instanceof HttpError && error.status === 409;
}

function isTemporaryGoogleError(error) {
  return error instanceof HttpError && error.status === 502;
}

function isStoredTokenDataError(error) {
  if (!(error instanceof HttpError) || error.status !== 500) return false;

  return [
    'Stored Google token payload is malformed.',
    'Missing GOOGLE_TOKEN_ENCRYPTION_KEY for Google token storage.',
  ].includes(error.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermanentRefreshFailure(refreshRes, refreshPayload) {
  const errorCode = String(refreshPayload?.error || '').trim().toLowerCase();
  if (errorCode === 'invalid_grant' || errorCode === 'invalid_client' || errorCode === 'unauthorized_client') {
    return true;
  }

  return refreshRes.status === 400;
}

function getRefreshFailureMessage(service, refreshPayload) {
  return refreshPayload?.error_description
    || refreshPayload?.error
    || `Failed to refresh Google ${service} token.`;
}

async function refreshGoogleAccessToken({ service, refreshToken, env }) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
      if (refreshRes.ok) {
        return { refreshPayload };
      }

      if (isPermanentRefreshFailure(refreshRes, refreshPayload)) {
        return {
          refreshPayload,
          permanentFailure: true,
          reason: getRefreshFailureMessage(service, refreshPayload),
        };
      }

      lastError = new HttpError(502, `Temporary Google ${service} token refresh failure.`, {
        details: refreshPayload,
      });
    } catch (error) {
      lastError = new HttpError(502, `Temporary Google ${service} token refresh failure.`, {
        details: { cause: error instanceof Error ? error.message : String(error || 'Unknown error') },
      });
    }

    if (attempt < 2) {
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError || new HttpError(502, `Temporary Google ${service} token refresh failure.`);
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
      if (isReconnectRequiredError(error)) {
        return {
          ...connection,
          status: 'reconnect_required',
          reconnect_reason: error.message,
        };
      }

      if (isTemporaryGoogleError(error)) {
        return connection;
      }

      if (isStoredTokenDataError(error)) {
        const reconnectReason = `Google ${connection.service} needs to be reconnected.`;
        await markConnectionReconnectRequiredSafely(userId, connection.service, reconnectReason);
        return {
          ...connection,
          status: 'reconnect_required',
          reconnect_reason: reconnectReason,
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
    try {
      return decryptSecret(tokenRow.encrypted_access_token);
    } catch (error) {
      if (isStoredTokenDataError(error)) {
        await markConnectionReconnectRequiredSafely(userId, service, `Google ${service} needs to be reconnected.`);
        throw new HttpError(409, `Google ${service} needs to be reconnected.`);
      }

      throw error;
    }
  }

  if (!tokenRow.encrypted_refresh_token) {
    await markConnectionReconnectRequired(userId, service, `Google ${service} needs to be reconnected.`);
    throw new HttpError(409, `Google ${service} needs to be reconnected.`);
  }

  let refreshToken = '';
  try {
    refreshToken = decryptSecret(tokenRow.encrypted_refresh_token);
  } catch (error) {
    if (isStoredTokenDataError(error)) {
      await markConnectionReconnectRequiredSafely(userId, service, `Google ${service} needs to be reconnected.`);
      throw new HttpError(409, `Google ${service} needs to be reconnected.`);
    }

    throw error;
  }
  const refreshResult = await refreshGoogleAccessToken({
    service,
    refreshToken,
    env,
  });

  if (refreshResult.permanentFailure) {
    await markConnectionReconnectRequired(userId, service, refreshResult.reason);
    throw new HttpError(409, `Google ${service} needs to be reconnected.`, {
      details: refreshResult.refreshPayload,
    });
  }

  const { refreshPayload } = refreshResult;

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
