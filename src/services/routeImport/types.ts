import type { GeocodeStatus } from '../../models/Stop';

export type { GeocodeStatus };

export type FileType = 'csv' | 'xlsx' | 'txt' | 'pdf' | 'docx' | 'paste' | 'unknown';

// Stops whose computed confidence falls below this threshold are routed to
// the `needs_review` tier instead of `valid`. Tunable; matches PARSER_SCHEMA.md.
export const CONFIDENCE_REVIEW_THRESHOLD = 0.65;

export type ValidationStatus = 'valid' | 'needs_review' | 'invalid';

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

  // ── Phase 2 schema additions (all optional — existing callers unaffected) ──
  stop_id?: string;            // stable within an import batch; assigned at parse time
  confidence_score?: number;   // 0.0–1.0; computed by parser stage
  validation_status?: ValidationStatus; // assigned by validateStops; recomputable
  customer_name?: string;
  pickup_type?: string;
  notes?: string;
  access_code?: string;
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
  extractionWarnings?: string[];

  // Phase 2 addition: stops with low confidence, duplicates, or other soft failures.
  // Optional so callers that ignore this bucket behave exactly as before.
  needsReview?: ImportedStop[];
}

export type ImportPhase =
  | 'idle'
  | 'picking_file'
  | 'extracting'
  | 'uploading_document'
  | 'extracting_remotely'
  | 'parsing'
  | 'validating'
  | 'parsed'
  | 'loaded'
  | 'error';
