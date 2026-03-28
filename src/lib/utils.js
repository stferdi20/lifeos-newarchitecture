import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const UI_LABEL_OVERRIDES = {
  ai: 'AI',
  api: 'API',
  arxiv: 'arXiv',
  github: 'GitHub',
  id: 'ID',
  ig: 'IG',
  pdf: 'PDF',
  url: 'URL',
  youtube: 'YouTube',
};

export function formatUiLabel(value, options = {}) {
  const input = String(value ?? '').trim();
  if (!input) return '';

  const { overrides = {} } = options;
  const normalized = input.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fullOverrideKey = normalized.toLowerCase();

  if (overrides[fullOverrideKey]) {
    return overrides[fullOverrideKey];
  }

  return normalized
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (overrides[lower]) return overrides[lower];
      if (UI_LABEL_OVERRIDES[lower]) return UI_LABEL_OVERRIDES[lower];
      if (/[A-Z]/.test(word.slice(1))) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}


export const isIframe = window.self !== window.top;
