import { sanitiseSegment } from './export-security';

/** Remove only known document/image extensions, preserving meaningful dotted names. */
export function documentNameStem(name: string): string {
  return name.trim().replace(/(?:\.(?:pdf|png|jpe?g|webp|tiff?|gif|bmp))+$/i, '');
}

/** One leaf filename, never a path or an authorization/rule input. */
export function pdfOutputFileName(name: string): string {
  const cleaned = sanitiseSegment((name.trim() || 'document').normalize('NFC').replace(/[\\/]/g, '_'))
    .replace(/[. ]+$/g, '');
  let stem = '', bytes = 0;
  for (const character of documentNameStem(cleaned)) {
    const length = Buffer.byteLength(character, 'utf8');
    if (bytes + length > 180) break;
    stem += character; bytes += length;
  }
  return `${stem.replace(/[. ]+$/g, '') || 'document'}.pdf`;
}
