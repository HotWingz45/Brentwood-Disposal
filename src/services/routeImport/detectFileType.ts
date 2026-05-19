import type { FileType } from './types';

export function detectFileType(uri: string, mimeType?: string | null): FileType {
  if (mimeType) {
    const m = mimeType.toLowerCase();
    if (m.includes('csv') || m === 'text/comma-separated-values') return 'csv';
    if (m.includes('spreadsheetml') || m.includes('xlsx') || m.includes('excel')) return 'xlsx';
    if (m === 'application/pdf') return 'pdf';
    if (m.includes('wordprocessingml') || m.includes('msword')) return 'docx';
    if (m.startsWith('text/')) return 'txt';
  }
  const lower = (uri.split('?')[0] ?? uri).toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  if (lower.endsWith('.txt')) return 'txt';
  return 'unknown';
}
