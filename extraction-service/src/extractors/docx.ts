import { logger } from '../logger';
import type { RawExtractionResult } from '../types';

// mammoth ships TypeScript declarations in the package itself
import mammoth from 'mammoth';

export async function extractDocx(docxBuffer: Buffer): Promise<RawExtractionResult> {
  logger.info('EXTRACTION_REQUEST', `Starting DOCX extraction — ${docxBuffer.length} bytes`);

  const warnings: string[] = [];

  let value: string;
  let messages: Array<{ type: string; message: string }>;

  try {
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    value    = result.value;
    messages = result.messages;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('EXTRACTION_FAILED', `mammoth threw: ${msg}`);

    if (msg.toLowerCase().includes('corrupt') || msg.toLowerCase().includes('zip')) {
      throw new Error('Word document appears corrupted or is not a valid .docx file.');
    }
    throw new Error(`DOCX extraction failed: ${msg}`);
  }

  // Promote mammoth warnings to extraction warnings
  for (const m of messages) {
    if (m.type === 'warning') {
      warnings.push(m.message);
    }
  }

  if (!value.trim()) {
    throw new Error(
      'No readable text found in this Word document. ' +
      'It may contain only images, tables with no text, or be protected.'
    );
  }

  logger.info('DOCX_PARSE_SUCCESS', `${value.length} chars extracted, ${messages.length} mammoth message(s)`);

  const confidence = value.trim().length > 50 ? 0.95 : 0.5;

  return {
    text: value,
    pagesProcessed: 1, // mammoth does not expose page count
    confidence,
    warnings,
    detectedFormat: 'docx',
    extractionMethod: 'docx-mammoth',
    scannedDocumentDetected: false,
  };
}
