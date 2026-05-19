import Constants from 'expo-constants';
import { cacheGet, cachePut, type CacheEntry } from './geocodeCache';
import type { GeocodeOutcome, GoogleGeocodeResponse } from './types';

const API_KEY =
  ((Constants.expoConfig?.extra as Record<string, unknown> | undefined)
    ?.googleMapsApiKey as string | undefined) ?? '';

const BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Google statuses that warrant a single retry
const RETRYABLE = new Set(['UNKNOWN_ERROR', 'OVER_QUERY_LIMIT']);

// Results too vague to trust for turn-by-turn navigation
const LOW_CONFIDENCE = new Set(['APPROXIMATE']);

async function callGeocodingApi(address: string): Promise<GoogleGeocodeResponse> {
  const url = `${BASE_URL}?address=${encodeURIComponent(address)}&region=us&key=${API_KEY}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<GoogleGeocodeResponse>;
}

function extractStateCode(result: GoogleGeocodeResponse['results'][0]): string {
  const comp = result.address_components.find((c) => c.types.includes('administrative_area_level_1'));
  return comp?.short_name ?? '';
}

export async function geocodeAddress(
  address: string,
  log?: (tag: string, msg: string) => void
): Promise<GeocodeOutcome> {
  const emit = log ?? (() => undefined);

  if (!API_KEY) {
    return { success: false, error: 'Google Maps API key not configured' };
  }

  // Cache check
  const cached = await cacheGet(address);
  if (cached) {
    emit('GEOCODE', `GEOCODE_CACHE_HIT — ${address}`);
    return {
      success: true,
      lat: cached.lat,
      lng: cached.lng,
      placeId: cached.placeId,
      formattedAddress: cached.formattedAddress,
      locationType: cached.locationType,
    };
  }

  let lastError = '';

  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, 800));
    }

    try {
      const data = await callGeocodingApi(address);

      if (data.status === 'OK' && data.results.length > 0) {
        const top = data.results[0]!;
        const locationType = top.geometry.location_type;

        // Reject low-confidence geocodes
        if (LOW_CONFIDENCE.has(locationType)) {
          return {
            success: false,
            error: `Geocode confidence too low (${locationType}) — address may be missing a street number`,
          };
        }

        // Warn on state mismatch
        const stateCode = extractStateCode(top);
        if (stateCode && stateCode !== 'TN') {
          emit('GEOCODE', `GEOCODE_WARN — state mismatch: expected TN, got ${stateCode} for "${address}"`);
        }

        const entry: CacheEntry = {
          lat: top.geometry.location.lat,
          lng: top.geometry.location.lng,
          placeId: top.place_id,
          formattedAddress: top.formatted_address,
          locationType,
          resolvedAt: Date.now(),
        };

        await cachePut(address, entry);
        emit(
          'GEOCODE',
          `GEOCODE_SUCCESS — ${address} → ${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)} [${locationType}]`
        );

        return {
          success: true,
          lat: entry.lat,
          lng: entry.lng,
          placeId: entry.placeId,
          formattedAddress: entry.formattedAddress,
          locationType,
        };
      }

      if (data.status === 'ZERO_RESULTS') {
        return { success: false, error: 'No matching address found' };
      }

      lastError = data.error_message ?? data.status;

      if (!RETRYABLE.has(data.status)) {
        return { success: false, error: lastError };
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  emit('GEOCODE', `GEOCODE_FAILED — ${address}: ${lastError}`);
  return { success: false, error: lastError || 'Geocode request failed' };
}
