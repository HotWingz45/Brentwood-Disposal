import { useEffect, useRef } from 'react';

/**
 * Calls onCheck on a fixed interval for the lifetime of the component.
 * The caller is responsible for constructing the snapshot — this hook
 * has zero knowledge of app state.
 * - Zero SDK, zero UI, zero persistence.
 */
export function useHealthCheck(intervalMs: number, onCheck: () => void): void {
  const onCheckRef = useRef(onCheck);
  onCheckRef.current = onCheck;

  useEffect(() => {
    const timer = setInterval(() => onCheckRef.current(), intervalMs);
    return () => clearInterval(timer);
    // intervalMs treated as fixed at mount — change requires remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
