function compactWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value = '', maxLength = 72) {
  const normalized = compactWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function getSnippetDisplayTitle(snippet) {
  const explicitTitle = compactWhitespace(snippet?.title);
  if (explicitTitle) return explicitTitle;

  const firstLine = String(snippet?.body_text || snippet?.plain_text_preview || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return snippet?.snippet_type === 'image' ? 'Untitled image snippet' : 'Untitled snippet';
  }

  return truncateText(firstLine, 72);
}

export function getSnippetDisplayPreview(snippet) {
  if (snippet?.snippet_type === 'image') {
    return compactWhitespace(snippet?.plain_text_preview || snippet?.body_text || '') || 'Stored image snippet ready to copy.';
  }

  const title = getSnippetDisplayTitle(snippet);
  const lines = String(snippet?.body_text || snippet?.plain_text_preview || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let previewSource = lines.join(' ');
  if (lines[0] && title) {
    if (lines[0].localeCompare(title, undefined, { sensitivity: 'accent' }) === 0) {
      previewSource = lines.slice(1).join(' ');
    } else if (lines[0].startsWith(title)) {
      previewSource = [lines[0].slice(title.length).trim(), ...lines.slice(1)].filter(Boolean).join(' ');
    }
  }

  const normalized = compactWhitespace(previewSource);
  if (!normalized) {
    return title === 'Untitled snippet' ? 'No preview available yet.' : title;
  }

  return truncateText(normalized, 220);
}
