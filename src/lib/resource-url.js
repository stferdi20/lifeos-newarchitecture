const HAS_SCHEME_RE = /^[a-z][a-z\d+\-.]*:\/\//i;
const DOMAIN_LIKE_RE = /^(localhost(?::\d+)?|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?:[/:?#].*)?$/iu;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeResourceUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';

  if (isValidHttpUrl(trimmed)) return trimmed;
  if (HAS_SCHEME_RE.test(trimmed)) return trimmed;
  if (!DOMAIN_LIKE_RE.test(trimmed) || /\s/.test(trimmed)) return trimmed;

  const normalized = `https://${trimmed}`;
  return isValidHttpUrl(normalized) ? normalized : trimmed;
}

export function isNormalizedResourceUrl(input) {
  return isValidHttpUrl(normalizeResourceUrl(input));
}
