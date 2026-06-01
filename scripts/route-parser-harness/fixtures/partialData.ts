import type { Fixture } from '../types';

// "Main Street" and "Riverside Path" pass structural checks (8+ chars, 2+ words)
// but lack a leading house number → confidence stays at 0.5 → needs_review.
// "123" is rejected at the length check → invalid.
// "456 Oak Lane" matches the US-street pattern → confidence ≥ 0.7 → valid.
export const partialData: Fixture = {
  name: 'partialData',
  description: 'Mix of no-number, too-short, and fully-shaped addresses',
  kind: 'text',
  input: [
    'Main Street',
    '123',
    'Riverside Path',
    '456 Oak Lane',
  ].join('\n'),
  expect: {
    minValid: 1,
    maxValid: 1,
    minNeedsReview: 2,
    maxNeedsReview: 2,
    minInvalid: 1,
    maxInvalid: 1,
    addressContains: ['Main Street', 'Riverside Path', 'Oak Lane'],
  },
};
