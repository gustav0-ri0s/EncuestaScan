export interface PreparedScanImages {
  originalDataUrl: string;
  enhancedDataUrl: string;
  thumbnailDataUrl: string;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    img.src = src;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Error al leer el archivo de imagen.'));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo abrir el archivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Normaliza la iluminación local usando una tabla de área sumada (integral image)
 * para eliminar sombras y realzar trazos de lápiz o lapicero muy tenues en
 * escaneos de baja calidad.
 */
function applyLocalContrastEnhancement(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const totalPixels = width * height;

  const lum = new Uint8Array(totalPixels);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Luminancia perceptual
    lum[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // Integral image con Float64Array para evitar desbordamiento
  const integral = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;

  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    const lumOffset = (y - 1) * width;
    const intOffset = y * stride;
    const prevIntOffset = (y - 1) * stride;
    for (let x = 1; x <= width; x++) {
      rowSum += lum[lumOffset + x - 1];
      integral[intOffset + x] = integral[prevIntOffset + x] + rowSum;
    }
  }

  // Ventana adaptativa proporcional al ancho de la hoja (~3.5% del ancho)
  const radius = Math.max(18, Math.round(Math.min(width, height) * 0.035));

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);

      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];

      const localMean = sum / area;
      const pixelVal = lum[y * width + x];

      // Reflectancia normalizada respecto al fondo local de papel
      const ratio = pixelVal / Math.max(localMean, 28);

      // Curva de realce agresiva para marcas tenues:
      // - Todo lo >= 0.96 del fondo local se limpia hacia blanco puro (255)
      // - Todo lo <= 0.62 se oscurece hacia negro intenso (0)
      // Así las X suaves en lápiz o mala calidad se vuelven nítidas sin perder líneas de tabla
      let enhanced: number;
      if (ratio >= 0.96) {
        enhanced = 255;
      } else if (ratio <= 0.60) {
        enhanced = 0;
      } else {
        const normalized = (ratio - 0.60) / (0.96 - 0.60);
        // Gamma suave para dar peso a trazos débiles
        enhanced = Math.round(Math.pow(normalized, 1.35) * 255);
      }

      const idx = (y * width + x) * 4;
      data[idx] = enhanced;
      data[idx + 1] = enhanced;
      data[idx + 2] = enhanced;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export async function prepareImageForScan(sourceDataUrl: string): Promise<PreparedScanImages> {
  const img = await loadImage(sourceDataUrl);

  const maxDim = 1800;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = width;
  originalCanvas.height = height;
  const origCtx = originalCanvas.getContext('2d');
  if (!origCtx) {
    throw new Error('No se pudo inicializar el lienzo de procesamiento.');
  }
  origCtx.drawImage(img, 0, 0, width, height);
  const originalDataUrl = originalCanvas.toDataURL('image/jpeg', 0.9);

  // Versión realzada para detectar marcas X muy claras o escaneos de mala calidad
  const enhancedCanvas = document.createElement('canvas');
  enhancedCanvas.width = width;
  enhancedCanvas.height = height;
  const enhCtx = enhancedCanvas.getContext('2d');
  if (!enhCtx) {
    throw new Error('No se pudo inicializar el filtro de realce.');
  }
  enhCtx.drawImage(originalCanvas, 0, 0);
  applyLocalContrastEnhancement(enhCtx, width, height);
  const enhancedDataUrl = enhancedCanvas.toDataURL('image/jpeg', 0.92);

  // Miniatura compacta para historial en localStorage
  const thumbMax = 360;
  const thumbScale = Math.min(1, thumbMax / Math.max(width, height));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = Math.max(1, Math.round(width * thumbScale));
  thumbCanvas.height = Math.max(1, Math.round(height * thumbScale));
  const thumbCtx = thumbCanvas.getContext('2d');
  if (thumbCtx) {
    thumbCtx.drawImage(originalCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  }
  const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.65);

  return {
    originalDataUrl,
    enhancedDataUrl,
    thumbnailDataUrl,
    width,
    height,
  };
}
