/**
 * sanitizeRichText.ts
 *
 * Sanitize HTML from rich-text fields before rendering or storage.
 * Only applies to fields of type 'text' — never to dates, labels, emails, etc.
 *
 * Uses DOMPurify with a strict whitelist matching the editor's formatting:
 * bold, italic, underline, strikethrough, color, and basic structure.
 */

import DOMPurify from 'dompurify';

// Configure DOMPurify once with the strictest policy matching editor capabilities
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  // Remove any style property not in the allowed CSS list
  if (data.attrName === 'style' && data.attrValue) {
    const allowed = new Set([
      'color',
      'font-weight',
      'font-style',
      'text-decoration',
      'text-decoration-line',
      'background-color',
    ]);
    const filtered = data.attrValue
      .split(';')
      .map((s) => s.trim())
      .filter((s) => {
        const prop = s.split(':')[0]?.trim().toLowerCase();
        return prop && allowed.has(prop);
      })
      .join('; ');
    data.attrValue = filtered;
    if (!filtered) {
      return false; // Remove the attribute entirely
    }
  }
  return data;
});

/**
 * Sanitize rich-text HTML for safe rendering.
 * Only call this for field.type === 'text' values.
 */
export function sanitizeRichTextHtml(html: string): string {
  if (!html) return html;

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'b', 'strong', 'i', 'em', 'u', 's', 'span', 'br', 'div', 'mark',
    ],
    ALLOWED_ATTR: ['style'],
    // KEEP_CONTENT ensures that disallowed tags drop their tags but keep text
    KEEP_CONTENT: true,
  });
}