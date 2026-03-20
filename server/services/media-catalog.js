import { getServerEnv } from '../config/env.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const ANILIST_BASE_URL = 'https://graphql.anilist.co';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1';
const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

const SEARCH_TTL_MS = 1000 * 60 * 10;
const ENRICH_TTL_MS = 1000 * 60 * 30;
const FALLBACK_RESULT_LIMIT = 8;

export const MEDIA_BACKEND_VERSION = 'media-backend-2026-03-20-v3';
export const MEDIA_ENRICHMENT_VERSION = MEDIA_BACKEND_VERSION;

const mediaCatalogCache = (() => {
  const globalCache = globalThis;

  if (!globalCache.__mediaCatalogCache) {
    globalCache.__mediaCatalogCache = {
      search: new Map(),
      enrich: new Map(),
    };
  }

  return globalCache.__mediaCatalogCache;
})();

async function withCache(cache, key, ttlMs, producer) {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await producer();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

function filterNonEmpty(obj) {
  const result = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      result[key] = value;
    }
  }

  return result;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeStringList(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function mergeMissingFields(primary, fallback) {
  const next = { ...primary };

  for (const [key, value] of Object.entries(fallback || {})) {
    const currentValue = next[key];
    const currentEmpty = currentValue === null
      || currentValue === undefined
      || currentValue === ''
      || (Array.isArray(currentValue) && currentValue.length === 0);

    if (currentEmpty && value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      next[key] = value;
    }
  }

  return next;
}

const MERGED_ARRAY_FIELDS = [
  'genres',
  'cast',
  'themes',
  'platforms',
  'director_names',
  'creator_names',
  'author_names',
  'developer_names',
  'character_names',
  'concept_names',
  'secondary_providers',
];

function mergeStringLists(...lists) {
  return normalizeStringList(lists.flat());
}

function chooseLongerString(primary, fallback) {
  const left = String(primary || '').trim();
  const right = String(fallback || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (left.toLowerCase().includes('no description') && !right.toLowerCase().includes('no description')) return right;
  if (left.length < 120 && right.length > left.length) return right;
  return right.length > left.length ? right : left;
}

function mergeNumeric(primary, fallback) {
  const left = Number(primary);
  const right = Number(fallback);

  const hasLeft = Number.isFinite(left) && left > 0;
  const hasRight = Number.isFinite(right) && right > 0;
  if (hasLeft && hasRight) return Math.max(left, right);
  if (hasLeft) return left;
  if (hasRight) return right;
  return primary ?? fallback ?? null;
}

function buildEnrichmentMeta(primaryProvider, secondaryProviders = []) {
  return {
    primary_provider: primaryProvider,
    secondary_providers: mergeStringLists(secondaryProviders),
    enrichment_version: MEDIA_ENRICHMENT_VERSION,
    enriched_at: new Date().toISOString(),
  };
}

function finalizeLegacyMediaFields(entry = {}, mediaType = '') {
  const next = { ...entry };

  if (!next.studio_author) {
    if (mediaType === 'movie') next.studio_author = mergeStringLists(next.director_names).slice(0, 3).join(', ');
    if (mediaType === 'series') next.studio_author = next.network || mergeStringLists(next.creator_names).slice(0, 3).join(', ');
    if (mediaType === 'anime') next.studio_author = mergeStringLists(next.creator_names).slice(0, 3).join(', ');
    if (mediaType === 'manga' || mediaType === 'book') next.studio_author = mergeStringLists(next.author_names).slice(0, 4).join(', ');
    if (mediaType === 'comic') next.studio_author = next.publisher || mergeStringLists(next.creator_names).slice(0, 4).join(', ');
    if (mediaType === 'game') next.studio_author = mergeStringLists(next.developer_names).slice(0, 3).join(', ');
  }

  if (mediaType === 'comic') {
    if (!Array.isArray(next.cast) || next.cast.length === 0) {
      next.cast = mergeStringLists(next.creator_names);
    }
    if (!Array.isArray(next.themes) || next.themes.length === 0) {
      next.themes = mergeStringLists(next.character_names);
    }
    if (!Array.isArray(next.genres) || next.genres.length === 0) {
      next.genres = mergeStringLists(next.concept_names);
    }
    if (!next.issues_total && next.episodes) {
      next.issues_total = next.episodes;
    }
  }

  if ((mediaType === 'manga' || mediaType === 'book') && (!Array.isArray(next.creator_names) || next.creator_names.length === 0)) {
    next.creator_names = mergeStringLists(next.author_names);
  }

  if (mediaType === 'anime' && (!Array.isArray(next.creator_names) || next.creator_names.length === 0)) {
    next.creator_names = mergeStringLists(next.studio_author);
  }

  return filterNonEmpty(next);
}

function mergeEnrichment(primary = {}, fallback = {}, mediaType = '') {
  const merged = { ...primary };

  for (const key of MERGED_ARRAY_FIELDS) {
    merged[key] = mergeStringLists(primary[key], fallback[key]);
  }

  merged.plot = chooseLongerString(primary.plot, fallback.plot);
  merged.awards = chooseLongerString(primary.awards, fallback.awards);
  merged.language = chooseLongerString(primary.language, fallback.language);
  merged.country = chooseLongerString(primary.country, fallback.country);
  merged.duration = chooseLongerString(primary.duration, fallback.duration);
  merged.network = chooseLongerString(primary.network, fallback.network);
  merged.publisher = chooseLongerString(primary.publisher, fallback.publisher);
  merged.studio_author = chooseLongerString(primary.studio_author, fallback.studio_author);
  merged.source_url = chooseLongerString(primary.source_url, fallback.source_url);
  merged.poster_url = primary.poster_url || fallback.poster_url || '';
  merged.imdb_rating = primary.imdb_rating || fallback.imdb_rating || '';
  merged.year_released = mergeNumeric(primary.year_released, fallback.year_released);
  merged.seasons_total = mergeNumeric(primary.seasons_total, fallback.seasons_total);
  merged.episodes = mergeNumeric(primary.episodes, fallback.episodes);
  merged.chapters = mergeNumeric(primary.chapters, fallback.chapters);
  merged.volumes = mergeNumeric(primary.volumes, fallback.volumes);
  merged.page_count = mergeNumeric(primary.page_count, fallback.page_count);
  merged.issues_total = mergeNumeric(primary.issues_total, fallback.issues_total);

  return finalizeLegacyMediaFields(merged, mediaType);
}

function extractYear(value) {
  const match = String(value || '').match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isWeakSynopsis(value) {
  const text = stripHtml(value);
  if (!text) return true;
  if (text.length < 80) return true;
  if (/no synopsis|no description|coming soon|tba/i.test(text)) return true;
  return false;
}

async function fetchJson(url, init, provider) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(`${provider} request failed with status ${response.status}`);
      }
      throw new Error(`${provider} returned a non-JSON response.`);
    }
  }

  if (!response.ok) {
    const message =
      data?.status_message ||
      data?.error ||
      data?.message ||
      data?.detail ||
      `${provider} request failed with status ${response.status}`;

    throw new Error(message);
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const firstError = data.errors[0];
    throw new Error(firstError?.message || `${provider} returned an unknown GraphQL error.`);
  }

  return data;
}

function buildTmdbExternalId(resourceType, id) {
  return `tmdb:${resourceType}:${id}`;
}

function buildAniListExternalId(resourceType, id) {
  return `anilist:${resourceType}:${id}`;
}

function buildJikanExternalId(resourceType, id) {
  return `jikan:${resourceType}:${id}`;
}

function buildOpenLibraryExternalId(workId) {
  return `openlibrary:works:${workId}`;
}

function buildGoogleBooksExternalId(id) {
  return `googlebooks:${id}`;
}

function buildTmdbPosterUrl(path) {
  return path ? `${TMDB_IMAGE_BASE_URL}${path}` : null;
}

function getTmdbConfig() {
  const env = getServerEnv();
  return {
    apiKey: env.TMDB_API_KEY || '',
    bearerToken: env.TMDB_API_READ_ACCESS_TOKEN || env.TMDB_API_TOKEN || env.TMDB_BEARER_TOKEN || '',
  };
}

function getRawgKey() {
  return getServerEnv().RAWG_API_KEY || '';
}

function getComicVineKey() {
  return getServerEnv().COMICVINE_API_KEY || '';
}

function getOmdbKey() {
  return getServerEnv().OMDB_API_KEY || 'trilogy';
}

function assertTmdbConfigured() {
  const config = getTmdbConfig();
  if (!config.bearerToken && !config.apiKey) {
    throw new Error('TMDb is not configured. Set TMDB_API_READ_ACCESS_TOKEN or TMDB_API_KEY.');
  }
}

function buildTmdbRequest(path, params) {
  const { apiKey, bearerToken } = getTmdbConfig();
  assertTmdbConfigured();

  const url = new URL(`${TMDB_BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  if (!bearerToken && apiKey) {
    url.searchParams.set('api_key', apiKey);
  }

  const headers = { Accept: 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  return { url: url.toString(), init: { headers } };
}

function normalizeTmdbTitle(item, resourceType) {
  return resourceType === 'movie' ? item.title : item.name;
}

function normalizeTmdbYear(item, resourceType) {
  return extractYear(resourceType === 'movie' ? item.release_date : item.first_air_date);
}

function normalizeTmdbStudio(item, resourceType) {
  if (resourceType === 'movie') {
    const directors = normalizeStringList(
      (item.credits?.crew || [])
        .filter((person) => person.job === 'Director')
        .map((person) => person.name),
    );
    if (directors.length > 0) {
      return directors.slice(0, 3).join(', ');
    }

    return normalizeStringList((item.production_companies || []).map((company) => company.name)).slice(0, 3).join(', ');
  }

  return normalizeStringList([
    ...(item.networks || []).map((network) => network.name),
    ...(item.created_by || []).map((creator) => creator.name),
  ]).slice(0, 3).join(', ');
}

async function searchTMDb(query, type) {
  const resourceType = type === 'series' ? 'tv' : 'movie';
  const request = buildTmdbRequest(`/search/${resourceType}`, {
    query,
    include_adult: false,
    language: 'en-US',
    page: 1,
  });
  const data = await fetchJson(request.url, request.init, 'TMDb');

  return (data.results || []).slice(0, FALLBACK_RESULT_LIMIT).map((item) => ({
    external_id: buildTmdbExternalId(resourceType, item.id),
    title: normalizeTmdbTitle(item, resourceType),
    year_released: normalizeTmdbYear(item, resourceType),
    poster_url: buildTmdbPosterUrl(item.poster_path),
    source_url: `https://www.themoviedb.org/${resourceType === 'movie' ? 'movie' : 'tv'}/${item.id}`,
    media_type: type,
  }));
}

async function enrichTMDb(externalId, mediaType) {
  const parsed = parseProviderIdentity(externalId, mediaType);
  if (!parsed || parsed.provider !== 'tmdb') return {};

  const request = buildTmdbRequest(`/${parsed.resourceType}/${parsed.id}`, {
    append_to_response: 'credits,external_ids',
    language: 'en-US',
  });
  const item = await fetchJson(request.url, request.init, 'TMDb');
  const runtimeMinutes = parsed.resourceType === 'movie'
    ? item.runtime
    : Array.isArray(item.episode_run_time) && item.episode_run_time.length > 0
      ? item.episode_run_time[0]
      : null;

  const directorNames = normalizeStringList(
    (item.credits?.crew || [])
      .filter((person) => person.job === 'Director')
      .map((person) => person.name),
  );
  const creatorNames = parsed.resourceType === 'tv'
    ? normalizeStringList((item.created_by || []).map((creator) => creator.name))
    : directorNames;
  const networkNames = normalizeStringList((item.networks || []).map((network) => network.name));

  const base = finalizeLegacyMediaFields({
    genres: normalizeStringList((item.genres || []).map((genre) => genre.name)),
    studio_author: normalizeTmdbStudio(item, parsed.resourceType),
    director_names: directorNames,
    creator_names: creatorNames,
    network: parsed.resourceType === 'tv' ? networkNames[0] || '' : '',
    year_released: normalizeTmdbYear(item, parsed.resourceType),
    poster_url: buildTmdbPosterUrl(item.poster_path),
    source_url: `https://www.themoviedb.org/${parsed.resourceType === 'movie' ? 'movie' : 'tv'}/${parsed.id}`,
    plot: String(item.overview || '').trim(),
    duration: runtimeMinutes ? `${runtimeMinutes} min` : '',
    cast: normalizeStringList((item.credits?.cast || []).slice(0, 8).map((person) => person.name)),
    language: normalizeStringList((item.spoken_languages || []).map((language) => language.english_name || language.name)).join(', '),
    country: normalizeStringList([
      ...(item.production_countries || []).map((country) => country.name),
      ...(item.origin_country || []),
    ]).join(', '),
    imdb_rating: Number.isFinite(Number(item.vote_average)) && Number(item.vote_average) > 0
      ? `${Number(item.vote_average).toFixed(1)}/10`
      : '',
    seasons_total: parsed.resourceType === 'tv' ? item.number_of_seasons || null : null,
    episodes: parsed.resourceType === 'tv' ? item.number_of_episodes || null : null,
    ...buildEnrichmentMeta('tmdb'),
  }, mediaType);

  const imdbId = String(item.external_ids?.imdb_id || item.imdb_id || '').trim();
  if (!imdbId) {
    return base;
  }

  try {
    const omdb = await enrichOMDB(imdbId);
    const merged = mergeEnrichment(base, omdb, mediaType);
    return {
      ...merged,
      ...buildEnrichmentMeta('tmdb', ['omdb']),
    };
  } catch {
    return base;
  }
}

async function postAniList(query, variables) {
  return fetchJson(ANILIST_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  }, 'AniList');
}

function normalizeAniListTitle(title) {
  return String(title?.english || title?.romaji || title?.userPreferred || title?.native || '').trim();
}

function normalizeAniListCreator(item, mediaType) {
  if (mediaType === 'anime') {
    return normalizeStringList((item.studios?.nodes || []).map((studio) => studio.name)).slice(0, 3).join(', ');
  }

  const authorEdges = (item.staff?.edges || []).filter((edge) => {
    const role = String(edge?.role || '').toLowerCase();
    return role.includes('story') || role.includes('author') || role.includes('art');
  });

  return normalizeStringList(authorEdges.map((edge) => edge?.node?.name?.full)).slice(0, 4).join(', ');
}

const ANILIST_SEARCH_QUERY = `
  query SearchMedia($search: String, $type: MediaType) {
    Page(perPage: 8) {
      media(search: $search, type: $type, sort: SEARCH_MATCH) {
        id
        idMal
        title { romaji english native userPreferred }
        startDate { year }
        coverImage { large medium }
        siteUrl
        genres
        episodes
        chapters
        volumes
        studios(isMain: true) { nodes { name } }
        staff(perPage: 6, sort: [RELEVANCE]) { edges { role node { name { full } } } }
      }
    }
  }
`;

const ANILIST_DETAIL_QUERY = `
  query MediaDetails($id: Int, $type: MediaType) {
    Media(id: $id, type: $type) {
      id
      idMal
      title { romaji english native userPreferred }
      startDate { year }
      coverImage { extraLarge large medium }
      siteUrl
      genres
      episodes
      chapters
      volumes
      duration
      description(asHtml: false)
      averageScore
      countryOfOrigin
      tags { name rank }
      studios(isMain: true) { nodes { name } }
      staff(perPage: 10, sort: [RELEVANCE]) { edges { role node { name { full } } } }
    }
  }
`;

async function searchAniList(query, type) {
  const aniListType = type === 'anime' ? 'ANIME' : 'MANGA';
  const data = await postAniList(ANILIST_SEARCH_QUERY, { search: query, type: aniListType });

  return (data.data?.Page?.media || []).map((item) => ({
    external_id: buildAniListExternalId(type, item.id),
    title: normalizeAniListTitle(item.title),
    year_released: item.startDate?.year || null,
    poster_url: item.coverImage?.large || item.coverImage?.medium || null,
    source_url: item.siteUrl || null,
    media_type: type,
    genres: item.genres || [],
    episodes: type === 'anime' ? item.episodes || null : item.chapters || null,
    studio_author: normalizeAniListCreator(item, type),
  }));
}

async function enrichAniList(externalId, mediaType) {
  const parsed = parseProviderIdentity(externalId, mediaType);
  if (!parsed || parsed.provider !== 'anilist') return {};

  const aniListType = parsed.resourceType === 'anime' ? 'ANIME' : 'MANGA';
  const data = await postAniList(ANILIST_DETAIL_QUERY, {
    id: Number.parseInt(parsed.id, 10),
    type: aniListType,
  });
  const item = data.data?.Media;
  if (!item) return {};

  const creatorNames = mediaType === 'anime'
    ? normalizeStringList((item.studios?.nodes || []).map((studio) => studio.name))
    : normalizeStringList((item.staff?.edges || [])
      .filter((edge) => {
        const role = String(edge?.role || '').toLowerCase();
        return role.includes('story') || role.includes('author') || role.includes('art');
      })
      .map((edge) => edge?.node?.name?.full));

  const base = finalizeLegacyMediaFields({
    genres: item.genres || [],
    themes: normalizeStringList((item.tags || []).filter((tag) => Number(tag.rank || 0) >= 60).slice(0, 6).map((tag) => tag.name)),
    studio_author: normalizeAniListCreator(item, mediaType),
    creator_names: creatorNames,
    author_names: mediaType === 'manga' ? creatorNames : [],
    year_released: item.startDate?.year || null,
    poster_url: item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium || null,
    plot: stripHtml(item.description),
    source_url: item.siteUrl || '',
    imdb_rating: Number.isFinite(Number(item.averageScore)) && Number(item.averageScore) > 0
      ? `${(Number(item.averageScore) / 10).toFixed(1)}/10`
      : '',
    country: item.countryOfOrigin || '',
    episodes: mediaType === 'anime' ? item.episodes || null : null,
    chapters: mediaType === 'manga' ? item.chapters || null : null,
    volumes: mediaType === 'manga' ? item.volumes || null : null,
    duration: mediaType === 'anime' && item.duration ? `${item.duration} min/ep` : '',
    ...buildEnrichmentMeta('anilist'),
  }, mediaType);

  if (item.idMal) {
    try {
      const fallback = await enrichJikan(String(item.idMal), mediaType);
      const merged = mergeEnrichment(base, fallback, mediaType);
      return {
        ...merged,
        ...buildEnrichmentMeta('anilist', ['jikan']),
      };
    } catch {
      return base;
    }
  }

  try {
    const jikanResults = await searchJikan(normalizeAniListTitle(item.title), mediaType, true);
    const fallbackIdentity = parseProviderIdentity(String(jikanResults[0]?.external_id || ''), mediaType);
    if (!fallbackIdentity || fallbackIdentity.provider !== 'jikan') {
      return base;
    }
    const fallback = await enrichJikan(fallbackIdentity.id, mediaType);
    const merged = mergeEnrichment(base, fallback, mediaType);
    return {
      ...merged,
      ...buildEnrichmentMeta('anilist', ['jikan']),
    };
  } catch {
    return base;
  }
}

async function searchJikan(query, type, prefixed = false) {
  const endpoint = type === 'manga' ? 'manga' : 'anime';
  const data = await fetchJson(`${JIKAN_BASE_URL}/${endpoint}?q=${encodeURIComponent(query)}&limit=8`, undefined, 'Jikan');

  return (data.data || []).map((item) => ({
    external_id: prefixed ? buildJikanExternalId(type, item.mal_id) : String(item.mal_id),
    title: item.title,
    year_released: item.year || null,
    poster_url: item.images?.jpg?.image_url || null,
    source_url: item.url,
    media_type: type,
    genres: (item.genres || []).map((genre) => genre.name),
    episodes: item.episodes || null,
    studio_author: normalizeStringList((item.studios || item.authors || []).map((source) => source.name)).join(', '),
  }));
}

async function searchGoogleBooks(query, prefixed = false) {
  const data = await fetchJson(`${GOOGLE_BOOKS_BASE_URL}/volumes?q=${encodeURIComponent(query)}&maxResults=8`, undefined, 'Google Books');

  return (data.items || []).map((item) => {
    const info = item.volumeInfo || {};
    return {
      external_id: prefixed ? buildGoogleBooksExternalId(item.id) : item.id,
      title: info.title,
      year_released: info.publishedDate ? extractYear(info.publishedDate) : null,
      poster_url: info.imageLinks?.thumbnail?.replace('http://', 'https://') || null,
      source_url: info.infoLink || null,
      media_type: 'book',
      studio_author: normalizeStringList(info.authors || []).join(', '),
      genres: info.categories || [],
      page_count: info.pageCount || null,
    };
  });
}

async function searchOpenLibrary(query) {
  const url = new URL(`${OPEN_LIBRARY_BASE_URL}/search.json`);
  url.searchParams.set('title', query);
  url.searchParams.set('limit', String(FALLBACK_RESULT_LIMIT));
  const data = await fetchJson(url.toString(), undefined, 'Open Library');

  return (data.docs || []).map((item) => {
    const key = String(item.key || '').replace('/works/', '').trim();
    if (!key) return null;

    return {
      external_id: buildOpenLibraryExternalId(key),
      title: item.title,
      year_released: item.first_publish_year || null,
      poster_url: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : null,
      source_url: `${OPEN_LIBRARY_BASE_URL}/works/${key}`,
      media_type: 'book',
      studio_author: normalizeStringList(item.author_name || []).slice(0, 4).join(', '),
      genres: normalizeStringList(item.subject || []).slice(0, 5),
      page_count: item.number_of_pages_median || null,
    };
  }).filter(Boolean);
}

async function searchRAWGGames(query) {
  const rawgKey = getRawgKey();
  if (!rawgKey) {
    throw new Error('RAWG is not configured. Set RAWG_API_KEY.');
  }

  const data = await fetchJson(`https://api.rawg.io/api/games?search=${encodeURIComponent(query)}&page_size=8&key=${rawgKey}`, undefined, 'RAWG');

  return (data.results || []).map((item) => ({
    external_id: String(item.id),
    title: item.name,
    year_released: item.released ? extractYear(item.released) : null,
    poster_url: item.background_image || null,
    source_url: item.website || null,
    media_type: 'game',
    genres: (item.genres || []).map((genre) => genre.name),
    studio_author: normalizeStringList((item.platforms || []).map((platform) => platform.platform.name)).join(', '),
  }));
}

async function searchComicVine(query) {
  const comicVineKey = getComicVineKey();
  if (!comicVineKey) {
    throw new Error('ComicVine is not configured. Set COMICVINE_API_KEY.');
  }

  const data = await fetchJson(
    `https://comicvine.gamespot.com/api/search/?api_key=${comicVineKey}&format=json&resources=volume&query=${encodeURIComponent(query)}&field_list=id,name,start_year,image,site_detail_url,publisher,count_of_issues&limit=8`,
    undefined,
    'ComicVine',
  );

  return (data.results || []).map((item) => ({
    external_id: String(item.id),
    title: item.name,
    year_released: item.start_year ? Number.parseInt(item.start_year, 10) : null,
    poster_url: item.image?.medium_url || null,
    source_url: item.site_detail_url || null,
    media_type: 'comic',
    studio_author: item.publisher?.name || null,
    episodes: item.count_of_issues || null,
  }));
}

async function enrichOMDB(externalId) {
  const omdbKey = getOmdbKey();
  const data = await fetchJson(`https://www.omdbapi.com/?i=${externalId}&apikey=${omdbKey}`, undefined, 'OMDb');

  if (data.Response === 'False') return {};

  return finalizeLegacyMediaFields({
    genres: data.Genre ? data.Genre.split(', ') : [],
    studio_author: data.Director !== 'N/A' ? data.Director : (data.Production || ''),
    director_names: data.Director !== 'N/A' ? data.Director.split(', ').filter(Boolean) : [],
    year_released: extractYear(data.Year),
    poster_url: data.Poster !== 'N/A' ? data.Poster : null,
    seasons_total: data.totalSeasons ? Number.parseInt(data.totalSeasons, 10) : null,
    plot: data.Plot !== 'N/A' ? data.Plot : '',
    duration: data.Runtime !== 'N/A' ? data.Runtime : '',
    cast: data.Actors !== 'N/A' ? data.Actors.split(', ') : [],
    language: data.Language !== 'N/A' ? data.Language : '',
    country: data.Country !== 'N/A' ? data.Country : '',
    imdb_rating: data.imdbRating !== 'N/A' ? `${data.imdbRating}/10` : '',
    awards: data.Awards !== 'N/A' ? data.Awards : '',
    source_url: `https://www.imdb.com/title/${externalId}`,
    ...buildEnrichmentMeta('omdb'),
  });
}

async function countAnimeSeasons(malId) {
  try {
    const data = await fetchJson(`${JIKAN_BASE_URL}/anime/${malId}/relations`, undefined, 'Jikan');
    const relations = data.data || [];
    let sequelCount = 0;

    for (const relation of relations) {
      if (relation.relation === 'Sequel' || relation.relation === 'Prequel') {
        sequelCount += relation.entry?.filter((entry) => entry.type === 'anime').length || 0;
      }
    }

    return sequelCount > 0 ? sequelCount + 1 : null;
  } catch {
    return null;
  }
}

async function enrichJikan(externalId, mediaType) {
  const endpoint = mediaType === 'manga' ? 'manga' : 'anime';
  const data = await fetchJson(`${JIKAN_BASE_URL}/${endpoint}/${externalId}/full`, undefined, 'Jikan');
  const item = data.data;

  if (!item) return {};

  const creatorNames = mediaType === 'anime'
    ? normalizeStringList((item.studios || []).map((source) => source.name))
    : normalizeStringList((item.authors || []).map((source) => source.name));

  const base = {
    genres: (item.genres || []).map((genre) => genre.name),
    themes: normalizeStringList([
      ...(item.themes || []).map((theme) => theme.name),
      ...(item.demographics || []).map((theme) => theme.name),
      ...(item.explicit_genres || []).map((theme) => theme.name),
    ]),
    studio_author: creatorNames.join(', '),
    creator_names: creatorNames,
    author_names: mediaType === 'manga' ? creatorNames : [],
    year_released: item.year || (item.aired?.from ? new Date(item.aired.from).getFullYear() : null),
    poster_url: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || null,
    plot: item.synopsis || '',
    source_url: item.url || '',
    imdb_rating: item.score ? `${item.score}/10` : '',
  };

  if (mediaType === 'manga') {
    base.chapters = item.chapters || null;
    base.volumes = item.volumes || null;
  } else {
    base.episodes = item.episodes || null;
    base.duration = item.duration || '';
    const seasonCount = await countAnimeSeasons(externalId);
    if (seasonCount && seasonCount > 1) {
      base.seasons_total = seasonCount;
    }
  }

  if (mediaType === 'anime' && isWeakSynopsis(base.plot)) {
    base.plot = String(item.background || item.synopsis || '').trim();
  }

  return finalizeLegacyMediaFields({
    ...base,
    ...buildEnrichmentMeta('jikan'),
  }, mediaType);
}

async function enrichGoogleBooksById(volumeId) {
  const data = await fetchJson(`${GOOGLE_BOOKS_BASE_URL}/volumes/${volumeId}`, undefined, 'Google Books');
  const info = data.volumeInfo;
  if (!info) return {};

  return finalizeLegacyMediaFields({
    genres: info.categories || [],
    studio_author: normalizeStringList(info.authors || []).join(', '),
    author_names: normalizeStringList(info.authors || []),
    year_released: info.publishedDate ? extractYear(info.publishedDate) : null,
    poster_url: info.imageLinks?.thumbnail?.replace('http://', 'https://') || null,
    plot: info.description ? info.description.substring(0, 400) : '',
    page_count: info.pageCount || null,
    language: info.language || '',
    imdb_rating: info.averageRating ? `${info.averageRating}/5` : '',
    source_url: info.infoLink || null,
    ...buildEnrichmentMeta('googlebooks'),
  }, 'book');
}

function pickDescription(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.value === 'string') return value.value;
  return '';
}

function pickCoverFromIds(covers) {
  const coverId = Array.isArray(covers) && covers.length > 0 ? covers[0] : null;
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
}

function parseEditionPageCount(edition) {
  if (Number.isFinite(Number(edition?.number_of_pages))) {
    return Number(edition.number_of_pages);
  }

  const paginationMatch = String(edition?.pagination || '').match(/\d+/);
  return paginationMatch ? Number.parseInt(paginationMatch[0], 10) : null;
}

async function enrichOpenLibrary(externalId) {
  const parsed = parseProviderIdentity(externalId, 'book');
  if (!parsed || parsed.provider !== 'openlibrary') return {};

  const workId = parsed.id;
  const work = await fetchJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}.json`, undefined, 'Open Library');

  const authorKeys = (work.authors || [])
    .map((author) => String(author?.author?.key || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const authors = await Promise.all(
    authorKeys.map(async (authorKey) => {
      try {
        const author = await fetchJson(`${OPEN_LIBRARY_BASE_URL}${authorKey}.json`, undefined, 'Open Library');
        return author?.name || null;
      } catch {
        return null;
      }
    }),
  );
  const editions = await fetchJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}/editions.json?limit=10`, undefined, 'Open Library');
  const editionEntries = Array.isArray(editions.entries) ? editions.entries : [];
  const firstEditionWithPages = editionEntries.find((edition) => parseEditionPageCount(edition));
  const firstEdition = editionEntries[0] || null;
  const title = String(work.title || '').trim();

  const authorNames = normalizeStringList(authors);
  const base = finalizeLegacyMediaFields({
    genres: normalizeStringList(work.subjects || []).slice(0, 8),
    studio_author: authorNames.join(', '),
    author_names: authorNames,
    year_released: extractYear(work.first_publish_date) || extractYear(firstEdition?.publish_date),
    poster_url: pickCoverFromIds(work.covers) || pickCoverFromIds(firstEdition?.covers),
    plot: pickDescription(work.description).slice(0, 400),
    page_count: parseEditionPageCount(firstEditionWithPages) || parseEditionPageCount(firstEdition),
    source_url: `${OPEN_LIBRARY_BASE_URL}/works/${workId}`,
    language: normalizeStringList((firstEdition?.languages || []).map((language) => language?.key?.split('/')?.pop())).join(', '),
    ...buildEnrichmentMeta('openlibrary'),
  }, 'book');

  if (!title) {
    return base;
  }

  const fallbackQuery = normalizeStringList([title, base.studio_author]).join(' ');
  if (!fallbackQuery) return base;

  let fallbackIdentity = null;
  try {
    const fallbackResults = await searchGoogleBooks(fallbackQuery, true);
    fallbackIdentity = parseProviderIdentity(String(fallbackResults[0]?.external_id || ''), 'book');
  } catch {
    fallbackIdentity = null;
  }

  if (!fallbackIdentity || fallbackIdentity.provider !== 'googlebooks') {
    return base;
  }

  try {
    const fallback = await enrichGoogleBooksById(fallbackIdentity.id);
    const merged = mergeEnrichment(base, fallback, 'book');
    return {
      ...merged,
      ...buildEnrichmentMeta('openlibrary', ['googlebooks']),
    };
  } catch {
    return base;
  }
}

async function enrichRAWG(externalId) {
  const rawgKey = getRawgKey();
  if (!rawgKey) {
    throw new Error('RAWG is not configured. Set RAWG_API_KEY.');
  }

  const data = await fetchJson(`https://api.rawg.io/api/games/${externalId}?key=${rawgKey}`, undefined, 'RAWG');
  if (!data || data.detail) return {};

  const developerNames = normalizeStringList((data.developers || []).map((developer) => developer.name));
  const publisherNames = normalizeStringList((data.publishers || []).map((publisher) => publisher.name));
  return finalizeLegacyMediaFields({
    genres: (data.genres || []).map((genre) => genre.name),
    studio_author: developerNames.join(', '),
    developer_names: developerNames,
    publisher: publisherNames[0] || '',
    year_released: data.released ? extractYear(data.released) : null,
    poster_url: data.background_image || null,
    plot: data.description_raw ? data.description_raw.substring(0, 400) : '',
    source_url: data.website || null,
    platforms: (data.platforms || []).map((platform) => platform.platform.name),
    duration: data.playtime ? `${data.playtime} hours` : '',
    imdb_rating: data.metacritic ? `${data.metacritic}/100` : '',
    themes: (data.tags || []).slice(0, 6).map((tag) => tag.name),
    ...buildEnrichmentMeta('rawg'),
  }, 'game');
}

async function enrichComicVine(externalId) {
  const comicVineKey = getComicVineKey();
  if (!comicVineKey) {
    throw new Error('ComicVine is not configured. Set COMICVINE_API_KEY.');
  }

  const data = await fetchJson(
    `https://comicvine.gamespot.com/api/volume/4050-${externalId}/?api_key=${comicVineKey}&format=json&field_list=id,name,start_year,image,site_detail_url,publisher,count_of_issues,description,characters,people,concepts`,
    undefined,
    'ComicVine',
  );
  const item = data.results;
  if (!item) return {};

  const creatorNames = (item.people || []).slice(0, 8).map((person) => person.name);
  const characterNames = (item.characters || []).slice(0, 6).map((character) => character.name);
  const conceptNames = (item.concepts || []).slice(0, 6).map((concept) => concept.name);

  return finalizeLegacyMediaFields({
    year_released: item.start_year ? Number.parseInt(item.start_year, 10) : null,
    poster_url: item.image?.medium_url || null,
    source_url: item.site_detail_url || null,
    studio_author: item.publisher?.name || null,
    publisher: item.publisher?.name || '',
    episodes: item.count_of_issues || null,
    issues_total: item.count_of_issues || null,
    plot: item.description ? stripHtml(item.description).substring(0, 400) : '',
    cast: creatorNames,
    creator_names: creatorNames,
    character_names: characterNames,
    concept_names: conceptNames,
    themes: characterNames,
    genres: conceptNames,
    ...buildEnrichmentMeta('comicvine'),
  }, 'comic');
}

function parseProviderIdentity(externalId, mediaType) {
  const trimmed = String(externalId || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('tmdb:')) {
    const [, resourceType, id] = trimmed.split(':');
    if ((resourceType === 'movie' || resourceType === 'tv') && id) {
      return { provider: 'tmdb', resourceType, id };
    }
  }

  if (trimmed.startsWith('anilist:')) {
    const [, resourceType, id] = trimmed.split(':');
    if ((resourceType === 'anime' || resourceType === 'manga') && id) {
      return { provider: 'anilist', resourceType, id };
    }
  }

  if (trimmed.startsWith('jikan:')) {
    const [, resourceType, id] = trimmed.split(':');
    if ((resourceType === 'anime' || resourceType === 'manga') && id) {
      return { provider: 'jikan', resourceType, id };
    }
  }

  if (trimmed.startsWith('openlibrary:works:')) {
    return { provider: 'openlibrary', resourceType: 'works', id: trimmed.split(':').slice(2).join(':') };
  }

  if (trimmed.startsWith('googlebooks:')) {
    return { provider: 'googlebooks', id: trimmed.split(':').slice(1).join(':') };
  }

  if (mediaType === 'movie' || mediaType === 'series') {
    if (/^tt\d+$/i.test(trimmed)) {
      return { provider: 'legacy_omdb', id: trimmed };
    }
  }

  if (mediaType === 'anime' || mediaType === 'manga') {
    if (/^\d+$/.test(trimmed)) {
      return { provider: 'legacy_jikan', resourceType: mediaType, id: trimmed };
    }
  }

  if (mediaType === 'book') {
    return { provider: 'legacy_googlebooks', id: trimmed };
  }

  if (mediaType === 'game') {
    return { provider: 'rawg', id: trimmed };
  }

  if (mediaType === 'comic') {
    return { provider: 'comicvine', id: trimmed };
  }

  return null;
}

export async function searchMediaCatalog(query, type) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return [];

  return withCache(mediaCatalogCache.search, `${type}:${normalizedQuery}`, SEARCH_TTL_MS, async () => {
    if (type === 'movie' || type === 'series') {
      return searchTMDb(query, type);
    }

    if (type === 'anime' || type === 'manga') {
      try {
        const primary = await searchAniList(query, type);
        if (primary.length > 0) return primary;
      } catch (error) {
        try {
          return await searchJikan(query, type, true);
        } catch (fallbackError) {
          throw new Error(`AniList and Jikan search failed: ${toErrorMessage(error)} | ${toErrorMessage(fallbackError)}`);
        }
      }

      return searchJikan(query, type, true);
    }

    if (type === 'book') {
      try {
        const primary = await searchOpenLibrary(query);
        if (primary.length > 0) return primary;
      } catch (error) {
        try {
          return await searchGoogleBooks(query, true);
        } catch (fallbackError) {
          throw new Error(`Open Library and Google Books search failed: ${toErrorMessage(error)} | ${toErrorMessage(fallbackError)}`);
        }
      }

      return searchGoogleBooks(query, true);
    }

    if (type === 'game') return searchRAWGGames(query);
    if (type === 'comic') return searchComicVine(query);
    return [];
  });
}

export async function enrichMediaCatalog(externalId, mediaType) {
  if (!externalId) return {};

  return withCache(mediaCatalogCache.enrich, `${mediaType}:${externalId}`, ENRICH_TTL_MS, async () => {
    const parsed = parseProviderIdentity(externalId, mediaType);
    if (!parsed) return {};

    if (parsed.provider === 'tmdb') return enrichTMDb(externalId, mediaType);
    if (parsed.provider === 'anilist') return enrichAniList(externalId, mediaType);
    if (parsed.provider === 'jikan') return enrichJikan(parsed.id, mediaType);
    if (parsed.provider === 'openlibrary') return enrichOpenLibrary(externalId);
    if (parsed.provider === 'googlebooks' || parsed.provider === 'legacy_googlebooks') return enrichGoogleBooksById(parsed.id);
    if (parsed.provider === 'legacy_omdb') return enrichOMDB(parsed.id);
    if (parsed.provider === 'legacy_jikan') return enrichJikan(parsed.id, mediaType);
    if (parsed.provider === 'rawg') return enrichRAWG(parsed.id);
    if (parsed.provider === 'comicvine') return enrichComicVine(parsed.id);

    return {};
  });
}

export function getMediaCatalogHealth() {
  const tmdb = getTmdbConfig();
  const rawgKey = getRawgKey();
  const comicVineKey = getComicVineKey();

  return {
    media_backend_version: MEDIA_BACKEND_VERSION,
    providers: {
      tmdb: {
        status: tmdb.bearerToken || tmdb.apiKey ? 'configured' : 'missing_config',
        enabled_types: ['movie', 'series'],
      },
      anilist: {
        status: 'public',
        enabled_types: ['anime', 'manga'],
      },
      openlibrary: {
        status: 'public',
        enabled_types: ['book'],
      },
      rawg: {
        status: rawgKey ? 'configured' : 'missing_config',
        enabled_types: ['game'],
      },
      comicvine: {
        status: comicVineKey ? 'configured' : 'missing_config',
        enabled_types: ['comic'],
      },
    },
  };
}
