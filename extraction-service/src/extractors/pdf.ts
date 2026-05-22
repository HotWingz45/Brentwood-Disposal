import { logger } from '../logger';
import { runOcrOnPdf, isOcrAvailable } from './ocr';
import type { RawExtractionResult } from '../types';

const OCR_THRESHOLD = parseInt(process.env['OCR_THRESHOLD_CHARS_PER_PAGE'] ?? '80', 10);

// pdf-parse type shim (package ships without bundled types)
type PdfParseResult = {
  numpages: number;
  numrender: number;
  text: string;
  info: Record<string, unknown>;
};
type PdfParseOptions = {
  max?: number;
  pagerender?: (pageData: unknown) => string;
};

function getPdfParse(): (buf: Buffer, opts?: PdfParseOptions) => Promise<PdfParseResult> {
  // Use lib path to avoid the pdf-parse test-fixture auto-run issue in some environments
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('pdf-parse/lib/pdf-parse') as (buf: Buffer, opts?: PdfParseOptions) => Promise<PdfParseResult>;
}

// ── Text density analysis ─────────────────────────────────────────

function isLowTextPdf(text: string, numPages: number): boolean {
  if (numPages === 0) return true;
  const cleanChars = text.replace(/\s/g, '').length;
  const charsPerPage = cleanChars / numPages;
  return charsPerPage < OCR_THRESHOLD;
}

function estimateSelectableConfidence(text: string, numPages: number): number {
  if (numPages === 0) return 0;
  const charsPerPage = text.replace(/\s/g, '').length / numPages;
  // Scale: 0 at threshold, 1.0 at 10× threshold
  const ratio = charsPerPage / OCR_THRESHOLD;
  return Math.min(1, ratio / 10);
}

// ── Main PDF extractor ────────────────────────────────────────────

export async function extractPdf(pdfBuffer: Buffer): Promise<RawExtractionResult> {
  const warnings: string[] = [];
  let parsed: PdfParseResult;

  logger.info('EXTRACTION_REQUEST', `Starting PDF extraction — ${pdfBuffer.length} bytes`);

  try {
    const pdfParse = getPdfParse();
    parsed = await pdfParse(pdfBuffer, {
      // Limit to first 50 pages — route sheets are never that long
      max: 50,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('EXTRACTION_FAILED', `pdf-parse threw: ${msg}`);

    if (msg.toLowerCase().includes('encrypt') || msg.toLowerCase().includes('password')) {
      throw new Error('This PDF is password-protected. Please remove the password and try again.');
    }
    throw new Error(`PDF extraction failed: ${msg}`);
  }

  const { text, numpages } = parsed;
  const numPages = Math.max(numpages, 1);

  logger.info('PDF_PARSE_SUCCESS', `${numpages} pages, ${text.length} chars extracted`);

  // ── Selectable text path ──────────────────────────────────────
  if (!isLowTextPdf(text, numPages)) {
    const confidence = estimateSelectableConfidence(text, numPages);
    return {
      text,
      pagesProcessed: numPages,
      confidence,
      warnings,
      detectedFormat: 'pdf',
      extractionMethod: 'pdf-selectable-text',
      scannedDocumentDetected: false,
    };
  }

  // ── Scanned PDF detected ──────────────────────────────────────
  logger.info('OCR_TRIGGERED', `Low text density (${(text.replace(/\s/g, '').length / numPages).toFixed(0)} chars/page) — scanned PDF detected`);

  if (!isOcrAvailable()) {
    warnings.push(
      'Scanned PDF detected: very little selectable text found. ' +
      'OCR is not enabled on this server. ' +
      'Re-export as CSV or XLSX for accurate results.'
    );
    return {
      text,
      pagesProcessed: numPages,
      confidence: 0.1,
      warnings,
      detectedFormat: 'pdf',
      extractionMethod: 'pdf-selectable-text',
      scannedDocumentDetected: true,
    };
  }

  // ── OCR path ──────────────────────────────────────────────────
  logger.info('OCR_TRIGGERED', `Running OCR on ${numPages} page(s)`);

  try {
    const { text: ocrText, confidence, warnings: ocrWarnings } = await runOcrOnPdf(pdfBuffer, numPages);

    logger.info('OCR_COMPLETE', `OCR finished — ${ocrText.length} chars, confidence ${(confidence * 100).toFixed(1)}%`);

    return {
      text: ocrText,
      pagesProcessed: numPages,
      confidence,
      warnings: [...warnings, ...ocrWarnings],
      detectedFormat: 'pdf',
      extractionMethod: 'pdf-ocr',
      scannedDocumentDetected: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('EXTRACTION_FAILED', `OCR pipeline failed: ${msg}`);
    warnings.push(`OCR failed: ${msg}. Using partial selectable text.`);

    return {
      text,
      pagesProcessed: numPages,
      confidence: 0.1,
      warnings,
      detectedFormat: 'pdf',
      extractionMethod: 'pdf-ocr',
      scannedDocumentDetected: true,
    };
  }
}
