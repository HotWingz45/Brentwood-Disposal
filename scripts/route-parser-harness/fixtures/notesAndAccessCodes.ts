import type { Fixture } from '../types';

export const notesAndAccessCodes: Fixture = {
  name: 'notesAndAccessCodes',
  description: 'CSV with named columns populating customer_name / notes / access_code',
  kind: 'csv',
  // Header "access code" (with space) matches ACCESS_CODE_HEADERS;
  // "access_code" with underscore is not recognized — this fixture documents
  // the parser's actual header vocabulary.
  input: [
    'name,address,access code,notes',
    'Smith,123 Maple St,#1234,Backdoor pickup',
    'Johnson,456 Oak Ave,5678,Gate code on left',
  ].join('\n'),
  expect: {
    minValid: 2,
    maxValid: 2,
    maxNeedsReview: 0,
    maxInvalid: 0,
    addressContains: ['Maple St', 'Oak Ave'],
    fieldsContain: {
      customer_name: ['Smith', 'Johnson'],
      access_code: ['#1234', '5678'],
      notes: ['Backdoor pickup', 'Gate code'],
    },
  },
};
