export enum StopStatus {
  PENDING = 'pending',
  NAVIGATING = 'navigating',
  ARRIVED = 'arrived',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
}

export type GeocodeStatus = 'resolved' | 'pending' | 'failed';

export interface Stop {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  status: StopStatus;
  sequenceNumber: number;
  navigatingAt?: number;   // unix ms
  arrivedAt?: number;      // unix ms
  completedAt?: number;    // unix ms
  geocodeStatus?: GeocodeStatus;
  rawLine?: string;
}
