import { StopStatus, type Stop } from '../models/Stop';

/**
 * Hardcoded 5-stop residential Brentwood, TN test route.
 * Replace with PDF-ingested stop arrays once the ingestion layer is built.
 */
export const BRENTWOOD_ROUTE: Stop[] = [
  {
    id: 'stop-bw-1',
    address: '135 Caldwell Dr, Brentwood, TN 37027',
    latitude: 36.0402,
    longitude: -86.7801,
    status: StopStatus.PENDING,
    sequenceNumber: 1,
  },
  {
    id: 'stop-bw-2',
    address: '7823 Sunnybank Dr, Brentwood, TN 37027',
    latitude: 36.0278,
    longitude: -86.7895,
    status: StopStatus.PENDING,
    sequenceNumber: 2,
  },
  {
    id: 'stop-bw-3',
    address: '2204 Longhunters Chase, Brentwood, TN 37027',
    latitude: 36.0356,
    longitude: -86.7967,
    status: StopStatus.PENDING,
    sequenceNumber: 3,
  },
  {
    id: 'stop-bw-4',
    address: '1609 Woodmont Blvd, Brentwood, TN 37027',
    latitude: 36.0321,
    longitude: -86.7723,
    status: StopStatus.PENDING,
    sequenceNumber: 4,
  },
  {
    id: 'stop-bw-5',
    address: '445 Heritage Way, Brentwood, TN 37027',
    latitude: 36.0448,
    longitude: -86.7842,
    status: StopStatus.PENDING,
    sequenceNumber: 5,
  },
];
