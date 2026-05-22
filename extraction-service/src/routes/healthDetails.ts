import { Router } from 'express';
import type { Request, Response } from 'express';
import { isOcrAvailable } from '../extractors/ocr';
import { aiCleanupProviderName } from '../cleanup/aiCleanup';

const router = Router();
const startedAt = new Date().toISOString();

/** Extended diagnostics — not used by Railway health checks. */
router.get('/', (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    status: 'ok',
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    features: {
      pdfSelectableText: true,
      ocrEnabled: isOcrAvailable(),
      aiCleanup: aiCleanupProviderName() !== 'noop',
      aiProvider: aiCleanupProviderName(),
    },
    limits: {
      maxPayloadBytes: parseInt(process.env['MAX_PAYLOAD_BYTES'] ?? '26214400', 10),
      extractionTimeoutMs: parseInt(process.env['EXTRACTION_TIMEOUT_MS'] ?? '60000', 10),
    },
  });
});

export default router;
