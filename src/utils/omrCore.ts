/**
 * Lectura óptica de marcas (OMR) local, sin IA y sin conexión.
 *
 * Trabaja sobre una imagen en escala de grises y usa la geometría fija de la
 * plantilla del cuestionario (16 ítems × 5 columnas). La banda azul oscura del
 * encabezado de la tabla ("Dimensión | Indicador | N° | Ítems | 1..5") sirve de
 * ancla: a partir de su posición y ancho se ubica cada casilla de respuesta.
 *
 * Es una función pura (no usa el DOM) para poder probarla fuera del navegador.
 */
import type { ConfidenceLevel, RatingValue, ScannedItemResult } from '../data/questionnaire';

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CellBox {
  itemNumber: number;
  value: RatingValue;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fill: number;
}

export interface OmrResult {
  ok: boolean;
  reason?: string;
  items: ScannedItemResult[];
  /** Ángulo de corrección aplicado (grados) */
  angle: number;
  /** Casillas medidas, en coordenadas de la imagen enderezada (útil para depurar) */
  cells: CellBox[];
}

// Geometría de la plantilla en puntos PDF (página A4 de 595.3 × 841.9)
const TEMPLATE = {
  bandLeft: 34.0,
  bandRight: 561.9,
  bandTop: 267.7,
  bandBottom: 283.6,
  firstRowLine: 283.1,
  rowPitch: 25.3,
  firstColLine: 441.65,
  colPitch: 24.0,
  rows: 16,
  cols: 5,
};
const BAND_WIDTH = TEMPLATE.bandRight - TEMPLATE.bandLeft;
const BAND_THICKNESS_RATIO = (TEMPLATE.bandBottom - TEMPLATE.bandTop) / BAND_WIDTH;

// Umbrales de decisión sobre la fracción de tinta de cada casilla
const EMPTY_FILL = 0.025;
const STRONG_FILL = 0.05;

export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < data.length; i += 4, p++) {
    data[p] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0;
  }
  return { width, height, data };
}

function downscale(img: GrayImage, factor: number): GrayImage {
  const width = Math.max(1, Math.floor(img.width / factor));
  const height = Math.max(1, Math.floor(img.height / factor));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y * factor));
    for (let x = 0; x < width; x++) {
      data[y * width + x] = img.data[sy * img.width + Math.min(img.width - 1, Math.floor(x * factor))];
    }
  }
  return { width, height, data };
}

/** Estima la inclinación maximizando la nitidez de la proyección horizontal de píxeles oscuros */
function estimateSkew(img: GrayImage): number {
  const small = downscale(img, Math.max(1, img.width / 700));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      if (small.data[y * small.width + x] < 110) {
        xs.push(x - small.width / 2);
        ys.push(y);
      }
    }
  }
  if (xs.length < 50) return 0;

  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    const sin = Math.sin(t);
    const cos = Math.cos(t);
    const bins = new Float64Array(small.height * 2 + 4);
    for (let i = 0; i < xs.length; i++) {
      const b = Math.round(ys[i] * cos - xs[i] * sin) + small.height / 2;
      if (b >= 0 && b < bins.length) bins[b | 0]++;
    }
    let s = 0;
    for (let i = 0; i < bins.length; i++) s += bins[i] * bins[i];
    return s;
  };

  let best = 0;
  let bestScore = -1;
  for (let deg = -5; deg <= 5.0001; deg += 0.25) {
    const s = score(deg);
    if (s > bestScore) {
      bestScore = s;
      best = deg;
    }
  }
  for (let deg = best - 0.2; deg <= best + 0.2001; deg += 0.05) {
    const s = score(deg);
    if (s > bestScore) {
      bestScore = s;
      best = deg;
    }
  }
  return best;
}

/** Rota la imagen alrededor de su centro (relleno blanco, vecino más cercano) */
function rotate(img: GrayImage, deg: number): GrayImage {
  if (Math.abs(deg) < 0.01) return img;
  const { width, height } = img;
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const cx = width / 2;
  const cy = height / 2;
  const data = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      // Mapeo inverso: el píxel de destino toma el valor del origen rotado
      const sx = Math.round(cx + dx * cos - dy * sin);
      const sy = Math.round(cy + dx * sin + dy * cos);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        data[y * width + x] = img.data[sy * width + sx];
      }
    }
  }
  return { width, height, data };
}

interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Ubica la banda oscura del encabezado de la tabla de ítems */
function findHeaderBand(img: GrayImage): Band | null {
  const { width, height, data } = img;
  const DARK = 125;
  const rowCounts = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let c = 0;
    const off = y * width;
    for (let x = 0; x < width; x++) if (data[off + x] < DARK) c++;
    rowCounts[y] = c;
  }

  // Tramos de filas con mucha tinta (bandas sólidas que cruzan casi toda la hoja)
  const runs: Array<{ top: number; bottom: number }> = [];
  const minCount = width * 0.4;
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const dense = y < height && rowCounts[y] > minCount;
    if (dense && start < 0) start = y;
    if (!dense && start >= 0) {
      runs.push({ top: start, bottom: y - 1 });
      start = -1;
    }
  }

  // La banda de la tabla es la más baja de las bandas de la mitad superior de la hoja
  const candidates: Band[] = [];
  for (const run of runs) {
    if (run.top > height * 0.6) continue;
    const thickness = run.bottom - run.top + 1;

    // Extensión horizontal: columnas mayormente oscuras dentro de la banda, tolerando huecos del texto blanco
    const colDark = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      let c = 0;
      for (let y = run.top; y <= run.bottom; y++) if (data[y * width + x] < DARK) c++;
      colDark[x] = c >= thickness * 0.5 ? 1 : 0;
    }
    const maxGap = Math.round(width * 0.03);
    let bestLeft = -1;
    let bestRight = -1;
    let segLeft = -1;
    let lastDark = -1;
    for (let x = 0; x < width; x++) {
      if (!colDark[x]) continue;
      if (segLeft < 0 || x - lastDark > maxGap) segLeft = x;
      lastDark = x;
      if (lastDark - segLeft > bestRight - bestLeft) {
        bestLeft = segLeft;
        bestRight = lastDark;
      }
    }
    const bandWidth = bestRight - bestLeft;
    if (bandWidth < width * 0.5) continue;
    const ratio = thickness / bandWidth;
    if (ratio < BAND_THICKNESS_RATIO * 0.5 || ratio > BAND_THICKNESS_RATIO * 2) continue;
    candidates.push({ left: bestLeft, right: bestRight, top: run.top, bottom: run.bottom });
  }

  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/** Nivel de blanco del papel en una región (percentil 90) */
function paperLevel(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 2) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x += 2) {
      hist[img.data[y * img.width + x]]++;
      n++;
    }
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.9) return Math.max(v, 120);
  }
  return 255;
}

/**
 * Ajusta finamente el desplazamiento de la cuadrícula buscando las líneas
 * grises de la tabla cerca de su posición esperada.
 */
function refineOffset(
  img: GrayImage,
  linesAt: (shift: number) => number[],
  along: 'rows' | 'cols',
  spanFrom: number,
  spanTo: number,
  maxShift: number,
  lineThreshold: number
): number {
  const { width, height, data } = img;
  const profileLen = along === 'rows' ? height : width;
  const profile = new Float64Array(profileLen);
  const a = Math.max(0, Math.round(spanFrom));
  const b = Math.min(along === 'rows' ? width : height, Math.round(spanTo));
  for (let p = 0; p < profileLen; p++) {
    let c = 0;
    for (let q = a; q < b; q++) {
      const v = along === 'rows' ? data[p * width + q] : data[q * width + p];
      if (v < lineThreshold) c++;
    }
    profile[p] = c;
  }

  // Respuesta de "línea delgada": oscuro aquí pero claro a ambos lados. Así no
  // cuentan la banda del encabezado, el texto ni las marcas, que son anchos.
  // Solo se considera línea si cruza al menos la mitad del tramo (el texto y las marcas no lo hacen)
  const ridge = new Float64Array(profileLen);
  const k = 3;
  const minCoverage = (b - a) * 0.5;
  for (let p = k; p < profileLen - k; p++) {
    if (profile[p] < minCoverage) continue;
    ridge[p] = Math.max(0, profile[p] - Math.max(profile[p - k], profile[p + k]));
  }

  let bestShift = 0;
  let bestScore = 0;
  // Se recorre desde 0 hacia afuera para preferir la posición de la plantilla en caso de empate
  for (let step = 0; step <= maxShift * 2; step++) {
    const s = step % 2 === 0 ? step / 2 : -(step + 1) / 2;
    let score = 0;
    for (const pos of linesAt(s)) {
      const i = Math.round(pos);
      // Una línea puede ocupar 1-3 píxeles según la resolución
      for (let d = -1; d <= 1; d++) if (i + d >= 0 && i + d < profileLen) score += ridge[i + d];
    }
    if (score > bestScore) {
      bestScore = score;
      bestShift = s;
    }
  }
  return bestShift;
}

interface DarknessStats {
  median: number;
  mad: number;
}

function decideRow(
  itemNumber: number,
  fills: number[],
  darkness: number[],
  stats: DarknessStats
): ScannedItemResult {
  const order = fills.map((f, i) => ({ f, i })).sort((a, b) => b.f - a.f);
  const top = order[0];
  const second = order[1];

  if (top.f < EMPTY_FILL) {
    // Segunda oportunidad para trazos muy tenues: oscuridad media frente a las casillas vacías de la hoja
    const excess = darkness
      .map((d, i) => ({ e: d - stats.median, i }))
      .sort((a, b) => b.e - a.e);
    const minExcess = Math.max(stats.mad * 6, 0.012);
    if (excess[0].e > minExcess && excess[0].e >= Math.max(excess[1].e, 0) * 2) {
      return {
        itemNumber,
        selectedValue: (excess[0].i + 1) as RatingValue,
        confidence: 'baja',
        observation: 'Marca muy tenue: confirmar',
      };
    }
    return {
      itemNumber,
      selectedValue: null,
      confidence: 'baja',
      observation: 'Sin marca detectada en la lectura local',
    };
  }

  const selectedValue = (top.i + 1) as RatingValue;
  let confidence: ConfidenceLevel;
  let observation = '';

  if (second.f >= EMPTY_FILL * 1.6 && second.f >= top.f * 0.6) {
    confidence = 'baja';
    observation = `Posible doble marca (columnas ${top.i + 1} y ${second.i + 1})`;
  } else if (
    (top.f >= STRONG_FILL && top.f >= second.f * 2.5) ||
    // Trazo fino pero único en la fila
    (top.f >= STRONG_FILL * 0.6 && second.f <= top.f * 0.15)
  ) {
    confidence = 'alta';
  } else {
    confidence = 'media';
    observation = top.f < STRONG_FILL ? 'Marca tenue' : `Marca dudosa frente a la columna ${second.i + 1}`;
  }

  return { itemNumber, selectedValue, confidence, observation };
}

export function readAnswerGrid(input: GrayImage): OmrResult {
  const angle = estimateSkew(input);
  const img = rotate(input, angle);

  const band = findHeaderBand(img);
  if (!band) {
    return {
      ok: false,
      reason: 'No se encontró el encabezado de la tabla de ítems.',
      items: [],
      angle,
      cells: [],
    };
  }

  const scale = (band.right - band.left) / BAND_WIDTH;
  const toX = (pt: number) => band.left + (pt - TEMPLATE.bandLeft) * scale;
  const toY = (pt: number) => band.top + (pt - TEMPLATE.bandTop) * scale;

  const gridLeft = toX(TEMPLATE.firstColLine);
  const gridRight = toX(TEMPLATE.firstColLine + TEMPLATE.colPitch * TEMPLATE.cols);
  const gridTop = toY(TEMPLATE.firstRowLine);
  const gridBottom = toY(TEMPLATE.firstRowLine + TEMPLATE.rowPitch * TEMPLATE.rows);

  if (gridBottom >= img.height || gridRight >= img.width + 2) {
    return {
      ok: false,
      reason: 'La tabla de respuestas queda fuera de la imagen.',
      items: [],
      angle,
      cells: [],
    };
  }

  const paper = paperLevel(img, gridLeft, gridTop, gridRight, gridBottom);
  const lineThreshold = paper - 25;
  const maxShift = Math.max(2, Math.round(TEMPLATE.colPitch * scale * 0.2));

  const rowLines = (shift: number) =>
    Array.from({ length: TEMPLATE.rows + 1 }, (_, i) => toY(TEMPLATE.firstRowLine + TEMPLATE.rowPitch * i) + shift);
  const colLines = (shift: number) =>
    Array.from({ length: TEMPLATE.cols + 1 }, (_, i) => toX(TEMPLATE.firstColLine + TEMPLATE.colPitch * i) + shift);

  const dy = refineOffset(img, rowLines, 'rows', gridLeft, gridRight, maxShift, lineThreshold);
  const dx = refineOffset(img, colLines, 'cols', gridTop, gridBottom, maxShift, lineThreshold);

  const inkThreshold = paper * 0.72;
  const rowsY = rowLines(dy);
  const colsX = colLines(dx);
  const cells: CellBox[] = [];
  const rowFills: number[][] = [];
  const rowDarkness: number[][] = [];

  for (let r = 0; r < TEMPLATE.rows; r++) {
    const fills: number[] = [];
    const darks: number[] = [];
    for (let c = 0; c < TEMPLATE.cols; c++) {
      const cw = colsX[c + 1] - colsX[c];
      const ch = rowsY[r + 1] - rowsY[r];
      // Se descarta un margen interior para no contar los bordes de la casilla
      const x0 = Math.round(colsX[c] + cw * 0.16);
      const x1 = Math.round(colsX[c + 1] - cw * 0.16);
      const y0 = Math.round(rowsY[r] + ch * 0.16);
      const y1 = Math.round(rowsY[r + 1] - ch * 0.16);

      let ink = 0;
      let dark = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = img.data[y * img.width + x];
          total++;
          if (v < inkThreshold) ink++;
          if (v < paper) dark += paper - v;
        }
      }
      const fill = total > 0 ? ink / total : 0;
      fills.push(fill);
      darks.push(total > 0 ? dark / total / paper : 0);
      cells.push({ itemNumber: r + 1, value: (c + 1) as RatingValue, x0, y0, x1, y1, fill });
    }
    rowFills.push(fills);
    rowDarkness.push(darks);
  }

  // La mayoría de las casillas están vacías: su mediana es el nivel de fondo de esta hoja
  const allDark = rowDarkness.flat().sort((a, b) => a - b);
  const median = allDark[Math.floor(allDark.length / 2)];
  const deviations = allDark.map((d) => Math.abs(d - median)).sort((a, b) => a - b);
  const stats: DarknessStats = { median, mad: deviations[Math.floor(deviations.length / 2)] };

  const items = rowFills.map((fills, r) => decideRow(r + 1, fills, rowDarkness[r], stats));

  return { ok: true, items, angle, cells };
}
