import type { Stop } from './Stop';

export enum RouteSessionStatus {
  IDLE = 'idle',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export interface RouteSession {
  id: string;
  sessionStatus: RouteSessionStatus;
  stops: Stop[];
  currentStopIndex: number;
  createdAt: number;   // unix ms
  updatedAt: number;   // unix ms
  completedAt?: number;
}
