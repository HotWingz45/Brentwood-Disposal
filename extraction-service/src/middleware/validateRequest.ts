import type { Request, Response, NextFunction } from 'express';
import type { ExtractionRequest } from '../types';
import { logger } from '../logger';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream', // fallback when OS doesn't identify type
]);

const MAX_PAYLOAD_BYTES = parseInt(process.env['MAX_PAYLOAD_BYTES'] ?? '26214400', 10);

// Validate base64 string length against max allowed actual file size.
// base64 inflates by ~33%, so actual bytes ≈ base64.length * 0.75
function base64ActualBytes(b64: string): number {
  return Math.floor(b64.length * 0.75);
}

export function validateRequest(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Partial<ExtractionRequest>;

  if (!body.fileName || typeof body.fileName !== 'string') {
    res.status(400).json({ success: false, error: 'fileName is required', code: 'MISSING_FIELD' });
    return;
  }

  if (!body.mimeType || typeof body.mimeType !== 'string') {
    res.status(400).json({ success: false, error: 'mimeType is required', code: 'MISSING_FIELD' });
    return;
  }

  if (!body.base64Content || typeof body.base64Content !== 'string') {
    res.status(400).json({ success: false, error: 'base64Content is required', code: 'MISSING_FIELD' });
    return;
  }

  if (body.requestedOutput && body.requestedOutput !== 'plain_text') {
    res.status(400).json({ success: false, error: 'requestedOutput must be plain_text', code: 'INVALID_FIELD' });
    return;
  }

  const actualBytes = base64ActualBytes(body.base64Content);
  if (actualBytes > MAX_PAYLOAD_BYTES) {
    res.status(413).json({
      success: false,
      error: `File too large. Maximum allowed: ${Math.round(MAX_PAYLOAD_BYTES / 1024 / 1024)} MB`,
      code: 'FILE_TOO_LARGE',
    });
    return;
  }

  const mimeNorm = body.mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  const isPdf  = mimeNorm === 'application/pdf' || body.fileName.toLowerCase().endsWith('.pdf');
  const isDocx = mimeNorm.includes('wordprocessingml') || body.fileName.toLowerCase().endsWith('.docx');
  const isMsWord = mimeNorm === 'application/msword' || body.fileName.toLowerCase().endsWith('.doc');
  const isOctetStream = mimeNorm === 'application/octet-stream';

  if (!isPdf && !isDocx && !isMsWord && !isOctetStream && !ALLOWED_MIME_TYPES.has(mimeNorm)) {
    logger.warn('VALIDATION', 'Unsupported file type', { mimeType: body.mimeType, fileName: body.fileName });
    res.status(415).json({
      success: false,
      error: `Unsupported file type: ${body.mimeType}. Supported: PDF, DOCX.`,
      code: 'UNSUPPORTED_FILE_TYPE',
    });
    return;
  }

  next();
}
