// ── Wire shapes — must stay in sync with mobile documentExtraction.ts ──

export interface ExtractionRequest {
  fileName: string;
  mimeType: string;
  base64Content: string;
  requestedOutput: 'plain_text';
  appVersion: string;
  buildNumber?: string;
}

export interface ExtractionResponse {
  success: boolean;
  extractedText: string;
  pagesProcessed: number;
  confidence: number;         // 0–1
  warnings: string[];
  detectedFormat: string;
  extractionMethod: ExtractionMethod;
  scannedDocumentDetected: boolean;
}

export interface ExtractionErrorResponse {
  success: false;
  error: string;
  code: string;
}

// ── Internal types ────────────────────────────────────────────────

export type ExtractionMethod =
  | 'pdf-selectable-text'
  | 'pdf-ocr'
  | 'docx-mammoth'
  | 'unknown';

export interface RawExtractionResult {
  text: string;
  pagesProcessed: number;
  confidence: number;
  warnings: string[];
  detectedFormat: string;
  extractionMethod: ExtractionMethod;
  scannedDocumentDetected: boolean;
}
