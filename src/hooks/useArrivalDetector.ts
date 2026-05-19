import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import type { Stop } from '../models/Stop';

// ── Constants ────────────────────────────────────────────────────

export const ARRIVAL_THRESHOLD_FEET = 150;
const FEET_PER_METER = 3.28084;

// ── Haversine distance ────────────────────────────────────────────

/** Returns distance in feet between two GPS coordinates. */
export function haversineDistanceFeet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(a));
  return meters * FEET_PER_METER;
}

// ── Hook ─────────────────────────────────────────────────────────

interface ArrivalDetectorOptions {
  /** The stop currently being navigated to. */
  currentStop: Stop | null;
  /** Whether foreground location permission has been granted. */
  permissionGranted: boolean;
  /** Distance in feet that triggers arrival. Default: 150 ft. */
  thresholdFeet?: number;
  /** Fires once per stop when the driver enters the threshold radius. */
  onArrived: (stop: Stop, distanceFeet: number) => void;
  /** Fires on every location update with current distance — optional, for UI display. */
  onDistanceUpdate?: (distanceFeet: number) => void;
  /** Fires on every location update with the position timestamp — for GPS health monitoring. */
  onPositionReceived?: (timestamp: number) => void;
}

/**
 * Isolated GPS-based arrival detection service.
 * - Zero SDK calls, zero UI, zero orchestration side-effects.
 * - Subscribes to watchPositionAsync when currentStop is set and permission granted.
 * - Fires onArrived at most once per stop (duplicate-arrival guard via ref).
 * - Callbacks are read via refs so the subscription never re-opens due to stale closures.
 * - Cleans up and re-subscribes only when currentStop.id or permissionGranted changes.
 */
export function useArrivalDetector({
  currentStop,
  permissionGranted,
  thresholdFeet = ARRIVAL_THRESHOLD_FEET,
  onArrived,
  onDistanceUpdate,
  onPositionReceived,
}: ArrivalDetectorOptions): void {
  // Stable callback refs — updating these never triggers a re-subscription
  const onArrivedRef = useRef(onArrived);
  const onDistanceUpdateRef = useRef(onDistanceUpdate);
  const onPositionReceivedRef = useRef(onPositionReceived);
  useEffect(() => { onArrivedRef.current = onArrived; });
  useEffect(() => { onDistanceUpdateRef.current = onDistanceUpdate; });
  useEffect(() => { onPositionReceivedRef.current = onPositionReceived; });

  // Per-subscription arrival guard — reset when currentStop.id changes
  const arrivedFiredRef = useRef(false);

  const currentStopId = currentStop?.id;

  useEffect(() => {
    if (!permissionGranted || !currentStop) return;

    // New stop — reset arrival guard
    arrivedFiredRef.current = false;

    const stop = currentStop; // capture so location callback always references this stop
    let active = true;
    let subscription: Location.LocationSubscription | null = null;

    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 8,   // update every ~26 ft of movement
        timeInterval: 2500,
      },
      (location) => {
        if (!active) return;

        onPositionReceivedRef.current?.(location.timestamp ?? Date.now());

        const distFeet = haversineDistanceFeet(
          location.coords.latitude,
          location.coords.longitude,
          stop.latitude,
          stop.longitude
        );

        onDistanceUpdateRef.current?.(distFeet);

        if (distFeet <= thresholdFeet && !arrivedFiredRef.current) {
          arrivedFiredRef.current = true;
          onArrivedRef.current(stop, distFeet);
        }
      }
    ).then((sub) => {
      if (!active) {
        sub.remove();
        return;
      }
      subscription = sub;
    });

    return () => {
      active = false;
      subscription?.remove();
    };
    // Intentionally excludes thresholdFeet — changing threshold mid-stop
    // would re-subscribe needlessly; threshold is set once at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStopId, permissionGranted]);
}
