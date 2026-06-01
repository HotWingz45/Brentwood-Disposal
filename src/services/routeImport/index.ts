import * as DocumentPicker from 'expo-document-picker';
import type { ImportedStop, ImportResult, FileType, InvalidRow, ImportPhase } from './types';
import { detectFileType } from './detectFileType';
import { extractTextFromFile, type ExtractionMeta } from './extractTextFromFile';
import { parseRouteText } from './parseRouteText';
import { parseBrentwoodTable } from './parseBrentwoodTable';
import { parseTabularStops } from './parseTabularStops';
import { normalizeStops } from './normalizeStops';
import { validateStops } from './validateStops';

export type { ImportResult, ImportedStop, InvalidRow, ImportPhase, FileType, GeocodeStatus } from './types';

const TABULAR_TYPES: FileType[] = ['csv', 'xlsx'];

export async function runImportPipeline(
  input:
    | { mode: 'file'; uri: string; fileName?: string; mimeType?: string | null }
    | { mode: 'paste'; text: string },
  log: (tag: string, msg: string) => void,
  onPhase?: (phase: ImportPhase) => void,
): Promise<ImportResult> {
  let fileType: FileType;
  let rawText: string;
  let sourceFileName: string | undefined;
  const extractionMeta: ExtractionMeta = { warnings: [] };

  log('IMPORT', 'IMPORT_STARTED');

  if (input.mode === 'paste') {
    fileType = 'paste';
    rawText = input.text;
    log('EXTRACTION_COMPLETE', `paste — ${rawText.length} chars`);
  } else {
    fileType = detectFileType(input.uri, input.mimeType);
    sourceFileName = input.fileName;
    log('FILE_TYPE_DETECTED', fileType);

    log('EXTRACTION_STARTED', `reading ${fileType} — ${input.fileName ?? 'unknown'}`);

    // Signal upload phase for remote-bound formats
    if (fileType === 'pdf' || fileType === 'docx') {
      onPhase?.('uploading_document');
    }

    try {
      rawText = await extractTextFromFile(input.uri, fileType, {
        fileName: input.fileName,
        mimeType: input.mimeType,
        onProgress: (stage) => {
          if (stage === 'uploading') onPhase?.('uploading_document');
          else onPhase?.('extracting_remotely');
        },
        meta: extractionMeta,
      });
    } catch (extractErr: unknown) {
      const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
      log('EXTRACTION_FAILED', msg.split('\n')[0] ?? msg);
      throw extractErr;
    }
    log('EXTRACTION_COMPLETE', `${rawText.length} chars`);
  }

  onPhase?.('parsing');

  let candidates: ImportedStop[];
  let preInvalid: InvalidRow[];

  if (TABULAR_TYPES.includes(fileType)) {
    const r = parseTabularStops(rawText);
    candidates = r.candidates;
    preInvalid = r.invalid;
  } else if (fileType === 'pdf') {
    const r = parseBrentwoodTable(rawText);
    candidates = r.candidates;
    preInvalid = r.invalid;

    // Debug summary: first 10 parsed stops
    log('PDF_PARSE_SUMMARY', `parsedStops.length = ${candidates.length}`);
    const preview = candidates.slice(0, 10).map((s, i) => {
      const meta = s.importMetadata ?? {};
      const geocodeQuery = s.address.includes('TN')
        ? s.address
        : `${s.address}, Brentwood, TN`;
      return (
        `  [${i + 1}] name="${meta['name'] ?? ''}" ` +
        `address="${s.address}" ` +
        `pickup="${meta['pickup'] ?? ''}" ` +
        `accessCode="${meta['accessCode'] ?? ''}" ` +
        `geocodeQuery="${geocodeQuery}"`
      );
    });
    log('PDF_PARSE_PREVIEW', `First ${Math.min(10, candidates.length)} stops:\n${preview.join('\n')}`);
  } else {
    const r = parseRouteText(rawText);
    candidates = r.candidates;
    preInvalid = r.invalid;
  }

  log('PARSE_COMPLETE', `${candidates.length} candidates, ${preInvalid.length} pre-rejected`);

  onPhase?.('validating');
  const normalized = normalizeStops(candidates);
  const { valid, needsReview, invalid } = validateStops(normalized, preInvalid);

  log('PARSE', `PARSE_CANDIDATES — ${candidates.length}`);
  log('PARSE', `PARSE_NEEDS_REVIEW — ${needsReview.length}`);
  log('PARSE', `PARSE_INVALID — ${invalid.length}`);

  if (invalid.length > 0) {
    log('IMPORT', `VALIDATION_WARNING — ${invalid.length} rows rejected`);
  }

  log('DOCUMENT_IMPORT_READY', `${valid.length} stops ready for geocoding`);

  return {
    valid,
    invalid,
    needsReview: needsReview.length > 0 ? needsReview : undefined,
    fileType,
    sourceFileName,
    extractionWarnings: extractionMeta.warnings.length > 0 ? extractionMeta.warnings : undefined,
  };
}

export async function pickRouteFile(
  log: (tag: string, msg: string) => void
): Promise<{ uri: string; fileName?: string; mimeType?: string | null } | null> {
  log('FILE_PICKER_OPENED', 'opening document picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: ['*/*'],
    copyToCacheDirectory: true,
  });

  if (result.canceled) {
    log('FILE_SELECTED', 'cancelled');
    return null;
  }

  const asset = result.assets[0];
  if (!asset) return null;

  log('FILE_SELECTED', `${asset.name ?? 'unknown'} (${asset.mimeType ?? 'unknown type'})`);
  return { uri: asset.uri, fileName: asset.name ?? undefined, mimeType: asset.mimeType };
}
