import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient, isBackendConfigured } from './supabaseClient';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
import { withRetry } from './retryHelper';
import type { DriverProfile } from './types';

const DRIVER_ID_KEY = '@brentwood/driver_id';

export async function getOrCreateDriverProfile(): Promise<DriverProfile> {
  let stored = await AsyncStorage.getItem(DRIVER_ID_KEY);
  if (!stored) {
    stored = generateId();
    await AsyncStorage.setItem(DRIVER_ID_KEY, stored);
  }
  const id: string = stored;

  return {
    id,
    createdAt: Date.now(),
    deviceInfo: 'react-native',
  };
}

export async function syncDriverProfile(
  profile: DriverProfile,
  log: (tag: string, msg: string) => void,
): Promise<void> {
  if (!isBackendConfigured()) return;

  const client = getSupabaseClient();
  if (!client) return;

  try {
    await withRetry(async () => {
      const { error } = await client.from('drivers').upsert(
        {
          id:          profile.id,
          device_info: profile.deviceInfo,
          created_at:  new Date(profile.createdAt).toISOString(),
          last_seen:   new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
      if (error) throw error;
    });
    log('SYNC', `Driver profile synced — id:${profile.id}`);
  } catch (err) {
    log('SYNC', `Driver sync failed — ${String(err)}`);
  }
}
