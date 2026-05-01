/**
 * sanitizeRichText.ts
 *
 * Server-side sanitization for rich-text HTML field values.
 * Only call this for field.type === 'text' values — never dates, labels, emails, etc.
 *
 * Uses sanitize-html with a strict whitelist matching the editor's formatting.
 */

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'span', 'br', 'div', 'mark',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['style'],
};

const ALLOWED_CSS_PROPERTIES: Record<string, boolean> = {
  color: true,
  'font-weight': true,
  'font-style': true,
  'text-decoration': true,
  'text-decoration-line': true,
  'background-color': true,
};

/**
 * Sanitize rich-text HTML for safe storage.
 * Only call this for field.type === 'text' values.
 */
export function sanitizeRichTextHtml(html: string): string {
  if (!html) return html;

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: {
      '*': ALLOWED_CSS_PROPERTIES,
    },
    // Keep text content from disallowed tags
    disallowedTagsMode: 'recursiveEscape',
  });
}