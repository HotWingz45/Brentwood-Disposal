import { logger } from '../logger';

const OCR_TIMEOUT_MS = parseInt(process.env['OCR_TIMEOUT_MS'] ?? '30000', 10);
const ENABLE_OCR     = process.env['ENABLE_OCR'] === 'true';

// ── Minimal interfaces for optional deps ──────────────────────────
// canvas and tesseract.js are optional — loaded at runtime only when available.
// We define narrow interfaces for what we actually call, avoiding
// compile-time dependency on packages that may not be installed.

interface CanvasLike {
  width:  number;
  height: number;
  getContext(type: '2d'): unknown;
  toBuffer(format: 'image/png'): Buffer;
}
interface CanvasModule {
  createCanvas(w: number, h: number): CanvasLike;
}

interface TesseractWorker {
  recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<void>;
}
interface TesseractModule {
  createWorker(lang: string): Promise<TesseractWorker>;
}

// ── Lazy-load optional deps ───────────────────────────────────────

let _canvas:    CanvasModule    | null | undefined = undefined;
let _tesseract: TesseractModule | null | undefined = undefined;

function getCanvas(): CanvasModule | null {
  if (_canvas !== undefined) return _canvas;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _canvas = require('canvas') as CanvasModule;
  } catch {
    _canvas = null;
  }
  return _canvas;
}

function getTesseract(): TesseractModule | null {
  if (_tesseract !== undefined) return _tesseract;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _tesseract = require('tesseract.js') as TesseractModule;
  } catch {
    _tesseract = null;
  }
  return _tesseract;
}

export function isOcrAvailable(): boolean {
  if (!ENABLE_OCR) return false;
  return getCanvas() !== null && getTesseract() !== null;
}

// ── PDF → image rendering via pdfjs-dist ─────────────────────────

async function renderPageToBuffer(pdfData: Uint8Array, pageNum: number): Promise<Buffer> {
  const canvas = getCanvas();
  if (!canvas) throw new Error('canvas package not available');

  let pdfjsLib: { getDocument: (opts: { data: Uint8Array }) => { promise: Promise<{ getPage: (n: number) => Promise<{
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (ctx: unknown) => { promise: Promise<void> };
  }> }> } };
  try {
    // pdfjs-dist legacy build — compatible with CommonJS / Node 18
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
  } catch {
    throw new Error('pdfjs-dist not available — install OCR dependencies to enable scanned PDF support');
  }

  const pdf      = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const page     = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 }); // 2× for better OCR quality

  const nodeCanvas = canvas.createCanvas(viewport.width, viewport.height);
  const ctx        = nodeCanvas.getContext('2d');

  await page.render({
    canvasContext: ctx,
    viewport,
  } as { canvasContext: unknown; viewport: typeof viewport }).promise;

  return nodeCanvas.toBuffer('image/png');
}

// ── Per-page OCR ──────────────────────────────────────────────────

async function ocrPage(imageBuffer: Buffer): Promise<{ text: string; confidence: number }> {
  const Tesseract = getTesseract();
  if (!Tesseract) throw new Error('tesseract.js not available');

  const worker = await Tesseract.createWorker('eng');
  try {
    const result = await Promise.race([
      worker.recognize(imageBuffer),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS)
      ),
    ]);
    return {
      text: result.data.text,
      confidence: result.data.confidence / 100,
    };
  } finally {
    await worker.terminate();
  }
}

// ── Public: run OCR over all pages ───────────────────────────────

export async function runOcrOnPdf(
  pdfBuffer: Buffer,
  numPages: number,
): Promise<{ text: string; confidence: number; warnings: string[] }> {
  const warnings: string[] = [];
  const pageTexts: string[] = [];
  let totalConfidence = 0;
  let pagesOcrd = 0;

  for (let p = 1; p <= numPages; p++) {
    try {
      const imageBuffer = await renderPageToBuffer(new Uint8Array(pdfBuffer), p);
      const { text, confidence } = await ocrPage(imageBuffer);
      pageTexts.push(text);
      totalConfidence += confidence;
      pagesOcrd++;
      logger.info('OCR_COMPLETE', `Page ${p}/${numPages} — confidence: ${(confidence * 100).toFixed(1)}%`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('OCR_TRIGGERED', `Page ${p} OCR failed: ${msg}`);
      warnings.push(`OCR failed on page ${p}: ${msg}`);
      pageTexts.push('');
    }
  }

  const avgConfidence = pagesOcrd > 0 ? totalConfidence / pagesOcrd : 0;
  if (avgConfidence < 0.6) {
    warnings.push(
      `Low OCR confidence (${(avgConfidence * 100).toFixed(0)}%). ` +
      'Some addresses may be incorrect — verify before dispatching.'
    );
  }

  return {
    text: pageTexts.join('\n\n'),
    confidence: avgConfidence,
    warnings,
  };
}
