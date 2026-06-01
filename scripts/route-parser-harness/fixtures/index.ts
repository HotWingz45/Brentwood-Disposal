import type { Fixture } from '../types';
import { cleanCsv } from './cleanCsv';
import { messyPdfText } from './messyPdfText';
import { duplicates } from './duplicates';
import { notesAndAccessCodes } from './notesAndAccessCodes';
import { malformedAddresses } from './malformedAddresses';
import { garbageMixed } from './garbageMixed';
import { partialData } from './partialData';
import { lowConfidence } from './lowConfidence';

export const fixtures: Fixture[] = [
  cleanCsv,
  messyPdfText,
  duplicates,
  notesAndAccessCodes,
  malformedAddresses,
  garbageMixed,
  partialData,
  lowConfidence,
];
