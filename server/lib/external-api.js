import { HttpError } from './http.js';

const DEFAULT_TIMEOUT_MS = 8000;

function logExternalApiFailure(provider, error, context = {}) {
  const details = {
    provider,
    message: error?.message || 'Unknown error',
    ...context,
  };

  console.error('[external-api]', details);
}

export async function fetchExternalJson(url, options = {}) {
  const {
    provider = 'external-api',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...init
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      logExternalApiFailure(provider, new Error('Request failed'), {
        status: response.status,
        statusText: response.statusText,
      });
      throw new HttpError(502, `${provider} request failed.`, {
        provider,
        status: response.status,
      });
    }

    return payload;
  } catch (error) {
    if (error instanceof HttpError) throw error;

    if (error?.name === 'AbortError') {
      logExternalApiFailure(provider, error, { timeoutMs });
      throw new HttpError(504, `${provider} timed out.`, {
        provider,
        timeoutMs,
      });
    }

    logExternalApiFailure(provider, error);
    throw new HttpError(502, `${provider} is temporarily unavailable.`, {
      provider,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
