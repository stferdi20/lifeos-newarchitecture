export class HttpError extends Error {
  constructor(status, message, extras = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extras = extras;
  }
}

export function jsonError(c, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : 'Internal server error';

  if (process.env.NODE_ENV !== 'production') {
    console.error(error);
  }

  return c.json(
    {
      error: message,
      ...(error instanceof HttpError && error.extras ? error.extras : {}),
    },
    status,
  );
}

export function pickDefinedEntries(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

export async function safeJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function toSlug(input = '') {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
