import type { Fixture } from '../types';

export const cleanCsv: Fixture = {
  name: 'cleanCsv',
  description: '5 clean residential addresses, header row, CSV format',
  kind: 'csv',
  input: [
    'name,address,stop',
    'Smith,123 Maple St,1',
    'Johnson,456 Oak Ave,2',
    'Williams,789 Pine Rd,3',
    'Brown,1010 Cedar Ln,4',
    'Davis,2020 Birch Dr,5',
  ].join('\n'),
  expect: {
    minValid: 5,
    maxValid: 5,
    maxNeedsReview: 0,
    maxInvalid: 0,
    addressContains: ['Maple St', 'Oak Ave', 'Pine Rd', 'Cedar Ln', 'Birch Dr'],
    fieldsContain: {
      customer_name: ['Smith', 'Johnson', 'Williams', 'Brown', 'Davis'],
    },
  },
};
