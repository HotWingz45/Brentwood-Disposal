import type { GeocodeStatus } from '../../models/Stop';

export type { GeocodeStatus };

export type FileType = 'csv' | 'xlsx' | 'txt' | 'pdf' | 'docx' | 'paste' | 'unknown';

export interface ImportedStop {
  address: string;
  rawLine: string;
  latitude?: number;
  longitude?: number;
  sequenceNumber?: number;
  geocodeStatus: GeocodeStatus;
  resolvedAddress?: string;   // Google's formatted_address after geocoding
  geocodeError?: string;      // failure reason when geocodeStatus='failed'
  importMetadata?: Record<string, string>;
}

export interface InvalidRow {
  rawLine: string;
  lineNumber: number;
  reason: string;
}

export interface ImportResult {
  valid: ImportedStop[];
  invalid: InvalidRow[];
  fileType: FileType;
  sourceFileName?: string;
}

export type ImportPhase =
  | 'idle'
  | 'picking_file'
  | 'extracting'
  | 'parsing'
  | 'validating'
  | 'parsed'
  | 'loaded'
  | 'error';
