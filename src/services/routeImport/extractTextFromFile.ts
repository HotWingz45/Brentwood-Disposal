import * as FileSystem from 'expo-file-system';
import type { FileType } from './types';

export async function extractTextFromFile(uri: string, fileType: FileType): Promise<string> {
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
      const firstName = workbook.SheetNames[0];
      if (!firstName) return '';
      const sheet = workbook.Sheets[firstName];
      if (!sheet) return '';
      return XLSX.utils.sheet_to_csv(sheet);
    }

    case 'pdf':
      throw new Error(
        'PDF extraction is not supported on-device. Export your route as CSV or paste addresses directly.'
      );

    case 'docx':
      throw new Error(
        'DOCX extraction is not yet supported on-device. Export your route as CSV or paste addresses directly.'
      );

    case 'paste':
      return uri; // caller passes raw text as the "uri" argument

    default:
      throw new Error(`Unsupported file type: ${fileType as string}`);
  }
}
