export const runtimeConfig = {
  authMode: import.meta.env.VITE_LIFEOS_AUTH_MODE || 'supabase',
  apiMode: import.meta.env.VITE_LIFEOS_API_MODE || 'hybrid',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
};

export function hasSupabaseBrowserConfig() {
  return Boolean(runtimeConfig.supabaseUrl && runtimeConfig.supabasePublishableKey);
}

export function shouldUseSupabaseAuth() {
  return runtimeConfig.authMode === 'supabase' && hasSupabaseBrowserConfig();
}

export function shouldUseBackendApi() {
  return runtimeConfig.apiMode === 'hybrid' || runtimeConfig.apiMode === 'supabase';
}
