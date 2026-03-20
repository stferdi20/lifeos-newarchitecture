import { createClient } from '@supabase/supabase-js';
import { hasSupabaseBrowserConfig, runtimeConfig } from '@/lib/runtime-config';

let browserClient = null;

export function getSupabaseBrowserClient() {
  if (!hasSupabaseBrowserConfig()) return null;

  if (!browserClient) {
    browserClient = createClient(
      runtimeConfig.supabaseUrl,
      runtimeConfig.supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return browserClient;
}

export async function getSupabaseAccessToken() {
  const client = getSupabaseBrowserClient();
  if (!client) return '';

  const { data } = await client.auth.getSession();
  return data.session?.access_token || '';
}
