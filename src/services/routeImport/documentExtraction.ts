import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

// ── Public types ──────────────────────────────────────────────────

export interface PickedRouteFile {
  uri: string;
  fileName?: string;
  mimeType?: string | null;
}

export interface ExtractionMeta {
  warnings: string[];
  pagesProcessed?: number;
  confidence?: number;
  detectedFormat?: string;
  extractionMethod?: 'remote_service' | 'local';
}

export type ExtractionErrorCode =
  | 'NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'SERVER_ERROR'
  | 'EMPTY_RESULT'
  | 'NETWORK_ERROR';

export type DocumentExtractionResult =
  | {
      success: true;
      extractedText: string;
      extractionMethod: 'remote_service' | 'local';
      warnings: string[];
      pagesProcessed?: number;
      confidence?: number;
      detectedFormat?: string;
    }
  | {
      success: false;
      errorCode: ExtractionErrorCode;
      userMessage: string;
      technicalMessage: string;
    };

// ── Backend wire shapes ───────────────────────────────────────────

interface ExtractionRequest {
  fileName: string;
  mimeType: string;
  base64Content: string;
  requestedOutput: 'plain_text';
  appVersion: string;
  buildNumber: string;
}

interface ExtractionResponse {
  extractedText: string;
  pagesProcessed: number;
  confidence: number;
  warnings: string[];
  detectedFormat: string;
}

// ── Config ────────────────────────────────────────────────────────

function getExtractionUrl(): string | null {
  const fromEnv = process.env['EXPO_PUBLIC_DOCUMENT_EXTRACTION_URL'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const fromConfig = Constants.expoConfig?.extra?.documentExtractionUrl as string | undefined;
  if (fromConfig && fromConfig.length > 0) return fromConfig;

  return null;
}

export function isDocumentExtractionConfigured(): boolean {
  return getExtractionUrl() !== null;
}

// ── Main adapter ──────────────────────────────────────────────────

export async function extractRouteTextFromDocument(
  file: PickedRouteFile,
  onProgress?: (stage: 'uploading' | 'extracting') => void,
): Promise<DocumentExtractionResult> {
  const serviceUrl = getExtractionUrl();

  if (!serviceUrl) {
    return {
      success: false,
      errorCode: 'NOT_CONFIGURED',
      userMessage:
        'PDF and Word imports require document extraction setup. ' +
        'Use CSV, XLSX, TXT, or pasted text for now.',
      technicalMessage:
        'EXPO_PUBLIC_DOCUMENT_EXTRACTION_URL or extra.documentExtractionUrl is not set.',
    };
  }

  try {
    onProgress?.('uploading');

    const base64Content = await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const appVersion = (Constants.expoConfig?.version ?? '1.0.0') as string;
    const buildNumber = (Constants.expoConfig?.ios?.buildNumber ?? '1') as string;

    const requestBody: ExtractionRequest = {
      fileName: file.fileName ?? 'document',
      mimeType: file.mimeType ?? 'application/octet-stream',
      base64Content,
      requestedOutput: 'plain_text',
      appVersion,
      buildNumber,
    };

    onProgress?.('extracting');

    const response = await fetch(`${serviceUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        success: false,
        errorCode: 'SERVER_ERROR',
        userMessage: `Extraction service error (${response.status}). Please try again or use CSV/XLSX.`,
        technicalMessage: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    const data = (await response.json()) as ExtractionResponse;

    if (!data.extractedText || data.extractedText.trim().length === 0) {
      return {
        success: false,
        errorCode: 'EMPTY_RESULT',
        userMessage:
          'No readable text found in this document. ' +
          'It may be image-only or require OCR. Try re-exporting as CSV.',
        technicalMessage: 'extractedText was empty or whitespace in service response.',
      };
    }

    return {
      success: true,
      extractedText: data.extractedText,
      extractionMethod: 'remote_service',
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      pagesProcessed: data.pagesProcessed,
      confidence: data.confidence,
      detectedFormat: data.detectedFormat,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      userMessage:
        'Could not reach the extraction service. Check your connection and try again.',
      technicalMessage: msg,
    };
  }
}
