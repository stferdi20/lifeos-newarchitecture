export const MEDIA_PAGE_SIZE = 60;
export const INITIAL_MEDIA_RENDER_COUNT = 24;
export const MEDIA_RENDER_STEP = 24;
const MEDIA_ARRAY_FIELDS = ['genres', 'cast', 'platforms', 'themes'];
const MEDIA_NUMERIC_FIELDS = [
  'rating',
  'year_consumed',
  'year_released',
  'seasons_total',
  'episodes',
  'chapters',
  'page_count',
  'episodes_watched',
  'chapters_read',
  'volumes',
];
const PROVIDER_LABELS = {
  tmdb: 'TMDb',
  anilist: 'AniList',
  jikan: 'Jikan',
  openlibrary: 'Open Library',
  googlebooks: 'Google Books',
  rawg: 'RAWG',
  comicvine: 'ComicVine',
};

const PLATFORM_LABELS = {
  windows: 'Windows',
  win: 'Windows',
  pc: 'PC',
  mac: 'MacOS',
  macos: 'MacOS',
  'mac os': 'MacOS',
  osx: 'MacOS',
  linux: 'Linux',
  'playstation 5': 'PS5',
  ps5: 'PS5',
  'playstation 4': 'PS4',
  ps4: 'PS4',
  'playstation 3': 'PS3',
  ps3: 'PS3',
  'playstation 2': 'PS2',
  ps2: 'PS2',
  playstation: 'PlayStation',
  'xbox series x/s': 'Xbox Series X|S',
  'xbox one': 'Xbox One',
  'xbox 360': 'Xbox 360',
  xbox: 'Xbox',
  'nintendo switch': 'Switch',
  switch: 'Switch',
  'game boy advance': 'Game Boy Advance',
  gba: 'Game Boy Advance',
  'nintendo ds': 'Nintendo DS',
  ds: 'Nintendo DS',
  gamecube: 'GameCube',
  ios: 'iOS',
  android: 'Android',
};

export function isPresentMediaValue(value) {
  return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizePlatformLabel(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  const mapped = PLATFORM_LABELS[cleaned.toLowerCase()];
  if (mapped) return mapped;

  return cleaned
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeMediaEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const normalized = { ...entry };

  MEDIA_ARRAY_FIELDS.forEach((field) => {
    normalized[field] = normalizeStringList(entry[field]);
  });

  normalized.platforms = (normalized.platforms || []).map(normalizePlatformLabel).filter(Boolean);

  MEDIA_NUMERIC_FIELDS.forEach((field) => {
    if (field in entry) {
      normalized[field] = normalizeOptionalNumber(entry[field]);
    }
  });

  if ('seasons_watched' in entry) {
    normalized.seasons_watched = entry.seasons_watched === 'all'
      ? 'all'
      : normalizeOptionalNumber(entry.seasons_watched);
  }

  if ('played_on' in entry) {
    normalized.played_on = normalizePlatformLabel(entry.played_on);
  }

  return normalized;
}

export function mergeDefinedMediaFields(target, source) {
  const next = { ...target };

  Object.entries(source || {}).forEach(([key, value]) => {
    if (isPresentMediaValue(value)) {
      next[key] = value;
    }
  });

  return next;
}

export function normalizeMediaEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(normalizeMediaEntry)
    .filter(Boolean);
}

export function buildMediaExactQuery(typeFilter, statusFilter) {
  const query = {};

  if (typeFilter !== 'all') {
    query.media_type = typeFilter;
  }

  if (statusFilter !== 'all') {
    query.status = statusFilter;
  }

  return query;
}

export function normalizeMediaSearch(value) {
  return value.trim().toLowerCase();
}

export function matchesMediaLibraryFilters(entry, { typeFilter = 'all', statusFilter = 'all', searchQuery = '' } = {}) {
  if (!entry) return false;
  if (typeFilter !== 'all' && entry.media_type !== typeFilter) return false;
  if (statusFilter !== 'all' && entry.status !== statusFilter) return false;

  const normalizedSearch = normalizeMediaSearch(searchQuery);
  if (normalizedSearch && !String(entry.title || '').toLowerCase().includes(normalizedSearch)) {
    return false;
  }

  return true;
}

export function mapMediaQueryData(oldData, mapFn) {
  if (!oldData) return oldData;

  if (Array.isArray(oldData)) {
    return oldData.map(mapFn);
  }

  if (Array.isArray(oldData.pages)) {
    return {
      ...oldData,
      pages: oldData.pages.map((page) => page.map(mapFn)),
    };
  }

  return oldData;
}

export function removeMediaFromQueryData(oldData, id) {
  if (!oldData) return oldData;

  if (Array.isArray(oldData)) {
    return oldData.filter((entry) => entry.id !== id);
  }

  if (Array.isArray(oldData.pages)) {
    return {
      ...oldData,
      pages: oldData.pages.map((page) => page.filter((entry) => entry.id !== id)),
    };
  }

  return oldData;
}

export function prependMediaToQueryData(oldData, entry, limit) {
  if (!oldData) return oldData;

  if (Array.isArray(oldData)) {
    const next = [entry, ...oldData.filter((item) => item.id !== entry.id)];
    return typeof limit === 'number' ? next.slice(0, limit) : next;
  }

  if (Array.isArray(oldData.pages) && oldData.pages.length > 0) {
    const [firstPage, ...restPages] = oldData.pages;
    const nextFirstPage = [entry, ...firstPage.filter((item) => item.id !== entry.id)];

    return {
      ...oldData,
      pages: [
        typeof limit === 'number' ? nextFirstPage.slice(0, limit) : nextFirstPage,
        ...restPages,
      ],
    };
  }

  return oldData;
}

export function flattenMediaPages(data) {
  if (!data) return [];
  if (Array.isArray(data)) return normalizeMediaEntries(data);
  if (Array.isArray(data.pages)) return normalizeMediaEntries(data.pages.flat());
  return [];
}

export function hasEnoughMediaMetadata(entry) {
  if (!entry?.external_id || !entry?.media_type) {
    return true;
  }

  const sharedCoverage = [
    Array.isArray(entry.genres) && entry.genres.length > 0,
    Boolean(entry.plot),
    Boolean(entry.poster_url),
  ];

  if (entry.media_type === 'movie' || entry.media_type === 'series') {
    sharedCoverage.push(Array.isArray(entry.cast) && entry.cast.length > 0);
  }

  if (entry.media_type === 'anime' || entry.media_type === 'manga') {
    sharedCoverage.push(Boolean(entry.studio_author));
  }

  if (entry.media_type === 'book') {
    sharedCoverage.push(Boolean(entry.page_count));
  }

  if (entry.media_type === 'game') {
    sharedCoverage.push(Array.isArray(entry.platforms) && entry.platforms.length > 0);
  }

  return sharedCoverage.filter(Boolean).length >= 2;
}

export function isProviderBackedMedia(entry) {
  return Boolean(entry?.external_id);
}

export function getMediaProviderLabel(entryOrExternalId) {
  const externalId = typeof entryOrExternalId === 'string'
    ? entryOrExternalId
    : entryOrExternalId?.external_id;

  if (!externalId) return 'Manual';

  const providerKey = String(externalId).split(':')[0]?.toLowerCase();
  return PROVIDER_LABELS[providerKey] || 'Matched';
}

export function isRepairableMediaEntry(entry) {
  const normalizedEntry = normalizeMediaEntry(entry);
  if (!normalizedEntry) return false;
  return !normalizedEntry.external_id || !hasEnoughMediaMetadata(normalizedEntry);
}
