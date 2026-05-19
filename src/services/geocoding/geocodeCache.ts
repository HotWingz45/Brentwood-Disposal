import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@brentwood_disposal/geocode_cache';

export interface CacheEntry {
  lat: number;
  lng: number;
  placeId: string;
  formattedAddress: string;
  locationType: string;
  resolvedAt: number; // unix ms
}

// Module-level in-memory map — loaded lazily from AsyncStorage
let memCache: Map<string, CacheEntry> | null = null;

function normalize(address: string): string {
  return address.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function loadCache(): Promise<Map<string, CacheEntry>> {
  if (memCache) return memCache;
  try {
    const json = await AsyncStorage.getItem(CACHE_KEY);
    if (json) {
      const obj = JSON.parse(json) as Record<string, CacheEntry>;
      memCache = new Map(Object.entries(obj));
    } else {
      memCache = new Map();
    }
  } catch {
    memCache = new Map();
  }
  return memCache;
}

function persistAsync(cache: Map<string, CacheEntry>): void {
  const obj = Object.fromEntries(cache);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(obj)).catch((err) =>
    console.error('[GeocodeCache] persist failed:', err)
  );
}

export async function cacheGet(address: string): Promise<CacheEntry | null> {
  const cache = await loadCache();
  return cache.get(normalize(address)) ?? null;
}

export async function cachePut(address: string, entry: CacheEntry): Promise<void> {
  const cache = await loadCache();
  cache.set(normalize(address), entry);
  persistAsync(cache);
}

export async function cacheClear(): Promise<void> {
  memCache = new Map();
  await AsyncStorage.removeItem(CACHE_KEY).catch((err) =>
    console.error('[GeocodeCache] clear failed:', err)
  );
}
