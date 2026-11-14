import {
  QUESTIONNAIRE_ITEMS,
  type ConfidenceLevel,
  type QuestionnaireSheet,
  type RatingValue,
} from '../data/questionnaire';

/**
 * Respaldo de fichas en un archivo JSON para llevarlas a otra computadora.
 * Las fichas viven en el localStorage de cada navegador, así que este archivo
 * es la forma de moverlas.
 */
const BACKUP_APP = 'EncuestaScan';
const BACKUP_VERSION = 1;

interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  sheets: QuestionnaireSheet[];
}

export function downloadBackup(sheets: QuestionnaireSheet[]): void {
  const backup: BackupFile = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sheets,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EncuestaScan_respaldo_${new Date().toISOString().slice(0, 10)}_${sheets.length}fichas.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const isRating = (v: unknown): v is RatingValue => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
const isConfidence = (v: unknown): v is ConfidenceLevel => v === 'alta' || v === 'media' || v === 'baja';
const SOURCE_MODES = ['camera', 'upload', 'pdf', 'manual'] as const;

/** Valida y normaliza una ficha leída del archivo; devuelve null si no es utilizable */
function sanitizeSheet(raw: unknown): QuestionnaireSheet | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id || !s.answers || typeof s.answers !== 'object') return null;

  const rawAnswers = s.answers as Record<string, unknown>;
  const rawConf = (s.confidences ?? {}) as Record<string, unknown>;
  const rawObs = (s.observations ?? {}) as Record<string, unknown>;
  const answers: Record<number, RatingValue | null> = {};
  const confidences: Record<number, ConfidenceLevel> = {};
  const observations: Record<number, string> = {};
  for (const item of QUESTIONNAIRE_ITEMS) {
    const v = rawAnswers[item.number];
    answers[item.number] = isRating(v) ? v : null;
    const c = rawConf[item.number];
    confidences[item.number] = isConfidence(c) ? c : 'alta';
    const o = rawObs[item.number];
    if (typeof o === 'string' && o) observations[item.number] = o;
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const sourceMode = SOURCE_MODES.find((m) => m === s.sourceMode) ?? 'manual';

  return {
    id: s.id,
    apellidosNombres: str(s.apellidosNombres),
    gradoSeccion: str(s.gradoSeccion),
    fecha: str(s.fecha),
    scannedAt: str(s.scannedAt) || new Date().toISOString(),
    answers,
    confidences,
    observations,
    thumbnailDataUrl:
      typeof s.thumbnailDataUrl === 'string' && s.thumbnailDataUrl.startsWith('data:image/')
        ? s.thumbnailDataUrl
        : undefined,
    sourceMode,
    sourceFileName: typeof s.sourceFileName === 'string' ? s.sourceFileName : undefined,
    sourcePage: typeof s.sourcePage === 'number' ? s.sourcePage : undefined,
    reviewed: s.reviewed === true,
  };
}

export async function readBackupFile(file: File): Promise<QuestionnaireSheet[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('El archivo no es un respaldo válido (no se pudo leer como JSON).');
  }

  const backup = parsed as Partial<BackupFile>;
  if (backup?.app !== BACKUP_APP || !Array.isArray(backup.sheets)) {
    throw new Error('El archivo no es un respaldo de EncuestaScan.');
  }
  if (typeof backup.version === 'number' && backup.version > BACKUP_VERSION) {
    throw new Error('El respaldo fue creado con una versión más nueva de la app. Actualiza el sistema.');
  }

  const sheets = backup.sheets.map(sanitizeSheet).filter((s): s is QuestionnaireSheet => s !== null);
  if (sheets.length === 0) {
    throw new Error('El respaldo no contiene fichas válidas.');
  }
  return sheets;
}
