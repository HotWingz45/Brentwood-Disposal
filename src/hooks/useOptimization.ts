import { useState, useCallback } from 'react';
import type { Stop } from '../models/Stop';
import type { OptimizationStrategy, OptimizationResult } from '../services/optimization/types';
import { optimizeRoute } from '../services/optimization/optimizeRoute';

type OptimizationStatus = 'idle' | 'running' | 'done' | 'error';

interface OptimizationState {
  status: OptimizationStatus;
  result: OptimizationResult | null;
  error: string | null;
}

export interface UseOptimizationResult {
  status: OptimizationStatus;
  result: OptimizationResult | null;
  error: string | null;
  run: (
    stops: Stop[],
    strategy: OptimizationStrategy,
    log: (tag: string, msg: string) => void
  ) => void;
  reset: () => void;
}

/**
 * Isolated optimization state machine.
 * - Zero SDK calls, zero persistence, zero UI.
 * - optimizeRoute is synchronous (pure CPU); status transitions are instantaneous.
 */
export function useOptimization(): UseOptimizationResult {
  const [state, setState] = useState<OptimizationState>({
    status: 'idle',
    result: null,
    error: null,
  });

  const run = useCallback(
    (
      stops: Stop[],
      strategy: OptimizationStrategy,
      log: (tag: string, msg: string) => void
    ) => {
      if (stops.length === 0) {
        setState({ status: 'done', result: null, error: null });
        return;
      }
      setState({ status: 'running', result: null, error: null });
      try {
        const result = optimizeRoute(stops, strategy, log);
        setState({ status: 'done', result, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('OPTIMIZE', `OPTIMIZATION_ERROR: ${msg}`);
        setState({ status: 'idle', result: null, error: msg });
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState({ status: 'idle', result: null, error: null });
  }, []);

  return { ...state, run, reset };
}
