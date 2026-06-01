import type { Fixture } from '../types';

export const garbageMixed: Fixture = {
  name: 'garbageMixed',
  description: 'Real addresses interleaved with headers, dates, dividers, day-of-week',
  kind: 'text',
  input: [
    'page 1',
    'Route Sheet',
    '12/15/2024',
    'Friday',
    '100 Oak Street',
    '=====',
    '200 Maple Avenue',
    '---',
    '300 Pine Road',
    'total stops: 3',
  ].join('\n'),
  expect: {
    minValid: 3,
    maxValid: 3,
    maxNeedsReview: 0,
    minInvalid: 6,
    addressContains: ['Oak Street', 'Maple Avenue', 'Pine Road'],
    noValidContains: ['page', 'Route Sheet', 'Friday', 'total stops'],
  },
};
