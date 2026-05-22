import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { extractPdf }  from '../extractors/pdf';
import { extractDocx } from '../extractors/docx';
import { normalizeExtractedText }    from '../cleanup/normalize';
import { cleanupExtractedRouteText } from '../cleanup/aiCleanup';
import { logger } from '../logger';
import type { ExtractionRequest, ExtractionResponse } from '../types';

const router = Router();

const EXTRACTION_TIMEOUT_MS = parseInt(process.env['EXTRACTION_TIMEOUT_MS'] ?? '60000', 10);

function detectFileKind(fileName: string, mimeType: string): 'pdf' | 'docx' | 'unknown' {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
  if (name.endsWith('.docx') || mime.includes('wordprocessingml')) return 'docx';
  if (name.endsWith('.doc')  || mime.includes('msword')) return 'docx';
  return 'unknown';
}

router.post('/', validateRequest, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ExtractionRequest;

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  logger.info('EXTRACTION_REQUEST', 'Received extraction request', {
    requestId,
    fileName:   body.fileName,
    mimeType:   body.mimeType,
    appVersion: body.appVersion,
    payloadKB:  Math.round(body.base64Content.length * 0.75 / 1024),
  });

  const kind = detectFileKind(body.fileName, body.mimeType);
  if (kind === 'unknown') {
    res.status(415).json({
      success: false,
      error: `Cannot determine file format from fileName "${body.fileName}" and mimeType "${body.mimeType}". Use PDF or DOCX.`,
      code: 'UNKNOWN_FORMAT',
    });
    return;
  }

  // Decode base64 → Buffer
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(body.base64Content, 'base64');
  } catch {
    res.status(400).json({ success: false, error: 'base64Content could not be decoded', code: 'INVALID_BASE64' });
    return;
  }

  // Run extraction with timeout
  let raw;
  try {
    const extractionPromise = kind === 'pdf' ? extractPdf(fileBuffer) : extractDocx(fileBuffer);
    raw = await Promise.race([
      extractionPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Extraction timed out')), EXTRACTION_TIMEOUT_MS)
      ),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('EXTRACTION_FAILED', msg, { requestId, kind });
    res.status(422).json({ success: false, error: msg, code: 'EXTRACTION_FAILED' });
    return;
  }

  // Normalize
  const normalized = normalizeExtractedText(raw.text);

  // Optional AI cleanup
  const { text: finalText, aiCleanupApplied } = await cleanupExtractedRouteText(normalized);
  if (aiCleanupApplied) {
    logger.info('EXTRACTION_REQUEST', 'AI cleanup applied', { requestId });
  }

  if (!finalText.trim()) {
    res.status(422).json({
      success: false,
      error: 'No readable text could be extracted from this document.',
      code: 'EMPTY_RESULT',
    });
    return;
  }

  const response: ExtractionResponse = {
    success:                true,
    extractedText:          finalText,
    pagesProcessed:         raw.pagesProcessed,
    confidence:             parseFloat(raw.confidence.toFixed(3)),
    warnings:               raw.warnings,
    detectedFormat:         raw.detectedFormat,
    extractionMethod:       raw.extractionMethod,
    scannedDocumentDetected: raw.scannedDocumentDetected,
  };

  logger.info('EXTRACTION_REQUEST', 'Extraction complete', {
    requestId,
    chars:    finalText.length,
    method:   raw.extractionMethod,
    pages:    raw.pagesProcessed,
    warnings: raw.warnings.length,
  });

  res.json(response);
});

export default router;
