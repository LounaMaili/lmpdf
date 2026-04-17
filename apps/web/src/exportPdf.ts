import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import type { FieldModel } from './types';

type Rotation = 0 | 90 | 180 | 270;

type Box = { x: number; y: number; w: number; h: number };
type OverflowUiStateEntry = {
  anchorFieldId: string;
  usedFieldIds: string[];
  globalText: string;
  version: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseContinuousKey(
  key: string,
): { page: number; groupId: string; anchorId: string } | null {
  const first = key.indexOf(':');
  const last = key.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const page = Number(key.slice(0, first));
  if (!Number.isFinite(page) || page <= 0) return null;
  const groupId = key.slice(first + 1, last);
  const anchorId = key.slice(last + 1);
  if (!groupId || !anchorId) return null;
  return { page, groupId, anchorId };
}

function normalizeRotation(angle: number): Rotation {
  const n = ((angle % 360) + 360) % 360;
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

/**
 * Build a map of continuous (overflow) field groups per page.
 */
function buildContinuousIndex(
  overflowUiState?: Record<string, OverflowUiStateEntry>,
): Map<number, Array<{ key: string; state: OverflowUiStateEntry }>> {
  const map = new Map<
    number,
    Array<{ key: string; state: OverflowUiStateEntry }>
  >();
  if (!overflowUiState) return map;
  for (const [key, state] of Object.entries(overflowUiState)) {
    const parsed = parseContinuousKey(key);
    if (!parsed) continue;
    const list = map.get(parsed.page) || [];
    list.push({ key, state });
    map.set(parsed.page, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Shared rendering
// ---------------------------------------------------------------------------

/**
 * Draw all field values onto the PDF pages.
 *
 * Coordinate system
 * ─────────────────
 * Fields are stored in **portrait editor coordinates** (origin top-left,
 * y ↓).  The PDF content stream uses **portrait PDF coordinates** (origin
 * bottom-left, y ↑).  A simple uniform scale maps one to the other; this
 * was validated with debug rectangles (positions exact).
 *
 * When `rotation` is 90 (editor shown landscape via CSS), the exported PDF
 * must also open landscape.  We set `/Rotate 90` on the page so the viewer
 * rotates the display 90° CW, then counter-rotate each text element by
 * `degrees(90)` (CCW) so the glyphs appear upright.
 *
 * Key math for /Rotate 90
 * ───────────────────────
 * Content point (cx, cy) on a W×H page maps to landscape display:
 *   display_x = cy           display_y = W − cx
 *
 * A field at portrait content (pdfX, pdfY, box.w, box.h) appears in
 * landscape at:
 *   lx = pdfY                ly = W − pdfX − box.w
 *   lw = box.h               lh = box.w
 *
 * Text drawn at content anchor (cx, cy) with `rotate: degrees(90)` (CCW)
 * extends **upward** in content space → **rightward** in display.  For
 * line `i` the anchor is:
 *   cx = pdfX + padTop + lineHeight·(i+1) + baselineDown
 *   cy = pdfY + padX
 */
async function renderFieldsOnPages(
  pdfDoc: PDFDocument,
  fields: FieldModel[],
  rotation: Rotation,
  pageCount: number,
  editorW: number,
  editorH: number,
  overflowUiState?: Record<string, OverflowUiStateEntry>,
): Promise<void> {
  let pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('PDF vide');

  // Ensure enough pages for repeated forms
  if (pages.length < pageCount) {
    const needed = pageCount - pages.length;
    const copied = await pdfDoc.copyPages(
      pdfDoc,
      Array.from({ length: needed }, () => 0),
    );
    copied.forEach((p) => pdfDoc.addPage(p));
    pages = pdfDoc.getPages();
  }

  const { width: pdfW, height: pdfH } = pages[0].getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Uniform scale: editor portrait → PDF portrait
  const fieldSx = editorW > 0 ? pdfW / editorW : 1;
  const fieldSy = editorH > 0 ? pdfH / editorH : 1;

  const continuousByPage = buildContinuousIndex(overflowUiState);

  // ── Per-page rendering ──────────────────────────────────────────────────

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    const page = pages[pageIndex - 1];

    // Combine any existing /Rotate with the editor rotation
    const existingRotation = normalizeRotation(page.getRotation().angle);
    const targetRotation = normalizeRotation(existingRotation + rotation);
    if (targetRotation !== 0) {
      page.setRotation(degrees(targetRotation));
    }

    const pageFields = fields.filter(
      (f) => (f.pageNumber ?? 1) === pageIndex,
    );
    const pageFieldsById = new Map(
      pageFields.map((f) => [f.id, f] as const),
    );
    const pageContinuous = continuousByPage.get(pageIndex) || [];
    const renderedContinuousAnchors = new Set<string>();

    // ── Per-field rendering ──────────────────────────────────────────────

    for (const originalField of pageFields) {
      let f: FieldModel = originalField;
      let fieldValue = originalField.value ?? '';

      // Handle continuous (overflow) fields — merge into a single zone
      if (originalField.type === 'text' || originalField.type === 'date') {
        const entry = pageContinuous.find(
          (e) =>
            e.state.anchorFieldId === originalField.id ||
            e.state.usedFieldIds.includes(originalField.id),
        );
        if (entry) {
          const { state } = entry;
          if (state.anchorFieldId !== originalField.id) continue;
          if (renderedContinuousAnchors.has(state.anchorFieldId)) continue;
          renderedContinuousAnchors.add(state.anchorFieldId);

          const used = state.usedFieldIds
            .map((id) => pageFieldsById.get(id))
            .filter(Boolean) as FieldModel[];
          if (used.length > 0) {
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const u of used) {
              minX = Math.min(minX, u.x);
              minY = Math.min(minY, u.y);
              maxX = Math.max(maxX, u.x + u.w);
              maxY = Math.max(maxY, u.y + u.h);
            }
            f = {
              ...originalField,
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
            };
          }
          fieldValue = state.globalText ?? fieldValue;
        }
      }

      // Skip empty text/date fields
      if (!fieldValue && (f.type === 'text' || f.type === 'date')) continue;

      // ── Coordinate mapping (proven correct by debug rectangles) ──────

      const box: Box = {
        x: f.x * fieldSx,
        y: f.y * fieldSy,
        w: f.w * fieldSx,
        h: f.h * fieldSy,
      };
      const pdfX = box.x;
      const pdfY = pdfH - box.y - box.h;

      // CSS px (96 DPI) → PDF points (72 pt/inch)
      const fontSize = Math.min(f.style.fontSize * 72 / 96, box.h - 2);
      const selectedFont =
        f.style.fontWeight === 'bold' ? fontBold : font;

      const colorHex = f.style.color || '#000000';
      const cr = parseInt(colorHex.slice(1, 3), 16) / 255;
      const cg = parseInt(colorHex.slice(3, 5), 16) / 255;
      const cb = parseInt(colorHex.slice(5, 7), 16) / 255;

      const padX = Math.max(2, 6 * fieldSx);
      const padTop = Math.max(1, 2 * fieldSy);
      const baselineDown = Math.max(1, 2 * fieldSy);

      // ── Draw based on rotation ────────────────────────────────────────

      const isLandscape = targetRotation === 90 || targetRotation === 270;

      if (isLandscape) {
        drawFieldLandscape(
          page,
          f,
          fieldValue,
          pdfX,
          pdfY,
          box,
          pdfW,
          pdfH,
          padX,
          padTop,
          baselineDown,
          fontSize,
          selectedFont,
          cr,
          cg,
          cb,
          targetRotation,
        );
      } else {
        drawFieldPortrait(
          page,
          f,
          fieldValue,
          pdfX,
          pdfY,
          box,
          padX,
          padTop,
          baselineDown,
          fontSize,
          selectedFont,
          cr,
          cg,
          cb,
        );
      }
    }

    // Page numbering for multi-page exports
    if (pageCount > 1) {
      drawPageNumber(page, pageIndex, pageCount, pdfW, pdfH, font, targetRotation);
    }
  }
}

// ---------------------------------------------------------------------------
// Portrait drawing (rotation = 0 or 180)
// ---------------------------------------------------------------------------

function drawFieldPortrait(
  page: import('pdf-lib').PDFPage,
  f: FieldModel,
  fieldValue: string,
  pdfX: number,
  pdfY: number,
  box: Box,
  padX: number,
  padTop: number,
  baselineDown: number,
  fontSize: number,
  selectedFont: import('pdf-lib').PDFFont,
  cr: number,
  cg: number,
  cb: number,
): void {
  if (f.type === 'checkbox') {
    drawCheckboxPortrait(page, pdfX, pdfY, box, cr, cg, cb, fieldValue);
  } else if (f.type === 'counter-tally' || f.type === 'counter-numeric') {
    const val = fieldValue || '0';
    page.drawText(val, {
      x: pdfX + padX,
      y: pdfY + Math.max(2, box.h * 0.08),
      size: fontSize,
      font: selectedFont,
      color: rgb(cr, cg, cb),
    });
  } else {
    drawTextPortrait(
      page, f, fieldValue, pdfX, pdfY, box,
      padX, padTop, baselineDown, fontSize, selectedFont, cr, cg, cb,
    );
  }
}

function drawCheckboxPortrait(
  page: import('pdf-lib').PDFPage,
  pdfX: number,
  pdfY: number,
  box: Box,
  cr: number,
  cg: number,
  cb: number,
  fieldValue: string,
): void {
  if (fieldValue !== 'true') return;
  const w = box.w;
  const h = box.h;
  const p1 = { x: pdfX + w * 0.18, y: pdfY + h * 0.45 };
  const p2 = { x: pdfX + w * 0.40, y: pdfY + h * 0.20 };
  const p3 = { x: pdfX + w * 0.82, y: pdfY + h * 0.78 };
  const lineWidth = Math.max(1.4, Math.min(w, h) * 0.09);
  page.drawLine({ start: p1, end: p2, thickness: lineWidth, color: rgb(cr, cg, cb) });
  page.drawLine({ start: p2, end: p3, thickness: lineWidth, color: rgb(cr, cg, cb) });
}

function drawTextPortrait(
  page: import('pdf-lib').PDFPage,
  f: FieldModel,
  fieldValue: string,
  pdfX: number,
  pdfY: number,
  box: Box,
  padX: number,
  padTop: number,
  baselineDown: number,
  fontSize: number,
  selectedFont: import('pdf-lib').PDFFont,
  cr: number,
  cg: number,
  cb: number,
): void {
  // Optional mask background
  if (f.style.maskBackground) {
    drawMaskRect(page, pdfX, pdfY, box, f.style.backgroundColor);
  }

  const raw = fieldValue ?? '';
  const maxWidth = Math.max(8, box.w - padX * 2);
  const wrapped = wrapText(raw, selectedFont, fontSize, maxWidth);
  const lineHeight = Math.max(fontSize * 1.2, 10);
  const maxLines = Math.max(1, Math.floor((box.h - padTop * 2) / lineHeight));
  const visible = wrapped.slice(0, maxLines);

  visible.forEach((line, idx) => {
    page.drawText(line, {
      x: pdfX + padX,
      y: pdfY + box.h - padTop - lineHeight * (idx + 1) - baselineDown,
      size: fontSize,
      font: selectedFont,
      color: rgb(cr, cg, cb),
      maxWidth,
    });
  });
}

// ---------------------------------------------------------------------------
// Landscape drawing (rotation = 90 or 270)
// ---------------------------------------------------------------------------

/**
 * Draw a field when the page has /Rotate 90 (or 270).
 *
 * With /Rotate 90 the viewer rotates the display 90° CW.  Content point
 * (cx, cy) on a W×H page appears at landscape display (cy, W−cx).
 *
 * We draw text with `rotate: degrees(90)` (CCW) so glyphs face upright.
 * The anchor is adjusted: text extends **upward** in content → **rightward**
 * in display.  For line i:
 *   anchor_x = pdfX + padTop + lineHeight·(i+1) + baselineDown
 *   anchor_y = pdfY + padX
 */
function drawFieldLandscape(
  page: import('pdf-lib').PDFPage,
  f: FieldModel,
  fieldValue: string,
  pdfX: number,
  pdfY: number,
  box: Box,
  pdfW: number,
  _pdfH: number,
  padX: number,
  padTop: number,
  baselineDown: number,
  fontSize: number,
  selectedFont: import('pdf-lib').PDFFont,
  cr: number,
  cg: number,
  cb: number,
  targetRotation: Rotation,
): void {
  // Text rotation: CCW 90° to compensate for /Rotate 90° CW display
  // For /Rotate 270 → degrees(270) CCW = degrees(-90) CW
  const textRot =
    targetRotation === 90
      ? degrees(90)
      : targetRotation === 270
        ? degrees(270)
        : degrees(targetRotation);

  if (f.type === 'checkbox') {
    drawCheckboxLandscape(
      page, pdfX, pdfY, box, pdfW, cr, cg, cb, fieldValue, targetRotation,
    );
  } else if (f.type === 'counter-tally' || f.type === 'counter-numeric') {
    const val = fieldValue || '0';
    // In landscape display, field width = box.h, field height = box.w
    // Counter text: near the bottom-left of the display field
    if (targetRotation === 90) {
      // Anchor: content x near top of content field, content y near left
      const tx = pdfX + box.w - Math.max(2, box.w * 0.08);
      const ty = pdfY + padX;
      page.drawText(val, {
        x: tx, y: ty, size: fontSize, font: selectedFont,
        color: rgb(cr, cg, cb), rotate: textRot,
      });
    } else {
      // rotation 270 — TODO: fine-tune anchor if needed
      const tx = pdfX + Math.max(2, box.w * 0.08);
      const ty = pdfY + box.h - padX;
      page.drawText(val, {
        x: tx, y: ty, size: fontSize, font: selectedFont,
        color: rgb(cr, cg, cb), rotate: textRot,
      });
    }
  } else {
    drawTextLandscape(
      page, f, fieldValue, pdfX, pdfY, box, pdfW,
      padX, padTop, baselineDown, fontSize, selectedFont,
      cr, cg, cb, textRot, targetRotation,
    );
  }
}

function drawCheckboxLandscape(
  page: import('pdf-lib').PDFPage,
  pdfX: number,
  pdfY: number,
  box: Box,
  pdfW: number,
  cr: number,
  cg: number,
  cb: number,
  fieldValue: string,
  targetRotation: Rotation,
): void {
  if (fieldValue !== 'true') return;

  // Display field dimensions: lw = box.h, lh = box.w
  // Compute check-mark in display space, then convert to content
  if (targetRotation === 90) {
    // Display coords: dx = pdfY, dy = pdfW − pdfX − box.w, dw = box.h, dh = box.w
    const dx = pdfY;
    const dy = pdfW - pdfX - box.w;
    const dw = box.h;
    const dh = box.w;
    const dp1 = { x: dx + dw * 0.18, y: dy + dh * 0.45 };
    const dp2 = { x: dx + dw * 0.40, y: dy + dh * 0.20 };
    const dp3 = { x: dx + dw * 0.82, y: dy + dh * 0.78 };
    // Display → content: cx = pdfW − dy, cy = dx
    const p1 = { x: pdfW - dp1.y, y: dp1.x };
    const p2 = { x: pdfW - dp2.y, y: dp2.x };
    const p3 = { x: pdfW - dp3.y, y: dp3.x };
    const lineWidth = Math.max(1.4, Math.min(dw, dh) * 0.09);
    page.drawLine({ start: p1, end: p2, thickness: lineWidth, color: rgb(cr, cg, cb) });
    page.drawLine({ start: p2, end: p3, thickness: lineWidth, color: rgb(cr, cg, cb) });
  } else {
    // rotation 270 — TODO: implement if needed
    drawCheckboxPortrait(page, pdfX, pdfY, box, cr, cg, cb, fieldValue);
  }
}

function drawTextLandscape(
  page: import('pdf-lib').PDFPage,
  f: FieldModel,
  fieldValue: string,
  pdfX: number,
  pdfY: number,
  box: Box,
  pdfW: number,
  padX: number,
  padTop: number,
  baselineDown: number,
  fontSize: number,
  selectedFont: import('pdf-lib').PDFFont,
  cr: number,
  cg: number,
  cb: number,
  textRot: ReturnType<typeof degrees>,
  targetRotation: Rotation,
): void {
  // Mask background (drawn in content space — /Rotate handles the visual)
  if (f.style.maskBackground) {
    drawMaskRect(page, pdfX, pdfY, box, f.style.backgroundColor);
  }

  // In landscape display: visual width = box.h, visual height = box.w
  const visualW = box.h;
  const visualH = box.w;

  const raw = fieldValue ?? '';
  const maxTextWidth = Math.max(8, visualW - padX * 2);
  const wrapped = wrapText(raw, selectedFont, fontSize, maxTextWidth);
  const lineHeight = Math.max(fontSize * 1.2, 10);
  const maxLines = Math.max(1, Math.floor((visualH - padTop * 2) / lineHeight));
  const visible = wrapped.slice(0, maxLines);

  if (targetRotation === 90) {
    // Line i anchor:
    //   cx = pdfX + padTop + lineHeight·(i+1) + baselineDown
    //   cy = pdfY + padX
    visible.forEach((line, idx) => {
      const tx = pdfX + padTop + lineHeight * (idx + 1) + baselineDown;
      const ty = pdfY + padX;
      page.drawText(line, {
        x: tx,
        y: ty,
        size: fontSize,
        font: selectedFont,
        color: rgb(cr, cg, cb),
        maxWidth: maxTextWidth,
        rotate: textRot,
      });
    });
  } else {
    // rotation 270 — TODO: fine-tune anchors if needed
    // For now, use mirrored offsets
    visible.forEach((line, idx) => {
      const tx = pdfX + box.w - padTop - lineHeight * (idx + 1) - baselineDown;
      const ty = pdfY + box.h - padX;
      page.drawText(line, {
        x: tx,
        y: ty,
        size: fontSize,
        font: selectedFont,
        color: rgb(cr, cg, cb),
        maxWidth: maxTextWidth,
        rotate: textRot,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Draw a filled rectangle to mask the field background. */
function drawMaskRect(
  page: import('pdf-lib').PDFPage,
  pdfX: number,
  pdfY: number,
  box: Box,
  bgColor?: string,
): void {
  const hex = bgColor || '#ffffff';
  const br = parseInt(hex.slice(1, 3), 16) / 255;
  const bg = parseInt(hex.slice(3, 5), 16) / 255;
  const bb = parseInt(hex.slice(5, 7), 16) / 255;
  page.drawRectangle({
    x: pdfX,
    y: pdfY,
    width: box.w,
    height: box.h,
    color: rgb(br, bg, bb),
  });
}

/** Word-wrap text to fit within maxWidth using the given font/size. */
function wrapText(
  raw: string,
  font: import('pdf-lib').PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines = raw.split(/\r?\n/);
  const wrapped: string[] = [];
  for (const line of lines) {
    if (!line) {
      wrapped.push('');
      continue;
    }
    const words = line.split(' ');
    let current = '';
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
      } else {
        if (current) wrapped.push(current);
        current = w;
      }
    }
    wrapped.push(current);
  }
  return wrapped;
}

/** Draw page number in the correct corner based on rotation. */
function drawPageNumber(
  page: import('pdf-lib').PDFPage,
  pageIndex: number,
  pageCount: number,
  pdfW: number,
  pdfH: number,
  font: import('pdf-lib').PDFFont,
  targetRotation: Rotation,
): void {
  const text = `Page ${pageIndex}/${pageCount}`;
  const opts: Parameters<typeof page.drawText>[1] = {
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
  };

  if (targetRotation === 90) {
    // Bottom-right in landscape display:
    // display (pdfH − 100, 12) → content (pdfW − 12, pdfH − 100)
    opts.x = pdfW - 12;
    opts.y = pdfH - 100;
    opts.rotate = degrees(90);
  } else if (targetRotation === 270) {
    opts.x = 12;
    opts.y = 100;
    opts.rotate = degrees(270);
  } else {
    opts.x = pdfW - 100;
    opts.y = 12;
  }
  page.drawText(text, opts);
}

// ---------------------------------------------------------------------------
// Load PDF or image source
// ---------------------------------------------------------------------------

async function loadSourceDocument(
  sourceBytes: ArrayBuffer,
  contentType: string,
  pdfDoc: PDFDocument,
  pageCount: number,
): Promise<PDFDocument> {
  if (contentType.includes('pdf')) {
    return PDFDocument.load(sourceBytes);
  }

  // Image source: create one page per requested copy
  const doc = await PDFDocument.create();
  let image;
  if (contentType.includes('png')) {
    image = await doc.embedPng(sourceBytes);
  } else {
    image = await doc.embedJpg(sourceBytes);
  }
  for (let i = 0; i < pageCount; i++) {
    const pg = doc.addPage([image.width, image.height]);
    pg.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export a filled PDF: overlay field values on the original document.
 * Downloads the result as a file.
 */
export async function exportFilledPdf(
  sourceUrl: string,
  fields: FieldModel[],
  rotation: Rotation,
  fileName: string,
  pageCount = 1,
  editorPageW?: number,
  editorPageH?: number,
  overflowUiState?: Record<string, OverflowUiStateEntry>,
): Promise<void> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error('Impossible de charger le document source');
  const sourceBytes = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || '';

  const pdfDoc = await loadSourceDocument(sourceBytes, contentType, await PDFDocument.create(), pageCount);
  const editorW = editorPageW || pdfDoc.getPages()[0]?.getWidth() || 595;
  const editorH = editorPageH || pdfDoc.getPages()[0]?.getHeight() || 842;

  await renderFieldsOnPages(
    pdfDoc, fields, rotation, pageCount, editorW, editorH, overflowUiState,
  );

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName || 'export'}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a filled PDF and return it as a Blob (no download).
 * Used by server-side export to send the PDF bytes to the backend.
 */
export async function generateFilledPdfBlob(
  sourceUrl: string,
  fields: FieldModel[],
  rotation: Rotation,
  pageCount = 1,
  editorPageW?: number,
  editorPageH?: number,
  overflowUiState?: Record<string, OverflowUiStateEntry>,
): Promise<Blob> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error('Impossible de charger le document source');
  const sourceBytes = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || '';

  const pdfDoc = await loadSourceDocument(sourceBytes, contentType, await PDFDocument.create(), pageCount);
  const editorW = editorPageW || pdfDoc.getPages()[0]?.getWidth() || 595;
  const editorH = editorPageH || pdfDoc.getPages()[0]?.getHeight() || 842;

  await renderFieldsOnPages(
    pdfDoc, fields, rotation, pageCount, editorW, editorH, overflowUiState,
  );

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
