import { useCallback, useReducer } from 'react';
import { StopStatus, type Stop } from '../models/Stop';

// ── State / Actions ──────────────────────────────────────────────

type State = {
  stops: Stop[];
  currentStopIndex: number;
};

type Action =
  | { type: 'RESTORE'; stops: Stop[]; currentStopIndex: number }
  | { type: 'MARK_NAVIGATING' }
  | { type: 'MARK_ARRIVED' }
  | { type: 'COMPLETE' }
  | { type: 'SKIP' };

function updateCurrent(stops: Stop[], index: number, patch: Partial<Stop>): Stop[] {
  return stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

function reducer(state: State, action: Action): State {
  const { stops, currentStopIndex } = state;
  const now = Date.now();

  switch (action.type) {
    case 'RESTORE':
      return {
        stops: action.stops,
        currentStopIndex: action.currentStopIndex,
      };

    case 'MARK_NAVIGATING':
      return {
        ...state,
        stops: updateCurrent(stops, currentStopIndex, {
          status: StopStatus.NAVIGATING,
          navigatingAt: now,
        }),
      };

    case 'MARK_ARRIVED':
      return {
        ...state,
        stops: updateCurrent(stops, currentStopIndex, {
          status: StopStatus.ARRIVED,
          arrivedAt: now,
        }),
      };

    case 'COMPLETE':
      return {
        stops: updateCurrent(stops, currentStopIndex, {
          status: StopStatus.COMPLETED,
          completedAt: now,
        }),
        currentStopIndex: currentStopIndex + 1,
      };

    case 'SKIP':
      return {
        stops: updateCurrent(stops, currentStopIndex, {
          status: StopStatus.SKIPPED,
          completedAt: now,
        }),
        currentStopIndex: currentStopIndex + 1,
      };
  }
}

// ── Public interface ─────────────────────────────────────────────

export interface RouteOrchestratorResult {
  stops: Stop[];
  currentStopIndex: number;
  currentStop: Stop | null;
  nextStop: Stop | null;
  previousStop: Stop | null;
  completedCount: number;
  skippedCount: number;
  remainingCount: number;
  isFinished: boolean;
  restoreSession: (stops: Stop[], currentStopIndex: number) => void;
  markNavigating: () => void;
  markArrived: () => void;
  markCompleted: () => void;
  skipStop: () => void;
  getRemainingStops: () => Stop[];
}

/**
 * Pure route orchestration engine — zero Navigation SDK calls.
 * The screen layer listens to currentStop and feeds it into the SDK.
 * Future: pass stop arrays from PDF ingestion instead of hardcoded data.
 */
export function useRouteOrchestrator(initialStops: Stop[]): RouteOrchestratorResult {
  const [{ stops, currentStopIndex }, dispatch] = useReducer(reducer, {
    stops: initialStops,
    currentStopIndex: 0,
  });

  const isFinished = currentStopIndex >= stops.length;
  const currentStop = !isFinished ? (stops[currentStopIndex] ?? null) : null;
  const nextStop =
    currentStopIndex + 1 < stops.length
      ? (stops[currentStopIndex + 1] ?? null)
      : null;
  const previousStop =
    currentStopIndex > 0 ? (stops[currentStopIndex - 1] ?? null) : null;

  const completedCount = stops.filter((s) => s.status === StopStatus.COMPLETED).length;
  const skippedCount = stops.filter((s) => s.status === StopStatus.SKIPPED).length;
  const remainingCount = isFinished ? 0 : stops.length - currentStopIndex - 1;

  const restoreSession = useCallback(
    (stops: Stop[], currentStopIndex: number) =>
      dispatch({ type: 'RESTORE', stops, currentStopIndex }),
    []
  );
  const markNavigating = useCallback(() => dispatch({ type: 'MARK_NAVIGATING' }), []);
  const markArrived = useCallback(() => dispatch({ type: 'MARK_ARRIVED' }), []);
  const markCompleted = useCallback(() => dispatch({ type: 'COMPLETE' }), []);
  const skipStop = useCallback(() => dispatch({ type: 'SKIP' }), []);

  const getRemainingStops = useCallback(
    () =>
      stops
        .slice(currentStopIndex + 1)
        .filter(
          (s) => s.status !== StopStatus.COMPLETED && s.status !== StopStatus.SKIPPED
        ),
    [stops, currentStopIndex]
  );

  return {
    stops,
    currentStopIndex,
    currentStop,
    nextStop,
    previousStop,
    completedCount,
    skippedCount,
    remainingCount,
    isFinished,
    restoreSession,
    markNavigating,
    markArrived,
    markCompleted,
    skipStop,
    getRemainingStops,
  };
}
