import type { Fixture } from '../types';

// Synthesized from the actual Brentwood Friday Groups PDF text-extract shape.
// Exercises: skip-line header, wrapped street name, inline access code,
// after_pickup → collecting transition for next stop.
export const messyPdfText: Fixture = {
  name: 'messyPdfText',
  description: 'Brentwood-format PDF text — 3 stops with names, pickups, access codes',
  kind: 'pdf',
  input: [
    'Friday',
    'Last Name Address Pick-Up Recycling Access Code',
    'Smith 100 Oak',
    'Street',
    'Street No',
    'Johnson 200 Maple Avenue',
    'Backdoor No #1234',
    'Williams 300 Pine Road',
    'Street No',
  ].join('\n'),
  expect: {
    minValid: 3,
    maxValid: 3,
    maxNeedsReview: 0,
    maxInvalid: 0,
    addressContains: ['100 Oak', '200 Maple', '300 Pine'],
    fieldsContain: {
      customer_name: ['Smith', 'Johnson', 'Williams'],
      access_code: ['#1234'],
      pickup_type: ['Street', 'Backdoor'],
    },
  },
};
