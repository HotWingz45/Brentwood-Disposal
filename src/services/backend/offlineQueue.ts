import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueuedEvent, QueuedEventKind } from './types';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const QUEUE_KEY = '@brentwood/offline_queue';

async function loadQueue(): Promise<QueuedEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedEvent[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueEvent(
  kind: QueuedEventKind,
  payload: Record<string, unknown>,
): Promise<void> {
  const queue = await loadQueue();
  const event: QueuedEvent = {
    id: generateId(),
    kind,
    payload,
    queuedAt: Date.now(),
    attempts: 0,
  };
  queue.push(event);
  await saveQueue(queue);
}

export async function dequeueAll(): Promise<QueuedEvent[]> {
  return loadQueue();
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.filter((e) => e.id !== id));
}

export async function incrementAttempts(id: string): Promise<void> {
  const queue = await loadQueue();
  const updated = queue.map((e) =>
    e.id === id ? { ...e, attempts: e.attempts + 1 } : e,
  );
  await saveQueue(updated);
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
