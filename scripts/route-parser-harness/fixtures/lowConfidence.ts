import type { Fixture } from '../types';

// None of these match \b\d+\s+\w+ — there is no "<number> <word>" street pattern.
// Each line passes structural checks (length, word count) but earns no
// US-street bonus, leaving confidence at 0.5 → all three → needs_review.
export const lowConfidence: Fixture = {
  name: 'lowConfidence',
  description: 'Structurally valid but low confidence — all should land in needs_review',
  kind: 'text',
  input: [
    'Pickup at parking lot 32',
    'Service location 7',
    'Delivery point alpha',
  ].join('\n'),
  expect: {
    maxValid: 0,
    minNeedsReview: 3,
    maxNeedsReview: 3,
    maxInvalid: 0,
  },
};
