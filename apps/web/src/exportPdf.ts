/**
 * exportPdf.ts — PDF export with normalized coordinate mapping
 *
 * Architecture:
 * ─────────────
 * Fields are stored in **canvas pixels** (pageW × pageH).
 * The export pipeline normalizes them to 0→1 before mapping to PDF points:
 *
 *   Canvas pixels          Normalized           PDF points
 *   ┌──────────┐       ┌──────────┐        ┌──────────┐
 *   │ x: 397px │  ──►  │ x: 0.50 │  ──►   │ x: 288.5 │
 *   │ w: 199px │       │ w: 0.25 │        │ w: 144.3 │
 *   └──────────┘       └──────────┘        └──────────┘
 *      ÷ pageW              × pdfW
 *
 * This eliminates accumulated rounding errors from chained ratio calculations
 * and makes the export independent of canvas resolution.
 *
 * Rotation:
 * ─────────
 * When rotation=90 (editor shows landscape via CSS), the exported PDF gets
 * /Rotate 90 so the viewer displays landscape. Text is counter-rotated by
 * degrees(90) CCW so glyphs appear upright.
 *
 * Dead code from previous attempts has been removed:
 * - mapDisplayBoxToPdfBox() — unused after normalized approach
 * - mapFieldToPdfBox() — unused after normalized approach
 */

import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FieldModel } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ── Padding constants (matching CSS .field-input { padding: 2px 6px }) ──
// Fields are stored in PDF points — no conversion needed.
const CSS_PAD_TOP = 2;
const CSS_PAD_LEFT = 6;
const CSS_LINE_HEIGHT = 1.2;

// Calibration nudges to compensate for irreducible CSS vs pdf-lib rendering differences
const TEXT_X_NUDGE = -1;
const TEXT_Y_NUDGE = -2.4;
const DATE_EXTRA_Y_NUDGE = 0.8;
const LANDSCAPE_TEXT_Y_NUDGE = -2.4;
const LANDSCAPE_DATE_EXTRA_Y_NUDGE = 0.8;

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

/**
 * Convert canvas-pixel field box to normalized 0→1 coordinates.
 */
function normalizeBox(
  f: FieldModel,
  canvasW: number,
  canvasH: number,
): Box {
  return {
    x: canvasW > 0 ? f.x / canvasW : 0,
    y: canvasH > 0 ? f.y / canvasH : 0,
    w: canvasW > 0 ? f.w / canvasW : 0,
    h: canvasH > 0 ? f.h / canvasH : 0,
  };
}

/**
 * Map normalized box to PDF content-stream coordinates.
 * PDF uses bottom-left origin, y ↑. Normalized uses top-left origin, y ↓.
 */
function normalizedToPdf(
  norm: Box,
  pdfW: number,
  pdfH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: norm.x * pdfW,
    y: (1 - norm.y - norm.h) * pdfH,
    w: norm.w * pdfW,
    h: norm.h * pdfH,
  };
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

/** Draw a filled rectangle to mask the field background. */
function drawMaskRect(
  page: import('pdf-lib').PDFPage,
  pdfX: number,
  pdfY: number,
  boxW: number,
  boxH: number,
  bgColor?: string,
): void {
  const hex = bgColor || '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  page.drawRectangle({
    x: pdfX,
    y: pdfY,
    width: boxW,
    height: boxH,
    color: rgb(r, g, b),
  });
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
// Source loading
// ---------------------------------------------------------------------------

async function loadSourceDocument(
  sourceBytes: ArrayBuffer,
  contentType: string,
): Promise<PDFDocument> {
  if (contentType.includes('pdf')) {
    return PDFDocument.load(sourceBytes);
  }

  // Image source: create one page per copy
  const doc = await PDFDocument.create();
  let image;
  if (contentType.includes('png')) {
    image = await doc.embedPng(sourceBytes);
  } else {
    image = await doc.embedJpg(sourceBytes);
  }
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return doc;
}

// ---------------------------------------------------------------------------
// Shared rendering
// ---------------------------------------------------------------------------

async function renderFieldsOnPages(
  pdfDoc: PDFDocument,
  fields: FieldModel[],
  rotation: Rotation,
  pageCount: number,
  canvasW: number,
  canvasH: number,
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

  // Embed same font as editor (Liberation Sans) to eliminate baseline differences
  pdfDoc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    fetch('/fonts/LiberationSans-Regular.ttf').then(r => r.arrayBuffer()),
    fetch('/fonts/LiberationSans-Bold.ttf').then(r => r.arrayBuffer()),
  ]);
  const font = await pdfDoc.embedFont(regularBytes);
  const fontBold = await pdfDoc.embedFont(boldBytes);

  const continuousByPage = buildContinuousIndex(overflowUiState);

  // ── Per-page rendering ──────────────────────────────────────────────────

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    const page = pages[pageIndex - 1];

    // Combine existing /Rotate with editor rotation
    const existingRotation = normalizeRotation(page.getRotation().angle);
    const targetRotation = normalizeRotation(existingRotation + rotation);
    console.log('[export rotation]', { pageIndex, existingRotation, editorRotation: rotation, targetRotation });
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

      // ── Coordinate mapping: canvas → normalized → PDF ──────────────────

      const norm = normalizeBox(f, canvasW, canvasH);
      const pdf = normalizedToPdf(norm, pdfW, pdfH);
      const pdfX = pdf.x;
      const pdfY = pdf.y;
      const boxW = pdf.w;
      const boxH = pdf.h;

      // Fields are stored in PDF points — fontSize is already in the correct unit.
      const fontSize = Math.min(f.style.fontSize, boxH - 2);
      const selectedFont =
        f.style.fontWeight === 'bold' ? fontBold : font;

      const colorHex = f.style.color || '#000000';
      const cr = parseInt(colorHex.slice(1, 3), 16) / 255;
      const cg = parseInt(colorHex.slice(3, 5), 16) / 255;
      const cb = parseInt(colorHex.slice(5, 7), 16) / 255;

      // 1:1 padding — direct CSS conversion, no ratios
      const padX = CSS_PAD_LEFT;   // 6pt
      const padTop = CSS_PAD_TOP;  // 2pt

      const isLandscape =
        targetRotation === 90 || targetRotation === 270;

      // ── Draw ───────────────────────────────────────────────────────────

      const DEBUG_FIELD_BOXES = false;

      if (DEBUG_FIELD_BOXES) {
        page.drawRectangle({
          x: pdfX, y: pdfY, width: boxW, height: boxH,
          borderColor: rgb(1, 0, 0), borderWidth: 1,
        });
      }

      try {
        if (isLandscape) {
          drawFieldLandscape(
            page, f, fieldValue, pdfX, pdfY, boxW, boxH,
            pdfW, fontSize, selectedFont, cr, cg, cb, targetRotation, pdfH,
          );
        } else {
          drawFieldPortrait(
            page, f, fieldValue, pdfX, pdfY, boxW, boxH,
            padX, padTop, fontSize,
            selectedFont, cr, cg, cb,
          );
        }
      } catch (err) {
        console.error('[LMPDF] Export field failed', {
          fieldId: f.id,
          fieldType: f.type,
          fieldValue,
          targetRotation,
          pdfX,
          pdfY,
          boxW,
          boxH,
        }, err);
        throw err;
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

/** Draw a checkbox check mark using the same geometry as the SVG editor.
 * SVG points: 25,52  42,70  75,30  (origin top-left, Y down)
 * PDF: origin bottom-left, Y up — so Y is inverted: y_pdf = boxH * (1 - y_svg/100)
 */
function drawCheckboxMark(
  page: import('pdf-lib').PDFPage,
  pdfX: number,
  pdfY: number,
  boxW: number,
  boxH: number,
  cr: number,
  cg: number,
  cb: number,
): void {
  if (
    !Number.isFinite(pdfX) ||
    !Number.isFinite(pdfY) ||
    !Number.isFinite(boxW) ||
    !Number.isFinite(boxH) ||
    boxW <= 0 ||
    boxH <= 0
  ) {
    console.warn('[LMPDF] Invalid checkbox box, skipped', {
      pdfX,
      pdfY,
      boxW,
      boxH,
    });
    return;
  }

  const toPdf = (x: number, y: number) => ({
    x: pdfX + boxW * (x / 100),
    y: pdfY + boxH * (1 - y / 100),
  });

  const p1 = toPdf(25, 52);
  const p2 = toPdf(42, 70);
  const p3 = toPdf(75, 30);

  const lw = Math.max(0.8, Math.min(boxW, boxH) * 0.07);

  page.drawLine({ start: p1, end: p2, thickness: lw, color: rgb(cr, cg, cb) });
  page.drawLine({ start: p2, end: p3, thickness: lw, color: rgb(cr, cg, cb) });
}

function drawCheckboxMarkLandscape(
  page: import('pdf-lib').PDFPage,
  pdfX: number,
  pdfY: number,
  boxW: number,
  boxH: number,
  _pdfW: number,
  _pdfH: number,
  targetRotation: number,
  cr: number,
  cg: number,
  cb: number,
): void {
  if (
    !Number.isFinite(pdfX) ||
    !Number.isFinite(pdfY) ||
    !Number.isFinite(boxW) ||
    !Number.isFinite(boxH) ||
    boxW <= 0 ||
    boxH <= 0
  ) {
    console.warn('[LMPDF] Invalid rotated checkbox box, skipped', {
      pdfX,
      pdfY,
      boxW,
      boxH,
      targetRotation,
    });
    return;
  }

  // Sécurité : si jamais appelé hors 90/270, on retombe sur le mode portrait.
  if (targetRotation !== 90 && targetRotation !== 270) {
    drawCheckboxMark(page, pdfX, pdfY, boxW, boxH, cr, cg, cb);
    return;
  }

  // Géométrie de base de la coche (même que le mode normal),
  // en coordonnées locales avec origine en haut-gauche de la case.
  const basePoints = [
    { x: boxW * 0.25, y: boxH * 0.52 },
    { x: boxW * 0.42, y: boxH * 0.70 },
    { x: boxW * 0.75, y: boxH * 0.30 },
  ];

  const cx = boxW / 2;
  const cy = boxH / 2;

  // On contre-rotate la coche pour qu'elle apparaisse dans le bon sens
  // une fois la page tournée.
  const angle = targetRotation === 90 ? -Math.PI / 2 : Math.PI / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotatePoint = (pt: { x: number; y: number }) => {
    // Coordonnées locales, origine au centre, Y vers le bas
    const dx = pt.x - cx;
    const dy = pt.y - cy;

    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    // Retour dans la boîte locale, puis conversion en coordonnées PDF
    return {
      x: pdfX + (cx + rx),
      y: pdfY + boxH - (cy + ry),
    };
  };

  const p1 = rotatePoint(basePoints[0]);
  const p2 = rotatePoint(basePoints[1]);
  const p3 = rotatePoint(basePoints[2]);

  const lw = Math.max(0.8, Math.min(boxW, boxH) * 0.07);
  const color = rgb(cr, cg, cb);

  page.drawLine({
    start: p1,
    end: p2,
    thickness: lw,
    color,
  });

  page.drawLine({
    start: p2,
    end: p3,
    thickness: lw,
    color,
  });
}

function drawFieldPortrait(
  page: import('pdf-lib').PDFPage,
  f: FieldModel,
  fieldValue: string,
  pdfX: number,
  pdfY: number,
  boxW: number,
  boxH: number,
  padX: number,
  padTop: number,
  fontSize: number,
  selectedFont: import('pdf-lib').PDFFont,
  cr: number,
  cg: number,
  cb: number,
): void {
  if (f.type === 'checkbox') {
    if (fieldValue === 'true') {
      drawCheckboxMark(page, pdfX, pdfY, boxW, boxH, cr, cg, cb);
    }
    return;
  } else if (f.type === 'counter-tally' || f.type === 'counter-numeric') {
    page.drawText(fieldValue || '0', {
      x: pdfX + padX,
      y: pdfY + boxH * 0.12,
      size: fontSize,
      font: selectedFont,
      color: rgb(cr, cg, cb),
    });
  } else {
    if (f.style.maskBackground) {
      drawMaskRect(page, pdfX, pdfY, boxW, boxH, f.style.backgroundColor);
    }
    const raw = fieldValue ?? '';
    const maxWidth = Math.max(8, boxW - padX * 2);
    const wrapped = wrapText(raw, selectedFont, fontSize, maxWidth);
    // 1:1: use the same line-height as CSS (.field-textarea has line-height: 1.2)
    const lineHeight = fontSize * CSS_LINE_HEIGHT;
    const ascent = selectedFont.heightAtSize(fontSize, { descender: false });
    // 1:1: half-leading matches browser layout (line-height > fontSize → space split top/bottom)
    const halfLeading = (lineHeight - fontSize) / 2;
    const maxLines = Math.max(1, Math.floor((boxH - padTop * 2) / lineHeight));
    const visible = wrapped.slice(0, maxLines);

    // Respect textAlign from field style
    const textAlign = f.style.textAlign || 'left';

    visible.forEach((line, idx) => {
      // Horizontal position: match CSS textAlign
      let x: number;
      if (textAlign === 'center') {
        const textWidth = selectedFont.widthOfTextAtSize(line, fontSize);
        x = pdfX + (boxW - textWidth) / 2 + TEXT_X_NUDGE;
      } else if (textAlign === 'right') {
        const textWidth = selectedFont.widthOfTextAtSize(line, fontSize);
        x = pdfX + boxW - padX - textWidth + TEXT_X_NUDGE;
      } else {
        x = pdfX + padX + TEXT_X_NUDGE;
      }

      // Vertical position: unified formula for all field types
      // padding-top → half-leading → ascent → baseline
      // Date fields get an extra nudge because they use a different HTML primitive (textarea)
      const typeYNudge = f.type === 'date' ? DATE_EXTRA_Y_NUDGE : 0;
      const y = pdfY + boxH - padTop - halfLeading - ascent - lineHeight * idx + TEXT_Y_NUDGE + typeYNudge;

      page.drawText(line, {
        x,
        y,
        size: fontSize,
        font: selectedFont,
        color: rgb(cr, cg, cb),
        maxWidth,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Landscape drawing (rotation = 90 or 270)
// ---------------------------------------------------------------------------

/**
 * With /Rotate 90 the viewer rotates 90° CW.
 * Content point (cx, cy) on W×H appears at display (cy, W−cx).
 *
 * Text with rotate=degrees(90) CCW extends **upward** in content space,
 * which appears as **rightward** in display.
 *
 * For line i the anchor is (1:1 matching browser layout):
 *   cx = pdfX + padV + halfLeading + ascent + lineHeight·i
 *   cy = pdfY + padH
 */
/**
 * Draw a field when the page has /Rotate 90 (or 270).
 *
 * Coordinate geometry for /Rotate 90:
 * ─────────────────────────────────────
 * Content point (cx, cy) on W×H page → display (cy, W − cx)
 *
 * Text drawn with rotate=degrees(90) (CCW) at anchor (cx, cy):
 *   - Glyphs extend LEFTWARD in content (−cx) → UPWARD in display
 *   - Text string goes UPWARD in content (+cy) → RIGHTWARD in display
 *
 * Text occupies in display:
 *   x: [cy, cy + textWidth]
 *   y: [W − cx, W − cx + fontSize]
 *
 * Display field dimensions: dw=boxH, dh=boxW
 * Display field origin: dx=pdfY, dy=pdfW − pdfX − boxW
 *
 * For top-left aligned text:
 *   cy = pdfY + pad_h           (left edge in display)
 *   cx = pdfX + pad_v + fontSize ascent  (so top of glyphs align with field top)
 */
function drawFieldLandscape(
  page: import('pdf-lib').PDFPage,
  f: FieldModel,
  fieldValue: string,
  pdfX: number,
  pdfY: number,
  boxW: number,
  boxH: number,
  pdfW: number,
  fontSize: number,
  selectedFont: import('pdf-lib').PDFFont,
  cr: number,
  cg: number,
  cb: number,
  targetRotation: Rotation,
  pdfH: number,
): void {
  const textRot =
    targetRotation === 90
      ? degrees(90)
      : targetRotation === 270
        ? degrees(270)
        : degrees(targetRotation);

  // In landscape display, visual dimensions are swapped:
  //   display width = boxH, display height = boxW
  const dispW = boxH;
  const dispH = boxW;

  // 1:1 padding — same as portrait
  const padH = CSS_PAD_LEFT;  // horizontal in display = 6pt
  const padV = CSS_PAD_TOP;   // vertical in display = 2pt

  // Cap fontSize by display height
  fontSize = Math.min(fontSize, dispH - 2);

  if (f.type === 'checkbox') {
    if (fieldValue === 'true') {
      drawCheckboxMarkLandscape(page, pdfX, pdfY, boxW, boxH, pdfW, pdfH, targetRotation, cr, cg, cb);
    }
    return;
  } else if (f.type === 'counter-tally' || f.type === 'counter-numeric') {
    // Counter fields: CENTER the number in the display cell
    const val = fieldValue || '0';
    const textWidth = selectedFont.widthOfTextAtSize(val, fontSize);

    if (targetRotation === 90) {
      // Center horizontally in display: cy = pdfY + dispW/2 − textWidth/2
      const cy = pdfY + dispW / 2 - textWidth / 2;
      // Center vertically: cx = pdfX + boxW/2 + (ascent−descent)/2
      // For Helvetica, (ascent−descent)/2 ≈ fontSize * 0.25
      const cx = pdfX + dispH / 2 + fontSize * 0.25;
      page.drawText(val, {
        x: cx, y: cy, size: fontSize, font: selectedFont,
        color: rgb(cr, cg, cb), rotate: textRot,
      });
    } else {
      const cy = pdfY + dispW / 2 + textWidth / 2;
      const cx = pdfX + dispH / 2 + fontSize * 0.3;
      page.drawText(val, {
        x: cx, y: cy, size: fontSize, font: selectedFont,
        color: rgb(cr, cg, cb), rotate: textRot,
      });
    }
  } else {
    // Text/date fields: top-left alignment with small padding
    if (f.style.maskBackground) {
      drawMaskRect(page, pdfX, pdfY, boxW, boxH, f.style.backgroundColor);
    }

    const raw = fieldValue ?? '';
    const maxTextWidth = Math.max(8, dispW - padH * 2);
    const wrapped = wrapText(raw, selectedFont, fontSize, maxTextWidth);
    const lineHeight = fontSize * CSS_LINE_HEIGHT;
    const ascent = selectedFont.heightAtSize(fontSize, { descender: false });
    const halfLeading = (lineHeight - fontSize) / 2;
    const maxLines = Math.max(1, Math.floor((dispH - padV * 2) / lineHeight));
    const visible = wrapped.slice(0, maxLines);

    if (targetRotation === 90) {
      /*
       * Top-left in display = left-bottom in content:
       *   cy = pdfY + padH                       (display left edge)
       *   cx = pdfX + padV + halfLeading + ascent (baseline = display top)
       *
       * Each subsequent line: cx += lineHeight   (display goes downward)
       */
      const typeYNudge = f.type === 'date' ? LANDSCAPE_DATE_EXTRA_Y_NUDGE : 0;
      visible.forEach((line, idx) => {
        page.drawText(line, {
          x: pdfX + padV + halfLeading + ascent + lineHeight * idx - LANDSCAPE_TEXT_Y_NUDGE - typeYNudge,
          y: pdfY + padH,
          size: fontSize,
          font: selectedFont,
          color: rgb(cr, cg, cb),
          maxWidth: maxTextWidth,
          rotate: textRot,
        });
      });
    } else {
      // rotation 270: mirror the offsets
      const typeYNudge270 = f.type === 'date' ? LANDSCAPE_DATE_EXTRA_Y_NUDGE : 0;
      visible.forEach((line, idx) => {
        page.drawText(line, {
          x: pdfX + boxW - padV - halfLeading - ascent - lineHeight * idx + LANDSCAPE_TEXT_Y_NUDGE + typeYNudge270,
          y: pdfY + boxH - padH,
          size: fontSize,
          font: selectedFont,
          color: rgb(cr, cg, cb),
          maxWidth: maxTextWidth,
          rotate: textRot,
        });
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export a filled PDF: overlay field values on the original document.
 * Downloads the result as a file.
 *
 * @param canvasW Canvas width in pixels (field coordinate space)
 * @param canvasH Canvas height in pixels (field coordinate space)
 */
export async function exportFilledPdf(
  sourceUrl: string,
  fields: FieldModel[],
  rotation: Rotation,
  fileName: string,
  pageCount = 1,
  canvasW?: number,
  canvasH?: number,
  overflowUiState?: Record<string, OverflowUiStateEntry>,
): Promise<void> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error('Impossible de charger le document source');
  const sourceBytes = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || '';

  const pdfDoc = await loadSourceDocument(sourceBytes, contentType);

  // Default to PDF page dimensions if canvas dims not provided
  const firstPage = pdfDoc.getPages()[0];
  const cW = canvasW || firstPage?.getWidth() || 595;
  const cH = canvasH || firstPage?.getHeight() || 842;

  await renderFieldsOnPages(
    pdfDoc, fields, rotation, pageCount, cW, cH, overflowUiState,
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
 *
 * @param canvasW Canvas width in pixels (field coordinate space)
 * @param canvasH Canvas height in pixels (field coordinate space)
 */
export async function generateFilledPdfBlob(
  sourceUrl: string,
  fields: FieldModel[],
  rotation: Rotation,
  pageCount = 1,
  canvasW?: number,
  canvasH?: number,
  overflowUiState?: Record<string, OverflowUiStateEntry>,
): Promise<Blob> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error('Impossible de charger le document source');
  const sourceBytes = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || '';

  const pdfDoc = await loadSourceDocument(sourceBytes, contentType);

  const firstPage = pdfDoc.getPages()[0];
  const cW = canvasW || firstPage?.getWidth() || 595;
  const cH = canvasH || firstPage?.getHeight() || 842;

  await renderFieldsOnPages(
    pdfDoc, fields, rotation, pageCount, cW, cH, overflowUiState,
  );

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
