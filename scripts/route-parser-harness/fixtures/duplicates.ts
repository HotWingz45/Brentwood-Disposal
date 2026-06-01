import type { Fixture } from '../types';

// Two literally-identical address lines plus one unique line.
// normalizeAddressForCompare collapses both into the same key.
export const duplicates: Fixture = {
  name: 'duplicates',
  description: 'Two identical addresses flag both as needs_review duplicates',
  kind: 'text',
  input: [
    '100 Oak Street',
    '100 Oak Street',
    '200 Maple Avenue',
  ].join('\n'),
  expect: {
    minValid: 1,
    maxValid: 1,
    minNeedsReview: 2,
    maxNeedsReview: 2,
    maxInvalid: 0,
    addressContains: ['Oak Street', 'Maple Avenue'],
  },
};
