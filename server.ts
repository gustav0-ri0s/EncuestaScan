import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import ExcelJS from 'exceljs';
import {
  DIMENSIONS,
  INDICATORS,
  INSTRUMENT_META,
  QUESTIONNAIRE_ITEMS,
  SCALE_OPTIONS,
  computeConsolidatedCounts,
  computeSheetScore,
  type QuestionnaireSheet,
  type RatingValue,
} from './src/data/questionnaire.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Formato de imagen inválido.');
  }
  return { mimeType: match[1], base64: match[2] };
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

interface QuotaErrorInfo {
  retryAfterSeconds: number | null;
  daily: boolean;
}

// Detecta errores 429 (cuota / límite de velocidad) de la API de Gemini
function getQuotaErrorInfo(error: unknown): QuotaErrorInfo | null {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (status !== 429 && !/RESOURCE_EXHAUSTED|"code":\s*429/.test(message)) return null;

  const delayMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return {
    retryAfterSeconds: delayMatch ? Math.ceil(Number(delayMatch[1])) : null,
    daily: /PerDay/i.test(message),
  };
}

async function generateWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const quota = getQuotaErrorInfo(error);
      // La cuota diaria no se recupera esperando unos segundos
      if (quota?.daily) break;
      if (attempt < retries) {
        const waitMs = quota
          ? Math.min(60, quota.retryAfterSeconds ?? 10 * (attempt + 1)) * 1000
          : 800 * (attempt + 1);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastError;
}

const SCAN_SYSTEM_INSTRUCTION = `Eres un sistema especialista en lectura óptica de marcas (OMR) y análisis documental de encuestas educativas escaneadas en papel o fotografiadas con celular.

Analizarás imágenes del "CUESTIONARIO DE AUTOESTIMA ACADÉMICA (Instrumento N° 1 – Variable 1: Autoestima Académica)" de la EESPP "Tarapoto".
A menudo recibirás DOS imágenes de la MISMA hoja:
1) La foto o escaneo original.
2) Una versión con realce de contraste local adaptativo en blanco y negro, diseñada para hacer visibles marcas a lápiz muy claras, trazos finos o copias escaneadas en mala calidad.

Estructura exacta de la tabla en la hoja:
- Encabezado de tabla: Dimensión | Indicador | N° | Ítems | 1 | 2 | 3 | 4 | 5
- Las 5 columnas de respuesta a la derecha corresponden siempre, de izquierda a derecha, a los valores:
  Columna 1 = 1 (Nunca)
  Columna 2 = 2 (Casi nunca)
  Columna 3 = 3 (A veces)
  Columna 4 = 4 (Casi siempre)
  Columna 5 = 5 (Siempre)
- Hay exactamente 16 filas de ítems numeradas del 1 al 16:
  1-6: Dimensión "Autoconcepto académico"
  7-10: Dimensión "Valoración del esfuerzo y logro"
  11-16: Dimensión "Actores educativos"

Reglas críticas para detectar la marca (X):
1. Examina cuidadosamente cada fila del 1 al 16, siguiendo las líneas horizontales y verticales de la cuadrícula de derecha (columnas 1, 2, 3, 4, 5) para no desplazar una fila ni confundir columnas vecinas.
2. Busca cualquier marca escrita a mano dentro de las casillas 1 a 5: una "X", una equis tenue o pequeña, un aspa, un check (✓), un sombreado, un círculo o una marca que sobresalga levemente del borde de la celda.
3. Si la imagen está borrosa, torcida, con sombras o escaneada en baja calidad, usa la segunda imagen (realzada) para confirmar trazos suaves a lápiz o lapicero claro.
4. Si en una fila hay una marca tachada/borrada y otra marca clara, elige la marca activa y reporta confidence="media" con una observación breve.
5. Si definitivamente no hay ninguna marca visible en una fila, devuelve selectedValue=null y confidence="baja".
6. Si la marca es tenue o dudosa pero ubicable en una columna específica, devuelve ese valor (1-5) y marca confidence="media" o "baja" con una breve observación en español (ej. "Trazo muy tenue en columna 4").
7. Extrae también los datos manuscritos de la cabecera "DATOS DEL ESTUDIANTE": Apellidos y nombres, Grado y sección, y Fecha (si están en blanco, devuelve cadena vacía "").`;

const app = express();
app.use(express.json({ limit: '30mb' }));

app.post('/api/scan-sheet', async (req, res) => {
  try {
    const { originalImage, enhancedImage } = req.body as {
      originalImage?: string;
      enhancedImage?: string;
    };

    if (!originalImage) {
      res.status(400).json({ error: 'No se recibió ninguna imagen para analizar.' });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error:
          'No se encontró la clave de API de Gemini configurada en el entorno del servidor.',
      });
      return;
    }

    const origPart = parseDataUrl(originalImage);
    const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
      {
        inlineData: {
          mimeType: origPart.mimeType,
          data: origPart.base64,
        },
      },
    ];

    if (enhancedImage) {
      const enhPart = parseDataUrl(enhancedImage);
      parts.push({
        inlineData: {
          mimeType: enhPart.mimeType,
          data: enhPart.base64,
        },
      });
    }

    parts.push({
      text:
        'Identifica los datos del estudiante y la columna marcada (1, 2, 3, 4 o 5) para cada uno de los 16 ítems del cuestionario. Devuelve exactamente los 16 elementos ordenados del itemNumber 1 al 16.',
    });

    const response = await generateWithRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts },
        config: {
          systemInstruction: SCAN_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              apellidosNombres: {
                type: Type.STRING,
                description: 'Texto manuscrito en "Apellidos y nombres" o cadena vacía si está vacío.',
              },
              gradoSeccion: {
                type: Type.STRING,
                description: 'Texto manuscrito en "Grado y sección" o cadena vacía si está vacío.',
              },
              fecha: {
                type: Type.STRING,
                description: 'Texto manuscrito en "Fecha" o cadena vacía si está vacío.',
              },
              qualityNote: {
                type: Type.STRING,
                description: 'Breve nota sobre la legibilidad general de la hoja escaneada.',
              },
              items: {
                type: Type.ARRAY,
                description: 'Lista exacta de los 16 ítems del 1 al 16.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    itemNumber: {
                      type: Type.INTEGER,
                      description: 'Número del ítem del 1 al 16.',
                    },
                    selectedValue: {
                      type: Type.INTEGER,
                      nullable: true,
                      description: 'Valor marcado (1, 2, 3, 4 o 5), o null si no hay marca visible.',
                    },
                    confidence: {
                      type: Type.STRING,
                      description: 'Nivel de certeza: "alta", "media" o "baja".',
                    },
                    observation: {
                      type: Type.STRING,
                      description: 'Observación breve si la marca es tenue, dudosa o falta.',
                    },
                  },
                  required: ['itemNumber', 'confidence'],
                },
              },
            },
            required: ['apellidosNombres', 'gradoSeccion', 'fecha', 'items'],
          },
        },
      })
    );

    const rawText = (response.text ?? '{}').trim();
    interface ParsedScanItem {
      itemNumber: number;
      selectedValue?: number | null;
      confidence?: string;
      observation?: string;
    }

    const parsed = JSON.parse(rawText) as {
      apellidosNombres?: string;
      gradoSeccion?: string;
      fecha?: string;
      qualityNote?: string;
      items?: ParsedScanItem[];
    };

    const byNumber = new Map<number, ParsedScanItem>();
    for (const item of parsed.items ?? []) {
      if (item && typeof item.itemNumber === 'number') {
        byNumber.set(item.itemNumber, item);
      }
    }

    const normalizedItems = QUESTIONNAIRE_ITEMS.map((q) => {
      const found = byNumber.get(q.number);
      const rawVal = found?.selectedValue;
      const selectedValue: RatingValue | null =
        rawVal === 1 || rawVal === 2 || rawVal === 3 || rawVal === 4 || rawVal === 5
          ? rawVal
          : null;
      const conf = found?.confidence;
      const confidence =
        conf === 'alta' || conf === 'media' || conf === 'baja'
          ? conf
          : selectedValue === null
            ? 'baja'
            : 'media';

      return {
        itemNumber: q.number,
        selectedValue,
        confidence,
        observation: found?.observation ?? '',
      };
    });

    res.json({
      apellidosNombres: (parsed.apellidosNombres ?? '').trim(),
      gradoSeccion: (parsed.gradoSeccion ?? '').trim(),
      fecha: (parsed.fecha ?? '').trim(),
      qualityNote: (parsed.qualityNote ?? '').trim(),
      items: normalizedItems,
    });
  } catch (error) {
    console.error('Error en /api/scan-sheet:', error);
    const quota = getQuotaErrorInfo(error);
    if (quota) {
      res.status(429).json({
        error: quota.daily
          ? 'Se agotó la cuota diaria de la API de Gemini para esta clave. Activa la facturación en Google AI Studio o espera al reinicio diario de la cuota.'
          : 'Se alcanzó el límite de solicitudes por minuto de la API de Gemini. Espera unos segundos y reintenta.',
        quotaExceeded: true,
        daily: quota.daily,
        retryAfterSeconds: quota.retryAfterSeconds,
      });
      return;
    }
    const message =
      error instanceof Error
        ? error.message
        : 'Error inesperado al analizar el cuestionario.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/export-excel', async (req, res) => {
  try {
    const { sheets } = req.body as { sheets?: QuestionnaireSheet[] };
    if (!Array.isArray(sheets) || sheets.length === 0) {
      res.status(400).json({ error: 'No hay fichas registradas para exportar.' });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Escáner Autoestima Académica — EESPP Tarapoto';
    workbook.created = new Date();

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };

    const headerFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' },
    };

    const subHeaderFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };

    // =========================================================================
    // HOJA 1: RESUMEN POR ÍTEM (RÉPLICA EXACTA DEL FORMATO DEL PDF CON CONTEOS)
    // =========================================================================
    const wsItems = workbook.addWorksheet('Resumen por Ítem');
    wsItems.views = [{ showGridLines: true }];

    wsItems.columns = [
      { width: 24 }, // A: Dimensión
      { width: 30 }, // B: Indicador
      { width: 6 },  // C: N°
      { width: 58 }, // D: Ítems
      { width: 12 }, // E: 1 Nunca
      { width: 13 }, // F: 2 Casi nunca
      { width: 12 }, // G: 3 A veces
      { width: 14 }, // H: 4 Casi siempre
      { width: 12 }, // I: 5 Siempre
      { width: 11 }, // J: Total
      { width: 12 }, // K: Promedio
    ];

    // Banner institucional
    wsItems.mergeCells('A1:K1');
    const r1 = wsItems.getCell('A1');
    r1.value = INSTRUMENT_META.institution;
    r1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } };
    r1.alignment = { horizontal: 'center', vertical: 'middle' };
    wsItems.getRow(1).height = 22;

    wsItems.mergeCells('A2:K2');
    const r2 = wsItems.getCell('A2');
    r2.value = `${INSTRUMENT_META.title} — ${INSTRUMENT_META.subtitle}`;
    r2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
    r2.alignment = { horizontal: 'center', vertical: 'middle' };
    wsItems.getRow(2).height = 20;

    wsItems.mergeCells('A3:K3');
    const r3 = wsItems.getCell('A3');
    r3.value = `Consolidado de respuestas marcadas (X) · Total de fichas registradas: ${sheets.length} · Generado: ${new Date().toLocaleDateString('es-PE')}`;
    r3.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
    r3.alignment = { horizontal: 'center', vertical: 'middle' };
    wsItems.getRow(3).height = 18;

    // Fila 5: Encabezado de tabla
    const headerRowIdx = 5;
    const headerRow = wsItems.getRow(headerRowIdx);
    headerRow.values = [
      'Dimensión',
      'Indicador',
      'N°',
      'Ítems',
      '1\nNunca',
      '2\nCasi nunca',
      '3\nA veces',
      '4\nCasi siempre',
      '5\nSiempre',
      'Total\nMarcas',
      'Promedio',
    ];
    headerRow.height = 34;
    headerRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder;
    });

    const consolidatedRows = computeConsolidatedCounts(sheets);
    const startDataRow = 6;

    consolidatedRows.forEach((row, idx) => {
      const excelRowNum = startDataRow + idx;
      const r = wsItems.getRow(excelRowNum);
      r.values = [
        row.item.dimensionName,
        row.item.indicatorName,
        row.item.number,
        row.item.text,
        row.counts[1],
        row.counts[2],
        row.counts[3],
        row.counts[4],
        row.counts[5],
        { formula: `SUM(E${excelRowNum}:I${excelRowNum})`, result: row.total },
        Number(row.average.toFixed(2)),
      ];
      r.height = 30;

      const dimDef = DIMENSIONS.find((d) => d.id === row.item.dimensionId)!;
      const dimFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${dimDef.excelFillHex}` },
      };

      r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = thinBorder;
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
        if (colNumber <= 2) {
          cell.fill = dimFill;
          cell.font = {
            name: 'Calibri',
            size: 10,
            bold: colNumber === 1,
            color: { argb: 'FF0F172A' },
          };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        } else if (colNumber === 3) {
          cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colNumber === 4) {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        } else if (colNumber >= 5 && colNumber <= 10) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '0';
          if (colNumber === 10) {
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
          }
        } else if (colNumber === 11) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '0.00';
        }
      });
    });

    // Combinar celdas verticales de Dimensión e Indicador igual que en el PDF
    for (const dim of DIMENSIONS) {
      const firstItem = dim.itemNumbers[0];
      const lastItem = dim.itemNumbers[dim.itemNumbers.length - 1];
      const rStart = startDataRow + firstItem - 1;
      const rEnd = startDataRow + lastItem - 1;
      if (rEnd > rStart) {
        wsItems.mergeCells(`A${rStart}:A${rEnd}`);
      }
    }

    for (const ind of INDICATORS) {
      const firstItem = ind.itemNumbers[0];
      const lastItem = ind.itemNumbers[ind.itemNumbers.length - 1];
      const rStart = startDataRow + firstItem - 1;
      const rEnd = startDataRow + lastItem - 1;
      if (rEnd > rStart) {
        wsItems.mergeCells(`B${rStart}:B${rEnd}`);
      }
    }

    // Fila Total General
    const totalRowIdx = startDataRow + consolidatedRows.length;
    const totalRow = wsItems.getRow(totalRowIdx);
    wsItems.mergeCells(`A${totalRowIdx}:D${totalRowIdx}`);
    totalRow.getCell(1).value = 'TOTAL GENERAL DE MARCAS REGISTRADAS';
    totalRow.getCell(5).value = {
      formula: `SUM(E${startDataRow}:E${totalRowIdx - 1})`,
      result: consolidatedRows.reduce((acc, r) => acc + r.counts[1], 0),
    };
    totalRow.getCell(6).value = {
      formula: `SUM(F${startDataRow}:F${totalRowIdx - 1})`,
      result: consolidatedRows.reduce((acc, r) => acc + r.counts[2], 0),
    };
    totalRow.getCell(7).value = {
      formula: `SUM(G${startDataRow}:G${totalRowIdx - 1})`,
      result: consolidatedRows.reduce((acc, r) => acc + r.counts[3], 0),
    };
    totalRow.getCell(8).value = {
      formula: `SUM(H${startDataRow}:H${totalRowIdx - 1})`,
      result: consolidatedRows.reduce((acc, r) => acc + r.counts[4], 0),
    };
    totalRow.getCell(9).value = {
      formula: `SUM(I${startDataRow}:I${totalRowIdx - 1})`,
      result: consolidatedRows.reduce((acc, r) => acc + r.counts[5], 0),
    };
    totalRow.getCell(10).value = {
      formula: `SUM(J${startDataRow}:J${totalRowIdx - 1})`,
      result: consolidatedRows.reduce((acc, r) => acc + r.total, 0),
    };
    const allAnswered = consolidatedRows.reduce((acc, r) => acc + r.total, 0);
    const weightedAvg =
      allAnswered > 0
        ? consolidatedRows.reduce((acc, r) => acc + r.average * r.total, 0) / allAnswered
        : 0;
    totalRow.getCell(11).value = Number(weightedAvg.toFixed(2));
    totalRow.height = 24;
    totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.fill = subHeaderFill;
      cell.border = thinBorder;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = {
        horizontal: colNumber === 1 ? 'right' : 'center',
        vertical: 'middle',
      };
      if (colNumber >= 5 && colNumber <= 10) cell.numFmt = '0';
      if (colNumber === 11) cell.numFmt = '0.00';
    });

    // =========================================================================
    // HOJA 2: RESUMEN POR DIMENSIÓN E INDICADOR
    // =========================================================================
    const wsDim = workbook.addWorksheet('Resumen por Dimensión');
    wsDim.columns = [
      { width: 30 },
      { width: 38 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
    ];

    wsDim.mergeCells('A1:I1');
    wsDim.getCell('A1').value = 'CONSOLIDADO POR DIMENSIÓN E INDICADOR';
    wsDim.getCell('A1').font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
    wsDim.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    wsDim.getRow(1).height = 24;

    const dimHeaderRow = wsDim.getRow(3);
    dimHeaderRow.values = [
      'Dimensión',
      'Indicador',
      '1 (Nunca)',
      '2 (Casi nunca)',
      '3 (A veces)',
      '4 (Casi siempre)',
      '5 (Siempre)',
      'Total Marcas',
      'Promedio',
    ];
    dimHeaderRow.height = 28;
    dimHeaderRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder;
    });

    let dimCursor = 4;
    for (const dim of DIMENSIONS) {
      const dimIndicators = INDICATORS.filter((i) => i.dimensionId === dim.id);
      const dimStartRow = dimCursor;
      const dimFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${dim.excelFillHex}` },
      };

      for (const ind of dimIndicators) {
        const indRows = consolidatedRows.filter((r) => r.item.indicatorId === ind.id);
        const c1 = indRows.reduce((s, r) => s + r.counts[1], 0);
        const c2 = indRows.reduce((s, r) => s + r.counts[2], 0);
        const c3 = indRows.reduce((s, r) => s + r.counts[3], 0);
        const c4 = indRows.reduce((s, r) => s + r.counts[4], 0);
        const c5 = indRows.reduce((s, r) => s + r.counts[5], 0);
        const tot = c1 + c2 + c3 + c4 + c5;
        const avg = tot > 0 ? (c1 * 1 + c2 * 2 + c3 * 3 + c4 * 4 + c5 * 5) / tot : 0;

        const r = wsDim.getRow(dimCursor);
        r.values = [dim.name, ind.name, c1, c2, c3, c4, c5, tot, Number(avg.toFixed(2))];
        r.height = 24;
        r.eachCell((cell, col) => {
          cell.border = thinBorder;
          cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
          if (col === 1) {
            cell.fill = dimFill;
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          } else if (col === 2) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          } else if (col >= 3 && col <= 8) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.numFmt = '0';
          } else {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.numFmt = '0.00';
          }
        });
        dimCursor++;
      }

      if (dimCursor - 1 > dimStartRow) {
        wsDim.mergeCells(`A${dimStartRow}:A${dimCursor - 1}`);
      }

      // Subtotal de dimensión
      const dimAllRows = consolidatedRows.filter((r) => r.item.dimensionId === dim.id);
      const dc1 = dimAllRows.reduce((s, r) => s + r.counts[1], 0);
      const dc2 = dimAllRows.reduce((s, r) => s + r.counts[2], 0);
      const dc3 = dimAllRows.reduce((s, r) => s + r.counts[3], 0);
      const dc4 = dimAllRows.reduce((s, r) => s + r.counts[4], 0);
      const dc5 = dimAllRows.reduce((s, r) => s + r.counts[5], 0);
      const dtot = dc1 + dc2 + dc3 + dc4 + dc5;
      const davg = dtot > 0 ? (dc1 * 1 + dc2 * 2 + dc3 * 3 + dc4 * 4 + dc5 * 5) / dtot : 0;

      const subRow = wsDim.getRow(dimCursor);
      subRow.values = [
        `Subtotal: ${dim.name}`,
        '',
        dc1,
        dc2,
        dc3,
        dc4,
        dc5,
        dtot,
        Number(davg.toFixed(2)),
      ];
      wsDim.mergeCells(`A${dimCursor}:B${dimCursor}`);
      subRow.height = 22;
      subRow.eachCell((cell, col) => {
        cell.fill = subHeaderFill;
        cell.border = thinBorder;
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: col === 1 ? 'right' : 'center', vertical: 'middle' };
        if (col >= 3 && col <= 8) cell.numFmt = '0';
        if (col === 9) cell.numFmt = '0.00';
      });
      dimCursor++;
    }

    // =========================================================================
    // HOJA 3: REGISTRO INDIVIDUAL POR ESTUDIANTE
    // =========================================================================
    const wsStudents = workbook.addWorksheet('Registro por Estudiante');
    wsStudents.columns = [
      { width: 8 },  // N° Ficha
      { width: 32 }, // Apellidos y nombres
      { width: 16 }, // Grado y sección
      { width: 14 }, // Fecha
      ...QUESTIONNAIRE_ITEMS.map(() => ({ width: 7 })),
      { width: 14 }, // D1
      { width: 14 }, // D2
      { width: 14 }, // D3
      { width: 14 }, // Total Puntaje
    ];

    const stuHeader = wsStudents.getRow(1);
    stuHeader.values = [
      'Ficha',
      'Apellidos y nombres',
      'Grado y sección',
      'Fecha',
      ...QUESTIONNAIRE_ITEMS.map((i) => `P${i.number}`),
      'Autoconcepto',
      'Valoración',
      'Actores Ed.',
      'Puntaje Total',
    ];
    stuHeader.height = 26;
    stuHeader.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder;
    });

    sheets.forEach((sheet, idx) => {
      const scores = computeSheetScore(sheet);
      const row = wsStudents.getRow(idx + 2);
      row.values = [
        idx + 1,
        sheet.apellidosNombres || 'Sin nombre / Anónimo',
        sheet.gradoSeccion || '—',
        sheet.fecha || '—',
        ...QUESTIONNAIRE_ITEMS.map((i) => sheet.answers[i.number] ?? ''),
        scores.dimensionScores.autoconcepto,
        scores.dimensionScores.valoracion,
        scores.dimensionScores.actores,
        scores.totalScore,
      ];
      row.height = 22;
      row.eachCell((cell, col) => {
        cell.border = thinBorder;
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
        cell.alignment = {
          horizontal: col === 2 ? 'left' : 'center',
          vertical: 'middle',
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Autoestima_Academica_Consolidado_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error al exportar Excel:', error);
    res.status(500).json({ error: 'No se pudo generar el archivo Excel.' });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en http://0.0.0.0:${PORT}`);
  });
}

startServer();
