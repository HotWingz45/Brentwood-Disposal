import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as
  | { supabaseUrl?: string; supabaseAnonKey?: string }
  | undefined;

const supabaseUrl     = extra?.supabaseUrl ?? '';
const supabaseAnonKey = extra?.supabaseAnonKey ?? '';

export function isBackendConfigured(): boolean {
  return supabaseUrl.length > 0 && supabaseAnonKey.length > 0;
}

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isBackendConfigured()) return null;
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession:      false,
        autoRefreshToken:    false,
        detectSessionInUrl:  false,
      },
    });
  }
  return _client;
}
