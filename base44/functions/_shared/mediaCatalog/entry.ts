const TMDB_API_KEY = Deno.env.get('TMDB_API_KEY') || '';
const TMDB_BEARER_TOKEN =
  Deno.env.get('TMDB_API_READ_ACCESS_TOKEN') ||
  Deno.env.get('TMDB_API_TOKEN') ||
  Deno.env.get('TMDB_BEARER_TOKEN') ||
  '';
const RAWG_KEY = Deno.env.get('RAWG_API_KEY');
const COMICVINE_KEY = Deno.env.get('COMICVINE_API_KEY');
const OMDB_KEY = Deno.env.get('OMDB_API_KEY') || 'trilogy';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const ANILIST_BASE_URL = 'https://graphql.anilist.co';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1';
const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

const SEARCH_TTL_MS = 1000 * 60 * 10;
const ENRICH_TTL_MS = 1000 * 60 * 30;
const FALLBACK_RESULT_LIMIT = 8;

export const MEDIA_BACKEND_VERSION = 'media-backend-2026-03-19-v1';

type MediaType = 'movie' | 'series' | 'anime' | 'manga' | 'comic' | 'book' | 'game';

type CacheValue<T> = {
  expiresAt: number;
  value: T;
};

type MediaCatalogCache = {
  search: Map<string, CacheValue<any[]>>;
  enrich: Map<string, CacheValue<Record<string, unknown>>>;
};

type ProviderIdentity =
  | { provider: 'tmdb'; resourceType: 'movie' | 'tv'; id: string }
  | { provider: 'anilist'; resourceType: 'anime' | 'manga'; id: string }
  | { provider: 'jikan'; resourceType: 'anime' | 'manga'; id: string }
  | { provider: 'openlibrary'; resourceType: 'works'; id: string }
  | { provider: 'googlebooks'; id: string }
  | { provider: 'legacy_omdb'; id: string }
  | { provider: 'legacy_jikan'; resourceType: 'anime' | 'manga'; id: string }
  | { provider: 'legacy_googlebooks'; id: string }
  | { provider: 'rawg'; id: string }
  | { provider: 'comicvine'; id: string };

type ProviderHealthStatus = 'configured' | 'missing_config' | 'public';

type MediaCatalogHealth = {
  media_backend_version: string;
  providers: {
    tmdb: { status: ProviderHealthStatus; enabled_types: string[] };
    anilist: { status: ProviderHealthStatus; enabled_types: string[] };
    openlibrary: { status: ProviderHealthStatus; enabled_types: string[] };
    rawg: { status: ProviderHealthStatus; enabled_types: string[] };
    comicvine: { status: ProviderHealthStatus; enabled_types: string[] };
  };
};

const mediaCatalogCache: MediaCatalogCache = (() => {
  const globalCache = globalThis as typeof globalThis & {
    __mediaCatalogCache?: MediaCatalogCache;
  };

  if (!globalCache.__mediaCatalogCache) {
    globalCache.__mediaCatalogCache = {
      search: new Map(),
      enrich: new Map(),
    };
  }

  return globalCache.__mediaCatalogCache;
})();

async function withCache<T>(
  cache: Map<string, CacheValue<T>>,
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
) {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await producer();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

function filterNonEmpty<T extends Record<string, unknown>>(obj: T) {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      result[key] = value;
    }
  }

  return result;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeStringList(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function mergeMissingFields<T extends Record<string, unknown>>(primary: T, fallback: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...primary };

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

  return next as T;
}

function extractYear(value: string | null | undefined) {
  const match = String(value || '').match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function stripHtml(value: string | null | undefined) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url: string, init: RequestInit | undefined, provider: string) {
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

function buildTmdbExternalId(resourceType: 'movie' | 'tv', id: string | number) {
  return `tmdb:${resourceType}:${id}`;
}

function buildAniListExternalId(resourceType: 'anime' | 'manga', id: string | number) {
  return `anilist:${resourceType}:${id}`;
}

function buildJikanExternalId(resourceType: 'anime' | 'manga', id: string | number) {
  return `jikan:${resourceType}:${id}`;
}

function buildOpenLibraryExternalId(workId: string) {
  return `openlibrary:works:${workId}`;
}

function buildGoogleBooksExternalId(id: string) {
  return `googlebooks:${id}`;
}

function buildTmdbPosterUrl(path: string | null | undefined) {
  return path ? `${TMDB_IMAGE_BASE_URL}${path}` : null;
}

function assertTmdbConfigured() {
  if (!TMDB_BEARER_TOKEN && !TMDB_API_KEY) {
    throw new Error('TMDb is not configured. Set TMDB_API_READ_ACCESS_TOKEN or TMDB_API_KEY.');
  }
}

function buildTmdbRequest(path: string, params: Record<string, string | number | boolean | undefined>) {
  assertTmdbConfigured();

  const url = new URL(`${TMDB_BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  if (!TMDB_BEARER_TOKEN && TMDB_API_KEY) {
    url.searchParams.set('api_key', TMDB_API_KEY);
  }

  const headers: HeadersInit = {
    Accept: 'application/json',
  };

  if (TMDB_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${TMDB_BEARER_TOKEN}`;
  }

  return { url: url.toString(), init: { headers } };
}

function normalizeTmdbTitle(item: any, resourceType: 'movie' | 'tv') {
  return resourceType === 'movie' ? item.title : item.name;
}

function normalizeTmdbYear(item: any, resourceType: 'movie' | 'tv') {
  return extractYear(resourceType === 'movie' ? item.release_date : item.first_air_date);
}

function normalizeTmdbStudio(item: any, resourceType: 'movie' | 'tv') {
  if (resourceType === 'movie') {
    return normalizeStringList((item.production_companies || []).map((company: any) => company.name)).slice(0, 3).join(', ');
  }

  return normalizeStringList([
    ...(item.networks || []).map((network: any) => network.name),
    ...(item.created_by || []).map((creator: any) => creator.name),
  ]).slice(0, 3).join(', ');
}

async function searchTMDb(query: string, type: MediaType) {
  const resourceType = type === 'series' ? 'tv' : 'movie';
  const request = buildTmdbRequest(`/search/${resourceType}`, {
    query,
    include_adult: false,
    language: 'en-US',
    page: 1,
  });
  const data = await fetchJson(request.url, request.init, 'TMDb');

  return (data.results || []).slice(0, FALLBACK_RESULT_LIMIT).map((item: any) => ({
    external_id: buildTmdbExternalId(resourceType, item.id),
    title: normalizeTmdbTitle(item, resourceType),
    year_released: normalizeTmdbYear(item, resourceType),
    poster_url: buildTmdbPosterUrl(item.poster_path),
    source_url: `https://www.themoviedb.org/${resourceType === 'movie' ? 'movie' : 'tv'}/${item.id}`,
    media_type: type,
  }));
}

async function enrichTMDb(externalId: string, mediaType: MediaType) {
  const parsed = parseProviderIdentity(externalId, mediaType);
  if (!parsed || parsed.provider !== 'tmdb') {
    return {};
  }

  const request = buildTmdbRequest(`/${parsed.resourceType}/${parsed.id}`, {
    append_to_response: 'credits',
    language: 'en-US',
  });
  const item = await fetchJson(request.url, request.init, 'TMDb');
  const runtimeMinutes = parsed.resourceType === 'movie'
    ? item.runtime
    : Array.isArray(item.episode_run_time) && item.episode_run_time.length > 0
      ? item.episode_run_time[0]
      : null;

  return filterNonEmpty({
    genres: normalizeStringList((item.genres || []).map((genre: any) => genre.name)),
    studio_author: normalizeTmdbStudio(item, parsed.resourceType),
    year_released: normalizeTmdbYear(item, parsed.resourceType),
    poster_url: buildTmdbPosterUrl(item.poster_path),
    source_url: `https://www.themoviedb.org/${parsed.resourceType === 'movie' ? 'movie' : 'tv'}/${parsed.id}`,
    plot: String(item.overview || '').trim(),
    duration: runtimeMinutes ? `${runtimeMinutes} min` : '',
    cast: normalizeStringList((item.credits?.cast || []).slice(0, 8).map((person: any) => person.name)),
    language: normalizeStringList((item.spoken_languages || []).map((language: any) => language.english_name || language.name)).join(', '),
    country: normalizeStringList([
      ...(item.production_countries || []).map((country: any) => country.name),
      ...(item.origin_country || []),
    ]).join(', '),
    imdb_rating: Number.isFinite(Number(item.vote_average)) && Number(item.vote_average) > 0
      ? `${Number(item.vote_average).toFixed(1)}/10`
      : '',
    seasons_total: parsed.resourceType === 'tv' ? item.number_of_seasons || null : null,
    episodes: parsed.resourceType === 'tv' ? item.number_of_episodes || null : null,
  });
}

async function postAniList<T>(query: string, variables: Record<string, unknown>) {
  return fetchJson(ANILIST_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  }, 'AniList') as Promise<T>;
}

function normalizeAniListTitle(title: any) {
  return String(title?.english || title?.romaji || title?.userPreferred || title?.native || '').trim();
}

function normalizeAniListCreator(item: any, mediaType: MediaType) {
  if (mediaType === 'anime') {
    return normalizeStringList((item.studios?.nodes || []).map((studio: any) => studio.name)).slice(0, 3).join(', ');
  }

  const authorEdges = (item.staff?.edges || []).filter((edge: any) => {
    const role = String(edge?.role || '').toLowerCase();
    return role.includes('story') || role.includes('author') || role.includes('art');
  });

  return normalizeStringList(authorEdges.map((edge: any) => edge?.node?.name?.full)).slice(0, 4).join(', ');
}

const ANILIST_SEARCH_QUERY = `
  query SearchMedia($search: String, $type: MediaType) {
    Page(perPage: 8) {
      media(search: $search, type: $type, sort: SEARCH_MATCH) {
        id
        idMal
        title {
          romaji
          english
          native
          userPreferred
        }
        startDate {
          year
        }
        coverImage {
          large
          medium
        }
        siteUrl
        genres
        episodes
        chapters
        volumes
        studios(isMain: true) {
          nodes {
            name
          }
        }
        staff(perPage: 6, sort: [RELEVANCE]) {
          edges {
            role
            node {
              name {
                full
              }
            }
          }
        }
      }
    }
  }
`;

const ANILIST_DETAIL_QUERY = `
  query MediaDetails($id: Int, $type: MediaType) {
    Media(id: $id, type: $type) {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      startDate {
        year
      }
      coverImage {
        extraLarge
        large
        medium
      }
      siteUrl
      genres
      episodes
      chapters
      volumes
      duration
      description(asHtml: false)
      averageScore
      countryOfOrigin
      tags {
        name
        rank
      }
      studios(isMain: true) {
        nodes {
          name
        }
      }
      staff(perPage: 10, sort: [RELEVANCE]) {
        edges {
          role
          node {
            name {
              full
            }
          }
        }
      }
    }
  }
`;

async function searchAniList(query: string, type: MediaType) {
  const aniListType = type === 'anime' ? 'ANIME' : 'MANGA';
  const data = await postAniList<{ data?: { Page?: { media?: any[] } } }>(ANILIST_SEARCH_QUERY, {
    search: query,
    type: aniListType,
  });

  return (data.data?.Page?.media || []).map((item: any) => ({
    external_id: buildAniListExternalId(type as 'anime' | 'manga', item.id),
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

function hasAniListCoreMetadata(result: Record<string, unknown>) {
  return Boolean(result.poster_url) && Boolean(result.plot) && (
    (Array.isArray(result.genres) && result.genres.length > 0) || Boolean(result.studio_author)
  );
}

async function enrichAniList(externalId: string, mediaType: MediaType) {
  const parsed = parseProviderIdentity(externalId, mediaType);
  if (!parsed || parsed.provider !== 'anilist') {
    return {};
  }

  const aniListType = parsed.resourceType === 'anime' ? 'ANIME' : 'MANGA';
  const data = await postAniList<{ data?: { Media?: any } }>(ANILIST_DETAIL_QUERY, {
    id: Number.parseInt(parsed.id, 10),
    type: aniListType,
  });
  const item = data.data?.Media;

  if (!item) {
    return {};
  }

  const base = filterNonEmpty({
    genres: item.genres || [],
    themes: normalizeStringList((item.tags || []).filter((tag: any) => Number(tag.rank || 0) >= 60).slice(0, 6).map((tag: any) => tag.name)),
    studio_author: normalizeAniListCreator(item, mediaType),
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
  });

  if (!item.idMal || hasAniListCoreMetadata(base)) {
    return base;
  }

  const fallback = await enrichJikan(String(item.idMal), mediaType);
  return mergeMissingFields(base, fallback);
}

async function searchJikan(query: string, type: MediaType, prefixed = false) {
  const endpoint = type === 'manga' ? 'manga' : 'anime';
  const data = await fetchJson(`${JIKAN_BASE_URL}/${endpoint}?q=${encodeURIComponent(query)}&limit=8`, undefined, 'Jikan');

  return (data.data || []).map((item: any) => ({
    external_id: prefixed ? buildJikanExternalId(type as 'anime' | 'manga', item.mal_id) : String(item.mal_id),
    title: item.title,
    year_released: item.year || null,
    poster_url: item.images?.jpg?.image_url || null,
    source_url: item.url,
    media_type: type,
    genres: (item.genres || []).map((genre: any) => genre.name),
    episodes: item.episodes || null,
    studio_author: normalizeStringList((item.studios || item.authors || []).map((source: any) => source.name)).join(', '),
  }));
}

async function searchGoogleBooks(query: string, prefixed = false) {
  const data = await fetchJson(`${GOOGLE_BOOKS_BASE_URL}/volumes?q=${encodeURIComponent(query)}&maxResults=8`, undefined, 'Google Books');

  return (data.items || []).map((item: any) => {
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

async function searchOpenLibrary(query: string) {
  const url = new URL(`${OPEN_LIBRARY_BASE_URL}/search.json`);
  url.searchParams.set('title', query);
  url.searchParams.set('limit', String(FALLBACK_RESULT_LIMIT));
  const data = await fetchJson(url.toString(), undefined, 'Open Library');

  return (data.docs || []).map((item: any) => {
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

async function searchRAWGGames(query: string) {
  if (!RAWG_KEY) {
    throw new Error('RAWG is not configured. Set RAWG_API_KEY.');
  }

  const data = await fetchJson(`https://api.rawg.io/api/games?search=${encodeURIComponent(query)}&page_size=8&key=${RAWG_KEY}`, undefined, 'RAWG');

  return (data.results || []).map((item: any) => ({
    external_id: String(item.id),
    title: item.name,
    year_released: item.released ? extractYear(item.released) : null,
    poster_url: item.background_image || null,
    media_type: 'game',
    genres: (item.genres || []).map((genre: any) => genre.name),
    studio_author: normalizeStringList((item.platforms || []).map((platform: any) => platform.platform.name)).join(', '),
  }));
}

async function searchComicVine(query: string) {
  if (!COMICVINE_KEY) {
    throw new Error('ComicVine is not configured. Set COMICVINE_API_KEY.');
  }

  const data = await fetchJson(
    `https://comicvine.gamespot.com/api/search/?api_key=${COMICVINE_KEY}&format=json&resources=volume&query=${encodeURIComponent(query)}&field_list=id,name,start_year,image,site_detail_url,publisher,count_of_issues&limit=8`,
    undefined,
    'ComicVine',
  );

  return (data.results || []).map((item: any) => ({
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

async function enrichOMDB(externalId: string) {
  const data = await fetchJson(`https://www.omdbapi.com/?i=${externalId}&apikey=${OMDB_KEY}`, undefined, 'OMDb');

  if (data.Response === 'False') return {};

  return filterNonEmpty({
    genres: data.Genre ? data.Genre.split(', ') : [],
    studio_author: data.Director !== 'N/A' ? data.Director : (data.Production || ''),
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
  });
}

async function countAnimeSeasons(malId: string) {
  try {
    const data = await fetchJson(`${JIKAN_BASE_URL}/anime/${malId}/relations`, undefined, 'Jikan');
    const relations = data.data || [];
    let sequelCount = 0;

    for (const relation of relations) {
      if (relation.relation === 'Sequel' || relation.relation === 'Prequel') {
        sequelCount += relation.entry?.filter((entry: any) => entry.type === 'anime').length || 0;
      }
    }

    return sequelCount > 0 ? sequelCount + 1 : null;
  } catch {
    return null;
  }
}

async function enrichJikan(externalId: string, mediaType: MediaType) {
  const endpoint = mediaType === 'manga' ? 'manga' : 'anime';
  const data = await fetchJson(`${JIKAN_BASE_URL}/${endpoint}/${externalId}/full`, undefined, 'Jikan');
  const item = data.data;

  if (!item) return {};

  const base: Record<string, unknown> = {
    genres: (item.genres || []).map((genre: any) => genre.name),
    themes: (item.themes || []).map((theme: any) => theme.name),
    studio_author: normalizeStringList((item.studios || item.authors || []).map((source: any) => source.name)).join(', '),
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

  return filterNonEmpty(base);
}

async function enrichGoogleBooksById(volumeId: string) {
  const data = await fetchJson(`${GOOGLE_BOOKS_BASE_URL}/volumes/${volumeId}`, undefined, 'Google Books');
  const info = data.volumeInfo;

  if (!info) return {};

  return filterNonEmpty({
    genres: info.categories || [],
    studio_author: normalizeStringList(info.authors || []).join(', '),
    year_released: info.publishedDate ? extractYear(info.publishedDate) : null,
    poster_url: info.imageLinks?.thumbnail?.replace('http://', 'https://') || null,
    plot: info.description ? info.description.substring(0, 400) : '',
    page_count: info.pageCount || null,
    language: info.language || '',
    imdb_rating: info.averageRating ? `${info.averageRating}/5` : '',
    source_url: info.infoLink || null,
  });
}

function pickDescription(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.value === 'string') return value.value;
  return '';
}

function pickCoverFromIds(covers: any[]) {
  const coverId = Array.isArray(covers) && covers.length > 0 ? covers[0] : null;
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
}

function parseEditionPageCount(edition: any) {
  if (Number.isFinite(Number(edition?.number_of_pages))) {
    return Number(edition.number_of_pages);
  }

  const paginationMatch = String(edition?.pagination || '').match(/\d+/);
  return paginationMatch ? Number.parseInt(paginationMatch[0], 10) : null;
}

async function enrichOpenLibrary(externalId: string) {
  const parsed = parseProviderIdentity(externalId, 'book');
  if (!parsed || parsed.provider !== 'openlibrary') {
    return {};
  }

  const workId = parsed.id;
  const work = await fetchJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}.json`, undefined, 'Open Library');

  const authorKeys = (work.authors || [])
    .map((author: any) => String(author?.author?.key || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const authors = await Promise.all(
    authorKeys.map(async (authorKey: string) => {
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
  const firstEditionWithPages = editionEntries.find((edition: any) => parseEditionPageCount(edition));
  const firstEdition = editionEntries[0] || null;
  const title = String(work.title || '').trim();

  const base = filterNonEmpty({
    genres: normalizeStringList(work.subjects || []).slice(0, 8),
    studio_author: normalizeStringList(authors).join(', '),
    year_released: extractYear(work.first_publish_date) || extractYear(firstEdition?.publish_date),
    poster_url: pickCoverFromIds(work.covers) || pickCoverFromIds(firstEdition?.covers),
    plot: pickDescription(work.description).slice(0, 400),
    page_count: parseEditionPageCount(firstEditionWithPages) || parseEditionPageCount(firstEdition),
    source_url: `${OPEN_LIBRARY_BASE_URL}/works/${workId}`,
    language: normalizeStringList((firstEdition?.languages || []).map((language: any) => language?.key?.split('/')?.pop())).join(', '),
  });

  if ((base.plot && base.page_count && base.poster_url) || !title) {
    return base;
  }

  const fallbackQuery = normalizeStringList([title, base.studio_author as string]).join(' ');
  if (!fallbackQuery) {
    return base;
  }

  const fallbackResults = await searchGoogleBooks(fallbackQuery, true);
  const fallbackIdentity = parseProviderIdentity(String(fallbackResults[0]?.external_id || ''), 'book');
  if (!fallbackIdentity || fallbackIdentity.provider !== 'googlebooks') {
    return base;
  }

  const fallback = await enrichGoogleBooksById(fallbackIdentity.id);
  return mergeMissingFields(base, fallback);
}

async function enrichRAWG(externalId: string) {
  if (!RAWG_KEY) {
    throw new Error('RAWG is not configured. Set RAWG_API_KEY.');
  }

  const data = await fetchJson(`https://api.rawg.io/api/games/${externalId}?key=${RAWG_KEY}`, undefined, 'RAWG');

  if (!data || data.detail) return {};

  return filterNonEmpty({
    genres: (data.genres || []).map((genre: any) => genre.name),
    studio_author: normalizeStringList((data.developers || []).map((developer: any) => developer.name)).join(', '),
    year_released: data.released ? extractYear(data.released) : null,
    poster_url: data.background_image || null,
    plot: data.description_raw ? data.description_raw.substring(0, 400) : '',
    source_url: data.website || null,
    platforms: (data.platforms || []).map((platform: any) => platform.platform.name),
    duration: data.playtime ? `${data.playtime} hours` : '',
    imdb_rating: data.metacritic ? `${data.metacritic}/100` : '',
    themes: (data.tags || []).slice(0, 6).map((tag: any) => tag.name),
  });
}

async function enrichComicVine(externalId: string) {
  if (!COMICVINE_KEY) {
    throw new Error('ComicVine is not configured. Set COMICVINE_API_KEY.');
  }

  const data = await fetchJson(
    `https://comicvine.gamespot.com/api/volume/4050-${externalId}/?api_key=${COMICVINE_KEY}&format=json&field_list=id,name,start_year,image,site_detail_url,publisher,count_of_issues,description,characters,people,concepts`,
    undefined,
    'ComicVine',
  );
  const item = data.results;

  if (!item) return {};

  return filterNonEmpty({
    year_released: item.start_year ? Number.parseInt(item.start_year, 10) : null,
    poster_url: item.image?.medium_url || null,
    source_url: item.site_detail_url || null,
    studio_author: item.publisher?.name || null,
    episodes: item.count_of_issues || null,
    plot: item.description ? stripHtml(item.description).substring(0, 400) : '',
    cast: (item.people || []).slice(0, 8).map((person: any) => person.name),
    themes: (item.characters || []).slice(0, 6).map((character: any) => character.name),
    genres: (item.concepts || []).slice(0, 5).map((concept: any) => concept.name),
  });
}

function parseProviderIdentity(externalId: string, mediaType: MediaType): ProviderIdentity | null {
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

export async function searchMediaCatalog(query: string, type: MediaType) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return [];

  return withCache(mediaCatalogCache.search, `${type}:${normalizedQuery}`, SEARCH_TTL_MS, async () => {
    if (type === 'movie' || type === 'series') {
      return searchTMDb(query, type);
    }

    if (type === 'anime' || type === 'manga') {
      try {
        const primary = await searchAniList(query, type);
        if (primary.length > 0) {
          return primary;
        }
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
        if (primary.length > 0) {
          return primary;
        }
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

export async function enrichMediaCatalog(externalId: string, mediaType: MediaType) {
  if (!externalId) return {};

  return withCache(mediaCatalogCache.enrich, `${mediaType}:${externalId}`, ENRICH_TTL_MS, async () => {
    const parsed = parseProviderIdentity(externalId, mediaType);

    if (!parsed) {
      return {};
    }

    if (parsed.provider === 'tmdb') {
      return enrichTMDb(externalId, mediaType);
    }

    if (parsed.provider === 'anilist') {
      return enrichAniList(externalId, mediaType);
    }

    if (parsed.provider === 'jikan') {
      return enrichJikan(parsed.id, mediaType);
    }

    if (parsed.provider === 'openlibrary') {
      return enrichOpenLibrary(externalId);
    }

    if (parsed.provider === 'googlebooks' || parsed.provider === 'legacy_googlebooks') {
      return enrichGoogleBooksById(parsed.id);
    }

    if (parsed.provider === 'legacy_omdb') {
      return enrichOMDB(parsed.id);
    }

    if (parsed.provider === 'legacy_jikan') {
      return enrichJikan(parsed.id, mediaType);
    }

    if (parsed.provider === 'rawg') {
      return enrichRAWG(parsed.id);
    }

    if (parsed.provider === 'comicvine') {
      return enrichComicVine(parsed.id);
    }

    return {};
  });
}

export function getMediaCatalogHealth(): MediaCatalogHealth {
  return {
    media_backend_version: MEDIA_BACKEND_VERSION,
    providers: {
      tmdb: {
        status: TMDB_BEARER_TOKEN || TMDB_API_KEY ? 'configured' : 'missing_config',
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
        status: RAWG_KEY ? 'configured' : 'missing_config',
        enabled_types: ['game'],
      },
      comicvine: {
        status: COMICVINE_KEY ? 'configured' : 'missing_config',
        enabled_types: ['comic'],
      },
    },
  };
}
