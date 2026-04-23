let cachedEnv = null;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return '';
}

export function getServerEnv() {
  if (cachedEnv) return cachedEnv;

  cachedEnv = {
    NODE_ENV: normalizeString(process.env.NODE_ENV) || 'development',
    SUPABASE_URL: normalizeString(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: normalizeString(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_ANON_KEY: normalizeString(process.env.SUPABASE_ANON_KEY),
    GOOGLE_GEMINI_API_KEY: normalizeString(process.env.GOOGLE_GEMINI_API_KEY),
    GOOGLE_GEMINI_MODEL_CHEAP: normalizeString(process.env.GOOGLE_GEMINI_MODEL_CHEAP) || 'gemini-2.5-flash-lite',
    GOOGLE_GEMINI_MODEL_STANDARD: normalizeString(process.env.GOOGLE_GEMINI_MODEL_STANDARD) || 'gemini-2.5-flash',
    GOOGLE_GEMINI_MODEL_PREMIUM: normalizeString(process.env.GOOGLE_GEMINI_MODEL_PREMIUM) || 'gemini-2.5-pro',
    TMDB_API_KEY: normalizeString(process.env.TMDB_API_KEY),
    TMDB_API_READ_ACCESS_TOKEN: normalizeString(process.env.TMDB_API_READ_ACCESS_TOKEN),
    TMDB_API_TOKEN: normalizeString(process.env.TMDB_API_TOKEN),
    TMDB_BEARER_TOKEN: normalizeString(process.env.TMDB_BEARER_TOKEN),
    RAWG_API_KEY: normalizeString(process.env.RAWG_API_KEY),
    COMICVINE_API_KEY: normalizeString(process.env.COMICVINE_API_KEY),
    OMDB_API_KEY: normalizeString(process.env.OMDB_API_KEY),
    OPENROUTER_API_KEY: normalizeString(process.env.OPENROUTER_API_KEY),
    OPENROUTER_BASE_URL: normalizeString(process.env.OPENROUTER_BASE_URL) || 'https://openrouter.ai/api/v1',
    OPENROUTER_MODEL_CHEAP: normalizeString(process.env.OPENROUTER_MODEL_CHEAP) || 'qwen/qwen-2.5-7b-instruct',
    OPENROUTER_MODEL_STANDARD: normalizeString(process.env.OPENROUTER_MODEL_STANDARD) || 'mistralai/mistral-small-3.2-24b-instruct',
    OPENROUTER_MODEL_PREMIUM: normalizeString(process.env.OPENROUTER_MODEL_PREMIUM) || 'anthropic/claude-3.7-sonnet',
    HUGGINGFACE_API_KEY: normalizeString(process.env.HUGGINGFACE_API_KEY),
    HUGGINGFACE_BASE_URL: normalizeString(process.env.HUGGINGFACE_BASE_URL) || 'https://router.huggingface.co/v1',
    HUGGINGFACE_MODEL_CHEAP: normalizeString(process.env.HUGGINGFACE_MODEL_CHEAP),
    HUGGINGFACE_MODEL_STANDARD: normalizeString(process.env.HUGGINGFACE_MODEL_STANDARD),
    HUGGINGFACE_MODEL_PREMIUM: normalizeString(process.env.HUGGINGFACE_MODEL_PREMIUM),
    GOOGLE_CLIENT_ID: normalizeString(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: normalizeString(process.env.GOOGLE_CLIENT_SECRET),
    GOOGLE_OAUTH_REDIRECT_URI: normalizeString(process.env.GOOGLE_OAUTH_REDIRECT_URI),
    GOOGLE_OAUTH_STATE_SECRET: normalizeString(process.env.GOOGLE_OAUTH_STATE_SECRET),
    GOOGLE_TOKEN_ENCRYPTION_KEY: normalizeString(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    LIFEOS_DEV_USER_ID: normalizeString(process.env.LIFEOS_DEV_USER_ID),
    LIFEOS_DEV_USER_EMAIL: normalizeString(process.env.LIFEOS_DEV_USER_EMAIL),
    LIFEOS_DEV_USER_NAME: normalizeString(process.env.LIFEOS_DEV_USER_NAME),
    LIFEOS_SHORTCUT_CAPTURE_TOKEN: normalizeString(process.env.LIFEOS_SHORTCUT_CAPTURE_TOKEN),
    LIFEOS_SHORTCUT_CAPTURE_USER_ID: normalizeString(process.env.LIFEOS_SHORTCUT_CAPTURE_USER_ID),
    LIFEOS_LOG_VERBOSE: normalizeBoolean(process.env.LIFEOS_LOG_VERBOSE, false),
    APP_ORIGIN: normalizeString(process.env.APP_ORIGIN),
    SUPABASE_STORAGE_BUCKET_UPLOADS: normalizeString(process.env.SUPABASE_STORAGE_BUCKET_UPLOADS) || 'uploads',
    SUPABASE_STORAGE_BUCKET_RESOURCE_THUMBNAILS: normalizeString(process.env.SUPABASE_STORAGE_BUCKET_RESOURCE_THUMBNAILS) || 'resource-thumbnails',
    INSTAGRAM_DOWNLOADER_BASE_URL: normalizeString(process.env.INSTAGRAM_DOWNLOADER_BASE_URL),
    INSTAGRAM_DOWNLOADER_SHARED_SECRET: normalizeString(process.env.INSTAGRAM_DOWNLOADER_SHARED_SECRET),
    INSTAGRAM_DOWNLOADER_TIMEOUT_MS: Number(process.env.INSTAGRAM_DOWNLOADER_TIMEOUT_MS || 120000),
    INSTAGRAM_DOWNLOADER_STATUS_STALE_MS: Number(process.env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS || 90000),
    YOUTUBE_TRANSCRIPT_WORKER_BASE_URL: firstNonEmpty(process.env.YOUTUBE_TRANSCRIPT_WORKER_BASE_URL, process.env.INSTAGRAM_DOWNLOADER_BASE_URL),
    YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET: firstNonEmpty(process.env.YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET, process.env.INSTAGRAM_DOWNLOADER_SHARED_SECRET),
    YOUTUBE_TRANSCRIPT_WORKER_TIMEOUT_MS: Number(process.env.YOUTUBE_TRANSCRIPT_WORKER_TIMEOUT_MS || process.env.INSTAGRAM_DOWNLOADER_TIMEOUT_MS || 120000),
    YOUTUBE_TRANSCRIPT_WORKER_STATUS_STALE_MS: Number(process.env.YOUTUBE_TRANSCRIPT_WORKER_STATUS_STALE_MS || process.env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS || 90000),
    CRON_SECRET: normalizeString(process.env.CRON_SECRET),
    YTDLP_BIN: normalizeString(process.env.YTDLP_BIN) || 'yt-dlp',
    YTDLP_TIMEOUT_MS: Number(process.env.YTDLP_TIMEOUT_MS || 20000),
  };

  return cachedEnv;
}

export function hasSupabaseServerConfig() {
  const env = getServerEnv();
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasAiProviderConfig() {
  const env = getServerEnv();
  return Boolean(env.GOOGLE_GEMINI_API_KEY || env.OPENROUTER_API_KEY || env.HUGGINGFACE_API_KEY);
}

export function hasGoogleOAuthConfig() {
  const env = getServerEnv();
  return Boolean(
    env.GOOGLE_CLIENT_ID
    && env.GOOGLE_CLIENT_SECRET
    && env.GOOGLE_OAUTH_REDIRECT_URI
    && env.GOOGLE_OAUTH_STATE_SECRET
    && env.GOOGLE_TOKEN_ENCRYPTION_KEY
  );
}
