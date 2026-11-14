export type RatingValue = 1 | 2 | 3 | 4 | 5;
export type ConfidenceLevel = 'alta' | 'media' | 'baja';

export interface ScaleOption {
  value: RatingValue;
  label: string;
  shortLabel: string;
}

export interface QuestionnaireItem {
  number: number;
  text: string;
  dimensionId: DimensionId;
  dimensionName: string;
  indicatorId: string;
  indicatorName: string;
}

export type DimensionId = 'autoconcepto' | 'valoracion' | 'actores';

export interface DimensionDefinition {
  id: DimensionId;
  name: string;
  excelFillHex: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  itemNumbers: number[];
}

export interface IndicatorDefinition {
  id: string;
  dimensionId: DimensionId;
  name: string;
  itemNumbers: number[];
}

export interface ScannedItemResult {
  itemNumber: number;
  selectedValue: RatingValue | null;
  confidence: ConfidenceLevel;
  observation?: string;
}

export interface QuestionnaireSheet {
  id: string;
  apellidosNombres: string;
  gradoSeccion: string;
  fecha: string;
  scannedAt: string;
  answers: Record<number, RatingValue | null>;
  confidences?: Record<number, ConfidenceLevel>;
  observations?: Record<number, string>;
  thumbnailDataUrl?: string;
  sourceMode: 'camera' | 'upload' | 'pdf' | 'manual';
  sourceFileName?: string;
  sourcePage?: number;
  // true cuando el usuario confirmó la ficha en el verificador
  reviewed?: boolean;
}

export interface ScanApiResponse {
  apellidosNombres: string;
  gradoSeccion: string;
  fecha: string;
  items: ScannedItemResult[];
  qualityNote?: string;
}

export const INSTRUMENT_META = {
  institution: 'ESCUELA DE EDUCACIÓN SUPERIOR PEDAGÓGICA PÚBLICA “TARAPOTO”',
  project:
    'Relación entre autoestima académica y desempeño matemático en estudiantes de cuarto año de secundaria',
  title: 'CUESTIONARIO DE AUTOESTIMA ACADÉMICA',
  subtitle: 'Instrumento N° 1 – Variable 1: Autoestima Académica',
  authors: 'Cristell Angélica López Solís | Gustavo Eduardo Ríos Quevedo',
  advisor: 'Asesor: Mag. Luis Enrique Javier Guanilo',
  cohort: 'EESPP “Tarapoto” – Promoción 2026',
  pdfAssetPath: '/assets/aistudio/Cuestionario_Autoestima_Academica_1pag_230fdc64.pdf',
};

export const SCALE_OPTIONS: ScaleOption[] = [
  { value: 1, label: 'Nunca', shortLabel: 'Nunca' },
  { value: 2, label: 'Casi nunca', shortLabel: 'C. nunca' },
  { value: 3, label: 'A veces', shortLabel: 'A veces' },
  { value: 4, label: 'Casi siempre', shortLabel: 'C. siempre' },
  { value: 5, label: 'Siempre', shortLabel: 'Siempre' },
];

export const DIMENSIONS: DimensionDefinition[] = [
  {
    id: 'autoconcepto',
    name: 'Autoconcepto académico',
    excelFillHex: 'D9E2F3',
    bgClass: 'bg-blue-50/80',
    borderClass: 'border-blue-200',
    textClass: 'text-blue-950',
    itemNumbers: [1, 2, 3, 4, 5, 6],
  },
  {
    id: 'valoracion',
    name: 'Valoración del esfuerzo y logro',
    excelFillHex: 'E2EFDA',
    bgClass: 'bg-emerald-50/80',
    borderClass: 'border-emerald-200',
    textClass: 'text-emerald-950',
    itemNumbers: [7, 8, 9, 10],
  },
  {
    id: 'actores',
    name: 'Actores educativos',
    excelFillHex: 'FCE4D6',
    bgClass: 'bg-amber-50/80',
    borderClass: 'border-amber-200',
    textClass: 'text-amber-950',
    itemNumbers: [11, 12, 13, 14, 15, 16],
  },
];

export const INDICATORS: IndicatorDefinition[] = [
  {
    id: 'confianza_capacidad',
    dimensionId: 'autoconcepto',
    name: 'Confianza en la capacidad intelectual',
    itemNumbers: [1, 2],
  },
  {
    id: 'percepcion_rendimiento',
    dimensionId: 'autoconcepto',
    name: 'Percepción propia del rendimiento académico',
    itemNumbers: [3, 4],
  },
  {
    id: 'autoeficacia',
    dimensionId: 'autoconcepto',
    name: 'Autoeficacia académica',
    itemNumbers: [5, 6],
  },
  {
    id: 'reconocimiento_esfuerzo',
    dimensionId: 'valoracion',
    name: 'Reconocimiento del esfuerzo personal',
    itemNumbers: [7, 8],
  },
  {
    id: 'relacion_esfuerzo_resultado',
    dimensionId: 'valoracion',
    name: 'Relación entre esfuerzo y resultado',
    itemNumbers: [9, 10],
  },
  {
    id: 'influencia_docente',
    dimensionId: 'actores',
    name: 'Influencia del docente',
    itemNumbers: [11, 12],
  },
  {
    id: 'apoyo_familiar',
    dimensionId: 'actores',
    name: 'Apoyo familiar',
    itemNumbers: [13, 14],
  },
  {
    id: 'relaciones_companeros',
    dimensionId: 'actores',
    name: 'Relaciones con sus compañeros',
    itemNumbers: [15, 16],
  },
];

export const QUESTIONNAIRE_ITEMS: QuestionnaireItem[] = [
  {
    number: 1,
    text: 'Creo que tengo la capacidad intelectual necesaria para comprender los temas de matemática.',
    dimensionId: 'autoconcepto',
    dimensionName: 'Autoconcepto académico',
    indicatorId: 'confianza_capacidad',
    indicatorName: 'Confianza en la capacidad intelectual',
  },
  {
    number: 2,
    text: 'Me siento seguro(a) al resolver ejercicios matemáticos cuando me esfuerzo.',
    dimensionId: 'autoconcepto',
    dimensionName: 'Autoconcepto académico',
    indicatorId: 'confianza_capacidad',
    indicatorName: 'Confianza en la capacidad intelectual',
  },
  {
    number: 3,
    text: 'Considero que mi desempeño en matemática refleja mi verdadero esfuerzo.',
    dimensionId: 'autoconcepto',
    dimensionName: 'Autoconcepto académico',
    indicatorId: 'percepcion_rendimiento',
    indicatorName: 'Percepción propia del rendimiento académico',
  },
  {
    number: 4,
    text: 'Creo que mis calificaciones en matemática representan lo que realmente sé.',
    dimensionId: 'autoconcepto',
    dimensionName: 'Autoconcepto académico',
    indicatorId: 'percepcion_rendimiento',
    indicatorName: 'Percepción propia del rendimiento académico',
  },
  {
    number: 5,
    text: 'Confío en que puedo aprender los contenidos matemáticos si me dedico a estudiarlos.',
    dimensionId: 'autoconcepto',
    dimensionName: 'Autoconcepto académico',
    indicatorId: 'autoeficacia',
    indicatorName: 'Autoeficacia académica',
  },
  {
    number: 6,
    text: 'Sé que soy capaz de superar mis dificultades en matemática con constancia.',
    dimensionId: 'autoconcepto',
    dimensionName: 'Autoconcepto académico',
    indicatorId: 'autoeficacia',
    indicatorName: 'Autoeficacia académica',
  },
  {
    number: 7,
    text: 'Me siento satisfecho(a) cuando logro resolver un problema matemático gracias a mi esfuerzo.',
    dimensionId: 'valoracion',
    dimensionName: 'Valoración del esfuerzo y logro',
    indicatorId: 'reconocimiento_esfuerzo',
    indicatorName: 'Reconocimiento del esfuerzo personal',
  },
  {
    number: 8,
    text: 'Valoro el tiempo que dedico a estudiar matemática, aunque los resultados no sean inmediatos.',
    dimensionId: 'valoracion',
    dimensionName: 'Valoración del esfuerzo y logro',
    indicatorId: 'reconocimiento_esfuerzo',
    indicatorName: 'Reconocimiento del esfuerzo personal',
  },
  {
    number: 9,
    text: 'Cuando me dedico a estudiar con constancia, obtengo mejores resultados en matemática.',
    dimensionId: 'valoracion',
    dimensionName: 'Valoración del esfuerzo y logro',
    indicatorId: 'relacion_esfuerzo_resultado',
    indicatorName: 'Relación entre esfuerzo y resultado',
  },
  {
    number: 10,
    text: 'Considero que practicar de manera regular los ejercicios matemáticos mejora mi rendimiento.',
    dimensionId: 'valoracion',
    dimensionName: 'Valoración del esfuerzo y logro',
    indicatorId: 'relacion_esfuerzo_resultado',
    indicatorName: 'Relación entre esfuerzo y resultado',
  },
  {
    number: 11,
    text: 'El apoyo y las orientaciones de mi docente me dan mayor confianza para aprender matemática.',
    dimensionId: 'actores',
    dimensionName: 'Actores educativos',
    indicatorId: 'influencia_docente',
    indicatorName: 'Influencia del docente',
  },
  {
    number: 12,
    text: 'Me motiva cuando mi docente reconoce y valora mi esfuerzo en el área de matemática.',
    dimensionId: 'actores',
    dimensionName: 'Actores educativos',
    indicatorId: 'influencia_docente',
    indicatorName: 'Influencia del docente',
  },
  {
    number: 13,
    text: 'Mi familia me anima y me apoya emocionalmente en mi proceso de aprendizaje de la matemática.',
    dimensionId: 'actores',
    dimensionName: 'Actores educativos',
    indicatorId: 'apoyo_familiar',
    indicatorName: 'Apoyo familiar',
  },
  {
    number: 14,
    text: 'Me siento respaldado(a) por mi familia cuando tengo dificultades en el área de matemática.',
    dimensionId: 'actores',
    dimensionName: 'Actores educativos',
    indicatorId: 'apoyo_familiar',
    indicatorName: 'Apoyo familiar',
  },
  {
    number: 15,
    text: 'Trabajar con mis compañeros en actividades matemáticas fortalece mi confianza para aprender.',
    dimensionId: 'actores',
    dimensionName: 'Actores educativos',
    indicatorId: 'relaciones_companeros',
    indicatorName: 'Relaciones con sus compañeros',
  },
  {
    number: 16,
    text: 'Me siento motivado(a) cuando mis compañeros y yo colaboramos para resolver problemas matemáticos.',
    dimensionId: 'actores',
    dimensionName: 'Actores educativos',
    indicatorId: 'relaciones_companeros',
    indicatorName: 'Relaciones con sus compañeros',
  },
];

export interface ItemCountsRow {
  item: QuestionnaireItem;
  counts: Record<RatingValue, number>;
  total: number;
  average: number;
}

export function computeConsolidatedCounts(sheets: QuestionnaireSheet[]): ItemCountsRow[] {
  return QUESTIONNAIRE_ITEMS.map((item) => {
    const counts: Record<RatingValue, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let total = 0;

    for (const sheet of sheets) {
      const val = sheet.answers[item.number];
      if (val && val >= 1 && val <= 5) {
        counts[val] += 1;
        sum += val;
        total += 1;
      }
    }

    return {
      item,
      counts,
      total,
      average: total > 0 ? sum / total : 0,
    };
  });
}

export function computeSheetScore(sheet: QuestionnaireSheet): {
  answeredCount: number;
  totalScore: number;
  dimensionScores: Record<DimensionId, number>;
} {
  let answeredCount = 0;
  let totalScore = 0;
  const dimensionScores: Record<DimensionId, number> = {
    autoconcepto: 0,
    valoracion: 0,
    actores: 0,
  };

  for (const item of QUESTIONNAIRE_ITEMS) {
    const val = sheet.answers[item.number];
    if (val && val >= 1 && val <= 5) {
      answeredCount += 1;
      totalScore += val;
      dimensionScores[item.dimensionId] += val;
    }
  }

  return { answeredCount, totalScore, dimensionScores };
}
