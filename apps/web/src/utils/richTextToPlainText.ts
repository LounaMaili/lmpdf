/**
 * richTextToPlainText.ts
 *
 * Convert sanitized rich-text HTML to plain text for PDF export.
 * pdf-lib cannot render HTML — it writes strings as-is, so HTML tags
 * would appear literally in the exported PDF.
 *
 * This function strips all HTML tags and returns clean text,
 * preserving line breaks from block-level elements.
 *
 * Only call this for field.type === 'text' values.
 * Dates, checkboxes, counters, etc. should not go through this.
 */

export function richTextToPlainText(value: string): string {
  if (!value) return '';

  // If it's not HTML, return as-is.
  if (!/[<>]/.test(value)) return value;

  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html');

  // Preserve line breaks from block-level elements.
  doc.querySelectorAll('div, p, br').forEach((node) => {
    if (node.nodeName === 'BR') {
      node.replaceWith('\n');
    }
  });

  return (
    doc.body.textContent
      ?.replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim() ?? ''
  );
}