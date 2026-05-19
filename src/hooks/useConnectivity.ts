import { useState, useEffect, useRef } from 'react';
import * as Network from 'expo-network';

export type ConnectivityState = 'online' | 'offline' | 'reconnecting';

const POLL_MS = 6_000;

/**
 * Polls expo-network every 6 s for connectivity changes.
 * Logs OFFLINE_MODE / ONLINE_RESTORED when state transitions.
 */
export function useConnectivity(
  log?: (tag: string, msg: string) => void
): { connectivity: ConnectivityState; isOnline: boolean } {
  const [connectivity, setConnectivity] = useState<ConnectivityState>('online');
  const prevOnlineRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef(log);
  logRef.current = log;

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const state = await Network.getNetworkStateAsync();
        // isConnected can be null on some platforms — default to true
        const isConnected = state.isConnected !== false;
        if (!mounted) return;

        const wasOnline = prevOnlineRef.current;
        prevOnlineRef.current = isConnected;

        if (!isConnected && wasOnline) {
          logRef.current?.('CONNECTIVITY', 'OFFLINE_MODE — network unavailable');
          setConnectivity('offline');
        } else if (isConnected && !wasOnline) {
          logRef.current?.('CONNECTIVITY', 'ONLINE_RESTORED — network available');
          setConnectivity('reconnecting');
          reconnectTimerRef.current = setTimeout(() => {
            if (mounted) setConnectivity('online');
          }, 2_000);
        }
      } catch {
        // network check is best-effort
      }
    }

    void check();
    const timer = setInterval(() => void check(), POLL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  return { connectivity, isOnline: connectivity !== 'offline' };
}
