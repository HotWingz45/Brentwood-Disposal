import * as FileSystem from 'expo-file-system';
import type { FileType } from './types';
import {
  extractRouteTextFromDocument,
  isDocumentExtractionConfigured,
  type ExtractionMeta,
} from './documentExtraction';

export type { ExtractionMeta };

// ── XLSX: pick the sheet with the most data rows ──────────────────

function bestXlsxSheet(workbook: import('xlsx').WorkBook): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx');
  const names = workbook.SheetNames;
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;

  let bestName = names[0]!;
  let bestRows = -1;

  for (const name of names) {
    const sh = workbook.Sheets[name];
    if (!sh) continue;
    const ref = sh['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const isRouteName = /route|address|stop|delivery|pickup|order/i.test(name);
    const rows = range.e.r - range.s.r + 1 + (isRouteName ? 10_000 : 0);
    if (rows > bestRows) {
      bestRows = rows;
      bestName = name;
    }
  }

  return bestName;
}

// ── DOCX: unzip and strip XML (local fallback) ────────────────────

async function extractDocxTextLocal(uri: string): Promise<string> {
  const { unzipSync } = require('fflate') as typeof import('fflate');

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new Error('DOCX file appears corrupted or is not a valid Word document.');
  }

  const xmlBytes = unzipped['word/document.xml'];
  if (!xmlBytes) {
    throw new Error('DOCX: word/document.xml not found — file may be encrypted or malformed.');
  }

  const xml = new TextDecoder('utf-8').decode(xmlBytes);

  const text = xml
    .replace(/<w:br[^/]*/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCharCode(parseInt(dec, 10))
    );

  if (!text.trim()) {
    throw new Error(
      'No readable text found in this Word document. ' +
        'It may contain only images or be protected.'
    );
  }

  return text;
}

// ── Options ───────────────────────────────────────────────────────

export interface ExtractOptions {
  fileName?: string;
  mimeType?: string | null;
  onProgress?: (stage: 'uploading' | 'extracting') => void;
  meta?: ExtractionMeta;
}

// ── Main extractor ────────────────────────────────────────────────

export async function extractTextFromFile(
  uri: string,
  fileType: FileType,
  opts?: ExtractOptions,
): Promise<string> {
  switch (fileType) {
    case 'txt':
    case 'csv':
    case 'unknown':
      return FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

    case 'xlsx': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx') as typeof import('xlsx');
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const workbook = XLSX.read(base64, { type: 'base64' });
      const sheetName = bestXlsxSheet(workbook);
      if (!sheetName) return '';
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return '';
      return XLSX.utils.sheet_to_csv(sheet);
    }

    case 'docx': {
      // Use extraction service if configured (better quality for complex DOCX)
      if (isDocumentExtractionConfigured()) {
        const result = await extractRouteTextFromDocument(
          { uri, fileName: opts?.fileName, mimeType: opts?.mimeType },
          opts?.onProgress,
        );
        if (result.success) {
          if (opts?.meta) {
            opts.meta.warnings = result.warnings;
            opts.meta.pagesProcessed = result.pagesProcessed;
            opts.meta.confidence = result.confidence;
            opts.meta.detectedFormat = result.detectedFormat;
            opts.meta.extractionMethod = result.extractionMethod;
          }
          return result.extractedText;
        }
        // Service failed (not NOT_CONFIGURED) — fall through to local extraction
        if (result.errorCode !== 'NOT_CONFIGURED') {
          throw new Error(result.userMessage);
        }
      }
      // Local fflate extraction — always available, no backend required
      const localText = await extractDocxTextLocal(uri);
      if (opts?.meta) {
        opts.meta.extractionMethod = 'local';
        opts.meta.warnings = [];
      }
      return localText;
    }

    case 'pdf': {
      const result = await extractRouteTextFromDocument(
        { uri, fileName: opts?.fileName, mimeType: opts?.mimeType },
        opts?.onProgress,
      );
      if (result.success) {
        if (opts?.meta) {
          opts.meta.warnings = result.warnings;
          opts.meta.pagesProcessed = result.pagesProcessed;
          opts.meta.confidence = result.confidence;
          opts.meta.detectedFormat = result.detectedFormat;
          opts.meta.extractionMethod = result.extractionMethod;
        }
        return result.extractedText;
      }
      if (result.errorCode === 'NOT_CONFIGURED') {
        // Sentinel prefix lets RouteImportSheet show the setup-required view
        throw new Error('EXTRACTION_NOT_CONFIGURED\n' + result.userMessage);
      }
      throw new Error(result.userMessage);
    }

    case 'paste':
      return uri;

    default:
      throw new Error(`Unsupported file type: ${fileType as string}`);
  }
}
