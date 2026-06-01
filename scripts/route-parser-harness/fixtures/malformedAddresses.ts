import type { Fixture } from '../types';

export const malformedAddresses: Fixture = {
  name: 'malformedAddresses',
  description: 'All input lines are too short or non-address-shaped',
  kind: 'text',
  input: [
    'X',
    '1',
    'abc',
    '.',
    ',,,',
    'ok',
  ].join('\n'),
  expect: {
    maxValid: 0,
    maxNeedsReview: 0,
    minInvalid: 6,
  },
};
