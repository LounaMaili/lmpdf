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

const ALLOWED_CSS_PROPERTIES: Record<string, RegExp[]> = {
  color: [/^#[0-9a-fA-F]{3,8}$/, /^(rgb|hsl)a?\(/],
  'font-weight': [/^(normal|bold|[1-9]00)$/],
  'font-style': [/^(normal|italic)$/],
  'text-decoration': [/^(none|underline|line-through)$/],
  'text-decoration-line': [/^(none|underline|line-through)$/],
  'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^(rgb|hsl)a?\(/],
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