/**
 * Conservative normalization pass applied to all extracted text before parsing.
 * Strips PDF/DOCX artifacts without mangling real address content.
 * The heavy lifting (address parsing, validation) happens in the mobile app.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

    // Form feed / page break characters → blank line
    .replace(/\f/g, '\n\n')

    // Remove null bytes and other control characters (keep tab, LF)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

    // Strip common PDF artifacts: repeated dashes used as dividers
    .replace(/^[-–—=*#]{4,}\s*$/gm, '')

    // Remove lines that are ONLY page numbers (e.g., "- 3 -", "Page 3", "3")
    .replace(/^[-–\s]*[Pp]age\s+\d+\s*(?:of\s+\d+)?[-–\s]*$/gm, '')
    .replace(/^[-–\s]*\d+\s*[-–\s]*$/gm, '')

    // Strip bullet symbols from line starts (preserve content after them)
    .replace(/^[\s]*[•·▪▸◆◇○●★]\s*/gm, '')

    // Strip common route numbering prefixes like "Stop 1:", "1.", "STOP #3 —"
    // Only strip if the remainder of the line contains an address-like string
    .replace(/^(?:Stop\s+#?\d+\s*[:\-–—]?\s*|#\d+\s*[:\-–—]\s*)/gim, '')

    // Collapse 3+ consecutive blank lines to 2
    .replace(/\n{3,}/g, '\n\n')

    // Normalize spaces within each line (collapse multiple spaces/tabs to one)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')

    // Final trim
    .trim();
}
