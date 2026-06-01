import { useState, useCallback } from 'react';
import { runImportPipeline, pickRouteFile } from '../services/routeImport';
import type { ImportResult, ImportPhase } from '../services/routeImport';

export interface RouteImportHookResult {
  phase: ImportPhase;
  result: ImportResult | null;
  error: string | null;
  pickFile: () => Promise<void>;
  parseText: (text: string) => Promise<void>;
  clear: () => void;
}

export function useRouteImport(
  log: (tag: string, msg: string) => void
): RouteImportHookResult {
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickFile = useCallback(async () => {
    try {
      setPhase('picking_file');
      setError(null);
      setResult(null);

      const file = await pickRouteFile(log);
      if (!file) {
        setPhase('idle');
        return;
      }

      setPhase('extracting');
      const importResult = await runImportPipeline(
        { mode: 'file', ...file },
        log,
        (p) => setPhase(p),
      );
      setResult(importResult);
      setPhase('parsed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log('IMPORT', `IMPORT_FAILED — ${msg}`);
      setError(msg);
      setPhase('error');
    }
  }, [log]);

  const parseText = useCallback(
    async (text: string) => {
      try {
        setPhase('parsing');
        setError(null);
        setResult(null);
        const importResult = await runImportPipeline({ mode: 'paste', text }, log);
        setResult(importResult);
        setPhase('parsed');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log('IMPORT', `IMPORT_FAILED — ${msg}`);
        setError(msg);
        setPhase('error');
      }
    },
    [log]
  );

  const clear = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setError(null);
  }, []);

  return { phase, result, error, pickFile, parseText, clear };
}
