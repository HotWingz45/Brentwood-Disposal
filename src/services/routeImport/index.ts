import * as DocumentPicker from 'expo-document-picker';
import type { ImportedStop, ImportResult, FileType, InvalidRow } from './types';
import { detectFileType } from './detectFileType';
import { extractTextFromFile } from './extractTextFromFile';
import { parseRouteText } from './parseRouteText';
import { parseTabularStops } from './parseTabularStops';
import { normalizeStops } from './normalizeStops';
import { validateStops } from './validateStops';

export type { ImportResult, ImportedStop, InvalidRow, ImportPhase, FileType, GeocodeStatus } from './types';

const TABULAR_TYPES: FileType[] = ['csv', 'xlsx'];

export async function runImportPipeline(
  input:
    | { mode: 'file'; uri: string; fileName?: string; mimeType?: string | null }
    | { mode: 'paste'; text: string },
  log: (tag: string, msg: string) => void
): Promise<ImportResult> {
  let fileType: FileType;
  let rawText: string;
  let sourceFileName: string | undefined;

  log('IMPORT', 'IMPORT_STARTED');

  if (input.mode === 'paste') {
    fileType = 'paste';
    rawText = input.text;
    log('IMPORT', 'TEXT_EXTRACTED — paste mode');
  } else {
    fileType = detectFileType(input.uri, input.mimeType);
    sourceFileName = input.fileName;
    log('IMPORT', `FILE_TYPE_DETECTED — ${fileType}`);
    log('IMPORT', 'Extracting text from file...');
    rawText = await extractTextFromFile(input.uri, fileType);
    log('IMPORT', `TEXT_EXTRACTED — ${rawText.length} chars`);
  }

  log('IMPORT', 'Parsing stops...');
  let candidates: ImportedStop[];
  let preInvalid: InvalidRow[];

  if (TABULAR_TYPES.includes(fileType)) {
    const r = parseTabularStops(rawText);
    candidates = r.candidates;
    preInvalid = r.invalid;
  } else {
    const r = parseRouteText(rawText);
    candidates = r.candidates;
    preInvalid = r.invalid;
  }

  log('IMPORT', `IMPORT_PARSED — ${candidates.length} candidates, ${preInvalid.length} pre-rejected`);

  const normalized = normalizeStops(candidates);
  const { valid, invalid } = validateStops(normalized, preInvalid);

  if (invalid.length > 0) {
    log('IMPORT', `IMPORT_VALIDATION_WARNING — ${invalid.length} invalid rows`);
  }

  log('IMPORT', `IMPORT_PARSED — ${valid.length} valid stops ready`);

  return { valid, invalid, fileType, sourceFileName };
}

export async function pickRouteFile(
  log: (tag: string, msg: string) => void
): Promise<{ uri: string; fileName?: string; mimeType?: string | null } | null> {
  log('IMPORT', 'FILE_SELECTED — opening picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: ['*/*'],
    copyToCacheDirectory: true,
  });

  if (result.canceled) {
    log('IMPORT', 'FILE_SELECTED — cancelled');
    return null;
  }

  const asset = result.assets[0];
  if (!asset) return null;

  log('IMPORT', `FILE_SELECTED — ${asset.name ?? 'unknown'} (${asset.mimeType ?? 'unknown type'})`);
  return { uri: asset.uri, fileName: asset.name ?? undefined, mimeType: asset.mimeType };
}
