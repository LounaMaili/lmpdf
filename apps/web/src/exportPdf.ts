import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import type { FieldModel } from './types';

type Rotation = 0 | 90 | 180 | 270;

type Box = { x: number; y: number; w: number; h: number };
type OverflowUiStateEntry = { anchorFieldId: string; usedFieldIds: string[]; globalText: string; version: number };

function parseContinuousKey(key: string): { page: number; groupId: string; anchorId: string } | null {
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
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function mapDisplayBoxToPdfBox(box: Box, pdfW: number, pdfH: number, pageRotation: Rotation): Box {
  if (pageRotation === 90) {
    return {
      x: box.y,
      y: pdfH - box.x - box.w,
      w: box.h,
      h: box.w,
    };
  }
  if (pageRotation === 180) {
    return {
      x: pdfW - box.x - box.w,
      y: pdfH - box.y - box.h,
      w: box.w,
      h: box.h,
    };
  }
  if (pageRotation === 270) {
    return {
      x: pdfW - box.y - box.h,
      y: box.x,
      w: box.h,
      h: box.w,
    };
  }
  return box;
}

function mapFieldToPdfBox(
  f: FieldModel,
  pdfW: number,
  pdfH: number,
  editorW: number,
  editorH: number,
  pageRotation: Rotation,
): Box {
  const rotatedDisplay = pageRotation === 90 || pageRotation === 270;
  const displayPdfW = rotatedDisplay ? pdfH : pdfW;
  const displayPdfH = rotatedDisplay ? pdfW : pdfH;
  const sx = editorW > 0 ? displayPdfW / editorW : 1;
  const sy = editorH > 0 ? displayPdfH / editorH : 1;

  const displayBox = {
    x: f.x * sx,
    y: f.y * sy,
    w: f.w * sx,
    h: f.h * sy,
  };

  return mapDisplayBoxToPdfBox(displayBox, pdfW, pdfH, pageRotation);
}

/**
 * Export a filled PDF: overlays field values on the original document.
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
) {
  // Fetch original PDF
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error('Impossible de charger le document source');
  const sourceBytes = await resp.arrayBuffer();

  let pdfDoc: PDFDocument;
  const contentType = resp.headers.get('content-type') || '';

  if (contentType.includes('pdf')) {
    pdfDoc = await PDFDocument.load(sourceBytes);
  } else {
    // Image source: create one page per requested copy
    pdfDoc = await PDFDocument.create();
    let image;
    if (contentType.includes('png')) {
      image = await pdfDoc.embedPng(sourceBytes);
    } else {
      image = await pdfDoc.embedJpg(sourceBytes);
    }
    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
  }

  let pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('PDF vide');

  // Ensure enough pages for repeated forms
  if (pages.length < pageCount) {
    const basePage = pages[0];
    const needed = pageCount - pages.length;
    const copied = await pdfDoc.copyPages(pdfDoc, Array.from({ length: needed }, () => 0));
    copied.forEach((p) => pdfDoc.addPage(p));
    pages = pdfDoc.getPages();
    if (!basePage) throw new Error('Page source introuvable');
  }

  const { width: pdfW, height: pdfH } = pages[0].getSize();
  const editorW = editorPageW || pdfW;
  const editorH = editorPageH || pdfH;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const continuousByPage = new Map<number, Array<{ key: string; state: OverflowUiStateEntry }>>();
  if (overflowUiState) {
    for (const [key, state] of Object.entries(overflowUiState)) {
      const parsed = parseContinuousKey(key);
      if (!parsed) continue;
      const list = continuousByPage.get(parsed.page) || [];
      list.push({ key, state });
      continuousByPage.set(parsed.page, list);
    }
  }

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    const page = pages[pageIndex - 1];

    // Keep exported orientation aligned with editor orientation.
    const existingPageRotation = normalizeRotation(page.getRotation().angle);
    // CSS editor rotation and PDF page rotation do not share the same sign convention.
    const targetPageRotation = normalizeRotation(existingPageRotation - rotation);
    if (rotation !== 0) {
      page.setRotation(degrees(targetPageRotation));
    }

    const pageFields = fields.filter((f) => (f.pageNumber ?? 1) === pageIndex);
    const pageFieldsById = new Map(pageFields.map((f) => [f.id, f] as const));
    const pageContinuous = continuousByPage.get(pageIndex) || [];
    const renderedContinuousAnchors = new Set<string>();

    for (const originalField of pageFields) {
      let f: FieldModel = originalField;
      let fieldValue = originalField.value ?? '';

      if (originalField.type === 'text' || originalField.type === 'date') {
        const continuousEntry = pageContinuous.find((entry) => (
          entry.state.anchorFieldId === originalField.id || entry.state.usedFieldIds.includes(originalField.id)
        ));

        if (continuousEntry) {
          const state = continuousEntry.state;
          if (state.anchorFieldId !== originalField.id) {
            // Covered by anchor export zone.
            continue;
          }
          if (renderedContinuousAnchors.has(state.anchorFieldId)) continue;
          renderedContinuousAnchors.add(state.anchorFieldId);

          const usedFields = state.usedFieldIds
            .map((fid) => pageFieldsById.get(fid))
            .filter(Boolean) as FieldModel[];
          if (usedFields.length > 0) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const uf of usedFields) {
              minX = Math.min(minX, uf.x);
              minY = Math.min(minY, uf.y);
              maxX = Math.max(maxX, uf.x + uf.w);
              maxY = Math.max(maxY, uf.y + uf.h);
            }
            f = { ...originalField, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          }
          fieldValue = state.globalText ?? fieldValue;
        }
      }

      if (!fieldValue && (f.type === 'text' || f.type === 'date')) continue;

      const box = mapFieldToPdfBox(f, pdfW, pdfH, editorW, editorH, existingPageRotation);
      const pdfX = box.x;
      const pdfY = pdfH - box.y - box.h;
      const fontSize = Math.min(f.style.fontSize, box.h - 2);
      const selectedFont = f.style.fontWeight === 'bold' ? fontBold : font;

      const colorHex = f.style.color || '#000000';
      const r = parseInt(colorHex.slice(1, 3), 16) / 255;
      const g = parseInt(colorHex.slice(3, 5), 16) / 255;
      const b = parseInt(colorHex.slice(5, 7), 16) / 255;

      // Keep export alignment close to editor textarea styles.
      const displayPdfW = existingPageRotation === 90 || existingPageRotation === 270 ? pdfH : pdfW;
      const displayPdfH = existingPageRotation === 90 || existingPageRotation === 270 ? pdfW : pdfH;
      const sx = editorW > 0 ? displayPdfW / editorW : 1;
      const sy = editorH > 0 ? displayPdfH / editorH : 1;
      const padX = Math.max(2, 6 * sx);
      const padTop = Math.max(1, 2 * sy);
      const baselineDown = Math.max(1, 2 * sy);

      if (f.type === 'checkbox') {
        if (fieldValue === 'true') {
          const sx = pdfX;
          const sy = pdfY;
          const w = box.w;
          const h = box.h;
          const p1 = { x: sx + w * 0.18, y: sy + h * 0.45 };
          const p2 = { x: sx + w * 0.40, y: sy + h * 0.20 };
          const p3 = { x: sx + w * 0.82, y: sy + h * 0.78 };
          const lineWidth = Math.max(1.4, Math.min(w, h) * 0.09);

          page.drawLine({ start: p1, end: p2, thickness: lineWidth, color: rgb(r, g, b) });
          page.drawLine({ start: p2, end: p3, thickness: lineWidth, color: rgb(r, g, b) });
        }
      } else if (f.type === 'counter-tally' || f.type === 'counter-numeric') {
        const val = fieldValue || '0';
        page.drawText(val, {
          x: pdfX + padX,
          y: pdfY + Math.max(2, box.h * 0.08),
          size: fontSize,
          font: selectedFont,
          color: rgb(r, g, b),
        });
      } else {
        const raw = fieldValue ?? '';
        const maxWidth = Math.max(8, box.w - padX * 2);
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
            if (selectedFont.widthOfTextAtSize(next, fontSize) <= maxWidth) {
              current = next;
            } else {
              if (current) wrapped.push(current);
              current = w;
            }
          }
          wrapped.push(current);
        }

        const lineHeight = Math.max(fontSize * 1.2, 10);
        const maxLines = Math.max(1, Math.floor((box.h - padTop * 2) / lineHeight));
        const visible = wrapped.slice(0, maxLines);

        visible.forEach((line, idx) => {
          page.drawText(line, {
            x: pdfX + padX,
            y: pdfY + box.h - padTop - lineHeight * (idx + 1) - baselineDown,
            size: fontSize,
            font: selectedFont,
            color: rgb(r, g, b),
            maxWidth,
          });
        });
      }
    }

    // Always add page numbering for multipage exports
    if (pageCount > 1) {
      page.drawText(`Page ${pageIndex}/${pageCount}`, {
        x: pdfW - 100,
        y: 12,
        size: 10,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
  }

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
 * Reuses the same rendering logic as exportFilledPdf.
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
  // Fetch original PDF
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error('Impossible de charger le document source');
  const sourceBytes = await resp.arrayBuffer();

  let pdfDoc: PDFDocument;
  const contentType = resp.headers.get('content-type') || '';

  if (contentType.includes('pdf')) {
    pdfDoc = await PDFDocument.load(sourceBytes);
  } else {
    pdfDoc = await PDFDocument.create();
    let image;
    if (contentType.includes('png')) {
      image = await pdfDoc.embedPng(sourceBytes);
    } else {
      image = await pdfDoc.embedJpg(sourceBytes);
    }
    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
  }

  let pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('PDF vide');

  if (pages.length < pageCount) {
    const needed = pageCount - pages.length;
    const copied = await pdfDoc.copyPages(pdfDoc, Array.from({ length: needed }, () => 0));
    copied.forEach((p) => pdfDoc.addPage(p));
    pages = pdfDoc.getPages();
  }

  const { width: pdfW, height: pdfH } = pages[0].getSize();
  const editorW = editorPageW || pdfW;
  const editorH = editorPageH || pdfH;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const continuousByPage = new Map<number, Array<{ key: string; state: OverflowUiStateEntry }>>();
  if (overflowUiState) {
    for (const [key, state] of Object.entries(overflowUiState)) {
      const parsed = parseContinuousKey(key);
      if (!parsed) continue;
      const list = continuousByPage.get(parsed.page) || [];
      list.push({ key, state });
      continuousByPage.set(parsed.page, list);
    }
  }

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    const page = pages[pageIndex - 1];

    const existingPageRotation = normalizeRotation(page.getRotation().angle);
    const targetPageRotation = normalizeRotation(existingPageRotation - rotation);
    if (rotation !== 0) {
      page.setRotation(degrees(targetPageRotation));
    }

    const pageFields = fields.filter((f) => (f.pageNumber ?? 1) === pageIndex);
    const pageFieldsById = new Map(pageFields.map((f) => [f.id, f] as const));
    const pageContinuous = continuousByPage.get(pageIndex) || [];
    const renderedContinuousAnchors = new Set<string>();

    for (const originalField of pageFields) {
      let f: FieldModel = originalField;
      let fieldValue = originalField.value ?? '';

      if (originalField.type === 'text' || originalField.type === 'date') {
        const continuousEntry = pageContinuous.find((entry) => (
          entry.state.anchorFieldId === originalField.id || entry.state.usedFieldIds.includes(originalField.id)
        ));

        if (continuousEntry) {
          const state = continuousEntry.state;
          if (state.anchorFieldId !== originalField.id) continue;
          if (renderedContinuousAnchors.has(state.anchorFieldId)) continue;
          renderedContinuousAnchors.add(state.anchorFieldId);

          const usedFields = state.usedFieldIds
            .map((fid) => pageFieldsById.get(fid))
            .filter(Boolean) as FieldModel[];
          if (usedFields.length > 0) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const uf of usedFields) {
              minX = Math.min(minX, uf.x);
              minY = Math.min(minY, uf.y);
              maxX = Math.max(maxX, uf.x + uf.w);
              maxY = Math.max(maxY, uf.y + uf.h);
            }
            f = { ...originalField, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          }
          fieldValue = state.globalText ?? fieldValue;
        }
      }

      if (!fieldValue && (f.type === 'text' || f.type === 'date')) continue;

      const box = mapFieldToPdfBox(f, pdfW, pdfH, editorW, editorH, existingPageRotation);
      const pdfX = box.x;
      const pdfY = pdfH - box.y - box.h;
      const fontSize = Math.min(f.style.fontSize, box.h - 2);
      const selectedFont = f.style.fontWeight === 'bold' ? fontBold : font;

      const colorHex = f.style.color || '#000000';
      const r = parseInt(colorHex.slice(1, 3), 16) / 255;
      const g = parseInt(colorHex.slice(3, 5), 16) / 255;
      const b = parseInt(colorHex.slice(5, 7), 16) / 255;

      const displayPdfW = existingPageRotation === 90 || existingPageRotation === 270 ? pdfH : pdfW;
      const displayPdfH = existingPageRotation === 90 || existingPageRotation === 270 ? pdfW : pdfH;
      const sx = editorW > 0 ? displayPdfW / editorW : 1;
      const sy = editorH > 0 ? displayPdfH / editorH : 1;
      const padX = Math.max(2, 6 * sx);
      const padTop = Math.max(1, 2 * sy);
      const baselineDown = Math.max(1, 2 * sy);

      if (f.type === 'checkbox') {
        if (fieldValue === 'true') {
          const sx = pdfX;
          const sy = pdfY;
          const w = box.w;
          const h = box.h;
          const p1 = { x: sx + w * 0.18, y: sy + h * 0.45 };
          const p2 = { x: sx + w * 0.40, y: sy + h * 0.20 };
          const p3 = { x: sx + w * 0.82, y: sy + h * 0.78 };
          const lineWidth = Math.max(1.4, Math.min(w, h) * 0.09);

          page.drawLine({ start: p1, end: p2, thickness: lineWidth, color: rgb(r, g, b) });
          page.drawLine({ start: p2, end: p3, thickness: lineWidth, color: rgb(r, g, b) });
        }
      } else if (f.type === 'counter-tally' || f.type === 'counter-numeric') {
        const val = fieldValue || '0';
        page.drawText(val, {
          x: pdfX + padX,
          y: pdfY + Math.max(2, box.h * 0.08),
          size: fontSize,
          font: selectedFont,
          color: rgb(r, g, b),
        });
      } else {
        const raw = fieldValue ?? '';
        const maxWidth = Math.max(8, box.w - padX * 2);
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
            if (selectedFont.widthOfTextAtSize(next, fontSize) <= maxWidth) {
              current = next;
            } else {
              if (current) wrapped.push(current);
              current = w;
            }
          }
          wrapped.push(current);
        }

        const lineHeight = Math.max(fontSize * 1.2, 10);
        const maxLines = Math.max(1, Math.floor((box.h - padTop * 2) / lineHeight));
        const visible = wrapped.slice(0, maxLines);

        visible.forEach((line, idx) => {
          page.drawText(line, {
            x: pdfX + padX,
            y: pdfY + box.h - padTop - lineHeight * (idx + 1) - baselineDown,
            size: fontSize,
            font: selectedFont,
            color: rgb(r, g, b),
            maxWidth,
          });
        });
      }
    }

    if (pageCount > 1) {
      page.drawText(`Page ${pageIndex}/${pageCount}`, {
        x: pdfW - 100,
        y: 12,
        size: 10,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
