import { useState, useCallback, useMemo, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { useTranslation } from '../i18n';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

type Props = {
  url: string;
  /** Largeur demandée pour le rendu de la page PDF. */
  renderWidth?: number;
  onDimensionsDetected?: (displayW: number, displayH: number, origW: number, origH: number) => void;
  onPageChange?: (page: number, total: number) => void;
  showPagination?: boolean;
};

export default function PdfViewer({ url, renderWidth: renderWidthProp, onDimensionsDetected, onPageChange, showPagination = true }: Props) {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  // renderWidth interne : utilise la prop si fournie, sinon la valeur par défaut (794).
  const [renderWidth, setRenderWidth] = useState<number>(renderWidthProp ?? 794);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);

  const dpr = useMemo(() => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1), []);

  // Reset complet quand l'URL change
  useEffect(() => {
    setNumPages(0);
    setCurrentPage(1);
    setRenderWidth(renderWidthProp ?? 794);
    setLoadError(null);
    setPdfBuffer(null);

    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        if (!ab.byteLength) throw new Error(t('pdf.emptyFile'));
        setPdfBuffer(ab);
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(t('pdf.cannotRead', { message: msg }));
      }
    })();

    return () => ac.abort();
  }, [url, t, renderWidthProp]);

  // Quand la prop renderWidth change, mettre à jour l'état interne
  useEffect(() => {
    if (renderWidthProp != null) {
      setRenderWidth(renderWidthProp);
    }
  }, [renderWidthProp]);

  // pdf.js may detach buffers in the worker; clone once per render to avoid intermittent blank pages.
  const fileSource = useMemo(() => {
    if (!pdfBuffer) return null;
    return { data: new Uint8Array(pdfBuffer.slice(0)) };
  }, [pdfBuffer]);

  const handlePageLoadSuccess = useCallback(
    (page: { width: number; height: number; originalWidth: number; originalHeight: number }) => {
      // page.width / page.height = dimensions after scaling par pdf.js
      // Ces dimensions correspondent à ce qui est effectivement affiché dans le canvas.
      const viewW = page.width;
      const viewH = page.height;
      const origW = page.originalWidth;
      const origH = page.originalHeight;

      // Appeler onDimensionsDetected seulement avec les dimensions originales.
      // Ne PAS mettre à jour renderWidth interne ici pour éviter une boucle de re-render.
      onDimensionsDetected?.(viewW, viewH, origW, origH);
    },
    [onDimensionsDetected],
  );

  const changePage = (newPage: number) => {
    setCurrentPage(newPage);
    onPageChange?.(newPage, numPages);
  };

  const friendlyError = loadError
    ? `${loadError}\n\n${t('pdf.rotationHint')}`
    : null;

  return (
    <div className="pdf-viewer" style={{ width: renderWidth, height: '100%' }}>
      {!fileSource ? (
        loadError ? (
          <div className="pdf-error">
            {t('pdf.loadError')}
            {friendlyError && <p style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap' }}>{friendlyError}</p>}
          </div>
        ) : (
          <div className="pdf-loading">{t('pdf.loading')}</div>
        )
      ) : (
        <Document
          key={url}
          file={fileSource as any}
          onLoadSuccess={(pdf) => {
            setNumPages(pdf.numPages);
            setLoadError(null);
            onPageChange?.(1, pdf.numPages);
          }}
          onLoadError={(err) => {
            console.error('PDF load error:', err);
            setLoadError(String(err?.message || err));
          }}
          loading={<div className="pdf-loading">{t('pdf.loading')}</div>}
          error={
            <div className="pdf-error">
              {t('pdf.loadError')}
              {friendlyError && <p style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap' }}>{friendlyError}</p>}
            </div>
          }
        >
          <Page
            key={`page-${currentPage}-${renderWidth}`}
            pageNumber={currentPage}
            width={renderWidth * dpr}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onLoadSuccess={handlePageLoadSuccess}
            className="pdf-page-hires"
          />
        </Document>
      )}
      {showPagination && numPages > 1 && (
        <div className="pdf-pagination">
          <button disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}>
            {t('pdf.previous')}
          </button>
          <span>
            {t('pdf.pageOf', { current: currentPage, total: numPages })}
          </span>
          <button disabled={currentPage >= numPages} onClick={() => changePage(currentPage + 1)}>
            {t('pdf.next')}
          </button>
        </div>
      )}
    </div>
  );
}
