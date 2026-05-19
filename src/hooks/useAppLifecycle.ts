import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

interface AppLifecycleCallbacks {
  onForeground?: () => void | Promise<void>;
  onBackground?: () => void | Promise<void>;
  onInactive?: () => void | Promise<void>;
}

/**
 * Isolated AppState listener.
 * Callbacks are read via a ref so they never cause re-subscription.
 */
export function useAppLifecycle(callbacks: AppLifecycleCallbacks): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void callbacksRef.current.onForeground?.();
      else if (next === 'background') void callbacksRef.current.onBackground?.();
      else if (next === 'inactive') void callbacksRef.current.onInactive?.();
    });
    return () => sub.remove();
  }, []);
}
