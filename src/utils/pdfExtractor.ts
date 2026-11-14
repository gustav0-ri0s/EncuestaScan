import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface LoadedPdf {
  numPages: number;
  renderPage: (pageNumber: number) => Promise<string>;
  destroy: () => Promise<void>;
}

export async function loadPdfForScanning(file: File): Promise<LoadedPdf> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
  });
  const pdfDoc = await loadingTask.promise;

  const renderPage = async (pageNumber: number): Promise<string> => {
    const page = await pdfDoc.getPage(pageNumber);
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const maxSide = Math.max(baseViewport.width, baseViewport.height);
      // Apuntar a ~1900px en el lado mayor para conservar trazos finos en escaneos de baja calidad
      const targetMaxPx = 1900;
      const scale = Math.min(3.0, Math.max(1.5, targetMaxPx / Math.max(1, maxSide)));

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error(`No se pudo crear el lienzo para la página ${pageNumber}.`);
      }

      // Fondo blanco sólido por si el PDF tiene transparencia
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      return canvas.toDataURL('image/jpeg', 0.92);
    } finally {
      page.cleanup();
    }
  };

  return {
    numPages: pdfDoc.numPages,
    renderPage,
    destroy: () => loadingTask.destroy(),
  };
}
