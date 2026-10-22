import { sanitiseSegment } from './export-security';

/** Remove only known document/image extensions, preserving meaningful dotted names. */
export function documentNameStem(name: string): string {
  return name.trim().replace(/(?:\.(?:pdf|png|jpe?g|webp|tiff?|gif|bmp))+$/i, '');
}

/** One leaf filename, never a path or an authorization/rule input. */
export function pdfOutputFileName(name: string): string {
  const cleaned = sanitiseSegment(name.normalize('NFC').replace(/[\\/]/g, '_'))
    .replace(/[. ]+$/g, '');
  const stem = documentNameStem(cleaned).slice(0, 180).replace(/[. ]+$/g, '');
  return `${stem || 'document'}.pdf`;
}
