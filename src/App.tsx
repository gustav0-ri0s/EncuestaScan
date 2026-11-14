import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Download, FileSpreadsheet, Loader2, Users } from 'lucide-react';
import {
  BatchScanProgress,
  type BatchFilter,
  type BatchPageOutcome,
  type BatchProgressState,
} from './components/BatchScanProgress';
import { CameraScanner } from './components/CameraScanner';
import { ConsolidatedTable } from './components/ConsolidatedTable';
import { ScannedSheetsList } from './components/ScannedSheetsList';
import { ScanModeSelector } from './components/ScanModeSelector';
import { ScanVerifier, type VerifierDraft } from './components/ScanVerifier';
import {
  INSTRUMENT_META,
  QUESTIONNAIRE_ITEMS,
  type ConfidenceLevel,
  type QuestionnaireSheet,
  type RatingValue,
  type ScanApiResponse,
} from './data/questionnaire';
import { prepareImageForScan } from './utils/imageEnhancer';
import {
  isLocalReadClear,
  mergeLocalAndAi,
  payloadFromLocal,
  readSheetLocally,
  type ReadBy,
  type ScanMode,
} from './utils/omrReader';
import { loadPdfForScanning } from './utils/pdfExtractor';

type ActiveTab = 'scan' | 'consolidated' | 'sheets';

const STORAGE_KEY = 'eespp_tarapoto_autoestima_sheets_v1';
const SCAN_MODE_KEY = 'eespp_tarapoto_scan_mode_v1';

// Reintentos automáticos de una misma hoja cuando la API responde 429 por minuto
const MAX_QUOTA_RETRIES = 3;
const DEFAULT_QUOTA_WAIT_SECONDS = 20;

class QuotaExceededError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds: number | null,
    public daily: boolean
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

interface BatchSource {
  fileName: string;
  totalPages: number;
  sourceMode: 'pdf' | 'upload';
  getPageDataUrl: (pageNumber: number) => Promise<string>;
  cleanup?: () => Promise<void>;
}

function createEmptyDraft(): VerifierDraft {
  const answers: Record<number, RatingValue | null> = {};
  const confidences: Record<number, ConfidenceLevel> = {};
  const observations: Record<number, string> = {};
  for (const item of QUESTIONNAIRE_ITEMS) {
    answers[item.number] = null;
    confidences[item.number] = 'alta';
  }
  return {
    apellidosNombres: '',
    gradoSeccion: '',
    fecha: new Date().toLocaleDateString('es-PE'),
    answers,
    confidences,
    observations,
    sourceMode: 'manual',
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('scan');
  const [sheets, setSheets] = useState<QuestionnaireSheet[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignorar si localStorage no está disponible
    }
    return [];
  });

  const [draft, setDraft] = useState<VerifierDraft | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressState | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Almacena las imágenes completas en memoria durante la sesión para revisar fichas del PDF con zoom y realce
  const sessionImagesRef = useRef<
    Map<string, { originalDataUrl: string; enhancedDataUrl: string }>
  >(new Map());
  const batchCancelRequestedRef = useRef<boolean>(false);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const batchSourceRef = useRef<BatchSource | null>(null);
  const batchOutcomesRef = useRef<BatchPageOutcome[]>([]);
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('all');

  const [scanMode, setScanMode] = useState<ScanMode>(() => {
    try {
      const saved = localStorage.getItem(SCAN_MODE_KEY);
      if (saved === 'local' || saved === 'hybrid' || saved === 'ai') return saved;
    } catch {
      // Ignorar si localStorage no está disponible
    }
    return 'hybrid';
  });
  const scanModeRef = useRef<ScanMode>(scanMode);
  // Se activa cuando la IA deja de estar disponible durante un lote (cuota diaria, clave inválida)
  const aiBlockedRef = useRef(false);
  const aiFailuresRef = useRef(0);

  useEffect(() => {
    scanModeRef.current = scanMode;
    try {
      localStorage.setItem(SCAN_MODE_KEY, scanMode);
    } catch {
      // Ignorar
    }
  }, [scanMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets));
    } catch {
      try {
        const compact = sheets.map(({ thumbnailDataUrl: _t, ...rest }) => rest);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
      } catch {
        // Ignorar
      }
    }
  }, [sheets]);

  useEffect(() => {
    if (!noticeMessage) return;
    const timer = setTimeout(() => setNoticeMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [noticeMessage]);

  const callScanApi = async (
    originalImage: string,
    enhancedImage: string,
    signal?: AbortSignal
  ): Promise<ScanApiResponse> => {
    const response = await fetch('/api/scan-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalImage, enhancedImage }),
      signal,
    });

    const payload = (await response.json()) as ScanApiResponse & {
      error?: string;
      quotaExceeded?: boolean;
      daily?: boolean;
      retryAfterSeconds?: number | null;
    };
    if (!response.ok) {
      const message = payload.error || 'No se pudo analizar la hoja.';
      if (response.status === 429 && payload.quotaExceeded) {
        throw new QuotaExceededError(message, payload.retryAfterSeconds ?? null, !!payload.daily);
      }
      throw new Error(message);
    }
    return payload;
  };

  /**
   * Obtiene la lectura de una hoja según el modo elegido. En modo híbrido la IA
   * solo se usa si la lectura local no es clara; si la IA no está disponible, se
   * conserva la lectura local para revisión manual.
   */
  const obtainPayload = async (
    prepared: Awaited<ReturnType<typeof prepareImageForScan>>,
    signal?: AbortSignal
  ): Promise<{ payload: ScanApiResponse; readBy: ReadBy }> => {
    const mode = scanModeRef.current;
    if (mode === 'ai') {
      const payload = await callScanApi(prepared.originalDataUrl, prepared.enhancedDataUrl, signal);
      return { payload, readBy: 'ia' };
    }

    const omr = await readSheetLocally(prepared.originalDataUrl);
    if (mode === 'local' || isLocalReadClear(omr) || aiBlockedRef.current) {
      if (!omr.ok) {
        throw new Error(
          `Lectura local: ${omr.reason} Revisa que la hoja esté completa y derecha, o usa el modo con IA.`
        );
      }
      const note = mode === 'hybrid' && aiBlockedRef.current
        ? 'Lectura local. La IA no estuvo disponible para confirmar las marcas dudosas.'
        : undefined;
      return { payload: payloadFromLocal(omr, note), readBy: 'local' };
    }

    try {
      const ai = await callScanApi(prepared.originalDataUrl, prepared.enhancedDataUrl, signal);
      aiFailuresRef.current = 0;
      return { payload: mergeLocalAndAi(omr, ai), readBy: omr.ok ? 'local+ia' : 'ia' };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (err instanceof QuotaExceededError) {
        if (err.daily) aiBlockedRef.current = true;
      } else if (++aiFailuresRef.current >= 2) {
        // Sin clave válida o sin conexión: no insistir con la IA en el resto del lote
        aiBlockedRef.current = true;
      }
      // Sin lectura local utilizable, el error sigue su curso (y el lote puede esperar la cuota)
      if (!omr.ok) throw err;
      const reason = err instanceof Error ? err.message : 'error desconocido';
      return {
        payload: payloadFromLocal(omr, `Lectura local. La IA no pudo confirmar las marcas dudosas (${reason}).`),
        readBy: 'local',
      };
    }
  };

  const buildSheetFromPayload = (
    payload: ScanApiResponse,
    prepared: Awaited<ReturnType<typeof prepareImageForScan>>,
    meta: {
      sourceMode: 'camera' | 'upload' | 'pdf';
      sourceFileName?: string;
      sourcePage?: number;
    }
  ): { sheet: QuestionnaireSheet; answeredCount: number; flaggedCount: number } => {
    const answers: Record<number, RatingValue | null> = {};
    const confidences: Record<number, ConfidenceLevel> = {};
    const observations: Record<number, string> = {};
    let answeredCount = 0;
    let flaggedCount = 0;

    for (const item of QUESTIONNAIRE_ITEMS) {
      const found = payload.items.find((i) => i.itemNumber === item.number);
      const val = found?.selectedValue ?? null;
      const conf = found?.confidence ?? 'baja';
      answers[item.number] = val;
      confidences[item.number] = conf;
      if (found?.observation) {
        observations[item.number] = found.observation;
      }
      if (val !== null) answeredCount++;
      if (val === null || conf !== 'alta') flaggedCount++;
    }

    const id = crypto.randomUUID();
    sessionImagesRef.current.set(id, {
      originalDataUrl: prepared.originalDataUrl,
      enhancedDataUrl: prepared.enhancedDataUrl,
    });

    const sheet: QuestionnaireSheet = {
      id,
      apellidosNombres: payload.apellidosNombres ?? '',
      gradoSeccion: payload.gradoSeccion ?? '',
      fecha: payload.fecha ?? '',
      scannedAt: new Date().toISOString(),
      answers,
      confidences,
      observations,
      thumbnailDataUrl: prepared.thumbnailDataUrl,
      sourceMode: meta.sourceMode,
      sourceFileName: meta.sourceFileName,
      sourcePage: meta.sourcePage,
    };

    return { sheet, answeredCount, flaggedCount };
  };

  const analyzeSingleDataUrl = useCallback(
    async (rawDataUrl: string, sourceMode: 'camera' | 'upload') => {
      setIsProcessing(true);
      setErrorMessage(null);
      try {
        const prepared = await prepareImageForScan(rawDataUrl);
        aiBlockedRef.current = false;
        aiFailuresRef.current = 0;
        const { payload } = await obtainPayload(prepared);

        const answers: Record<number, RatingValue | null> = {};
        const confidences: Record<number, ConfidenceLevel> = {};
        const observations: Record<number, string> = {};

        for (const item of QUESTIONNAIRE_ITEMS) {
          const found = payload.items.find((i) => i.itemNumber === item.number);
          answers[item.number] = found?.selectedValue ?? null;
          confidences[item.number] = found?.confidence ?? 'baja';
          if (found?.observation) {
            observations[item.number] = found.observation;
          }
        }

        setDraft({
          apellidosNombres: payload.apellidosNombres ?? '',
          gradoSeccion: payload.gradoSeccion ?? '',
          fecha: payload.fecha ?? '',
          answers,
          confidences,
          observations,
          originalDataUrl: prepared.originalDataUrl,
          enhancedDataUrl: prepared.enhancedDataUrl,
          thumbnailDataUrl: prepared.thumbnailDataUrl,
          qualityNote: payload.qualityNote,
          sourceMode,
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Ocurrió un error al procesar la fotografía.';
        setErrorMessage(msg);
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const setStageLabel = (stageLabel: string) =>
    setBatchProgress((prev) => (prev ? { ...prev, stageLabel } : null));

  // Espera en pasos de 1 s para poder cancelar y mostrar la cuenta regresiva
  const waitForQuota = async (seconds: number, page: number): Promise<boolean> => {
    for (let remaining = seconds; remaining > 0; remaining--) {
      if (batchCancelRequestedRef.current) return false;
      setStageLabel(
        `Límite de solicitudes de la API alcanzado. Reintentando hoja ${page} en ${remaining} s...`
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
    return !batchCancelRequestedRef.current;
  };

  // Procesa una hoja; devuelve null si el usuario canceló
  const scanBatchPage = async (
    page: number,
    source: BatchSource
  ): Promise<{ outcome: BatchPageOutcome; dailyQuota: boolean } | null> => {
    setBatchProgress((prev) =>
      prev
        ? {
            ...prev,
            currentPage: page,
            stageLabel:
              source.sourceMode === 'pdf'
                ? `Extrayendo página ${page} del PDF y realzando contraste...`
                : `Realzando contraste de la imagen ${page}...`,
          }
        : null
    );

    try {
      const rawDataUrl = await source.getPageDataUrl(page);
      if (batchCancelRequestedRef.current) return null;

      const prepared = await prepareImageForScan(rawDataUrl);

      for (let attempt = 0; ; attempt++) {
        if (batchCancelRequestedRef.current) return null;
        setStageLabel(`Identificando marcas (X) de los 16 ítems en hoja ${page}...`);

        const controller = new AbortController();
        batchAbortControllerRef.current = controller;

        try {
          const { payload, readBy } = await obtainPayload(prepared, controller.signal);

          const { sheet, answeredCount, flaggedCount } = buildSheetFromPayload(
            payload,
            prepared,
            {
              sourceMode: source.sourceMode,
              sourceFileName: source.fileName,
              sourcePage: page,
            }
          );

          setSheets((prev) => [sheet, ...prev]);

          return {
            dailyQuota: false,
            outcome: {
              pageNumber: page,
              status: flaggedCount > 0 ? 'review' : 'ok',
              sheetId: sheet.id,
              studentName: sheet.apellidosNombres,
              answeredCount,
              flaggedCount,
              readBy,
            },
          };
        } catch (err) {
          if (!(err instanceof QuotaExceededError)) throw err;
          if (err.daily || attempt >= MAX_QUOTA_RETRIES) {
            return {
              dailyQuota: err.daily,
              outcome: { pageNumber: page, status: 'error', errorMessage: err.message },
            };
          }
          const keepGoing = await waitForQuota(
            err.retryAfterSeconds ?? DEFAULT_QUOTA_WAIT_SECONDS * (attempt + 1),
            page
          );
          if (!keepGoing) return null;
        } finally {
          batchAbortControllerRef.current = null;
        }
      }
    } catch (err) {
      if (batchCancelRequestedRef.current || (err instanceof Error && err.name === 'AbortError')) {
        return null;
      }
      return {
        dailyQuota: false,
        outcome: {
          pageNumber: page,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Error de lectura en esta hoja.',
        },
      };
    }
  };

  const upsertOutcome = (outcome: BatchPageOutcome) => {
    const outcomes = batchOutcomesRef.current.filter((o) => o.pageNumber !== outcome.pageNumber);
    outcomes.push(outcome);
    outcomes.sort((a, b) => a.pageNumber - b.pageNumber);
    batchOutcomesRef.current = outcomes;
    setBatchProgress((prev) =>
      prev ? { ...prev, processedPages: outcomes.length, outcomes } : null
    );
  };

  const processBatchPages = async (pages: number[], source: BatchSource) => {
    batchCancelRequestedRef.current = false;
    aiBlockedRef.current = false;
    aiFailuresRef.current = 0;
    let dailyQuotaHit = false;

    for (let i = 0; i < pages.length; i++) {
      if (batchCancelRequestedRef.current) break;
      const result = await scanBatchPage(pages[i], source);
      if (!result) break;
      upsertOutcome(result.outcome);

      if (result.dailyQuota) {
        // Sin cuota no tiene sentido seguir: se dejan pendientes para reintentar luego
        dailyQuotaHit = true;
        for (const pending of pages.slice(i + 1)) {
          upsertOutcome({
            pageNumber: pending,
            status: 'error',
            errorMessage: 'No procesada: se agotó la cuota diaria de la API.',
          });
        }
        break;
      }
    }

    const outcomes = batchOutcomesRef.current;
    const saved = outcomes.filter((o) => o.sheetId).length;
    const errors = outcomes.filter((o) => o.status === 'error').length;
    const wasCancelled = batchCancelRequestedRef.current;
    setBatchProgress((prev) =>
      prev
        ? {
            ...prev,
            active: false,
            finished: !wasCancelled,
            cancelled: wasCancelled,
            stageLabel: dailyQuotaHit
              ? `Se agotó la cuota diaria de la API. ${saved} fichas guardadas; ${errors} hojas quedan pendientes para reintentar.`
              : wasCancelled
                ? `Proceso detenido. Se guardaron ${saved} fichas.`
                : `Lectura finalizada: ${saved} de ${source.totalPages} hojas guardadas en el consolidado.`,
          }
        : null
    );
  };

  const releaseBatchSource = async () => {
    const source = batchSourceRef.current;
    batchSourceRef.current = null;
    if (source?.cleanup) {
      await source.cleanup().catch(() => undefined);
    }
  };

  const runBatchPipeline = async (
    fileName: string,
    totalPages: number,
    sourceMode: 'pdf' | 'upload',
    getPageDataUrl: (pageNumber: number) => Promise<string>,
    cleanup?: () => Promise<void>
  ) => {
    await releaseBatchSource();
    // El origen se conserva abierto para poder reintentar las hojas con error
    const source: BatchSource = { fileName, totalPages, sourceMode, getPageDataUrl, cleanup };
    batchSourceRef.current = source;
    batchOutcomesRef.current = [];

    setErrorMessage(null);
    setDraft(null);
    setActiveTab('scan');
    setBatchFilter('all');
    setBatchProgress({
      active: true,
      finished: false,
      cancelled: false,
      fileName,
      totalPages,
      processedPages: 0,
      currentPage: 1,
      stageLabel: 'Preparando primera hoja...',
      outcomes: [],
    });

    await processBatchPages(
      Array.from({ length: totalPages }, (_, i) => i + 1),
      source
    );
  };

  const handleRetryPages = async (pages: number[]) => {
    const source = batchSourceRef.current;
    if (!source || pages.length === 0 || batchProgress?.active) return;
    setBatchProgress((prev) =>
      prev
        ? {
            ...prev,
            active: true,
            finished: false,
            cancelled: false,
            stageLabel: `Reintentando ${pages.length} ${pages.length === 1 ? 'hoja' : 'hojas'}...`,
          }
        : null
    );
    await processBatchPages(pages, source);
  };

  const handleResetScanner = () => {
    void releaseBatchSource();
    batchOutcomesRef.current = [];
    setBatchProgress(null);
  };

  const handleUploadPdf = async (file: File) => {
    setErrorMessage(null);
    setIsProcessing(true);
    try {
      const loaded = await loadPdfForScanning(file);
      setIsProcessing(false);
      if (loaded.numPages === 0) {
        await loaded.destroy();
        setErrorMessage('El archivo PDF no contiene páginas.');
        return;
      }
      await runBatchPipeline(
        file.name,
        loaded.numPages,
        'pdf',
        (page) => loaded.renderPage(page),
        () => loaded.destroy()
      );
    } catch (err) {
      setIsProcessing(false);
      setErrorMessage(
        err instanceof Error
          ? `No se pudo abrir el PDF: ${err.message}`
          : 'No se pudo leer el archivo PDF seleccionado.'
      );
    }
  };

  const handleCaptureSingle = (dataUrl: string, source: 'camera' | 'upload') => {
    handleResetScanner();
    analyzeSingleDataUrl(dataUrl, source);
  };

  const handleUploadImages = (dataUrls: string[]) => {
    if (dataUrls.length === 0) return;
    if (dataUrls.length === 1) {
      handleCaptureSingle(dataUrls[0], 'upload');
      return;
    }
    runBatchPipeline(
      `Lote de ${dataUrls.length} imágenes`,
      dataUrls.length,
      'upload',
      async (page) => dataUrls[page - 1]
    );
  };

  const handleStopBatch = () => {
    batchCancelRequestedRef.current = true;
    batchAbortControllerRef.current?.abort();
  };

  const handleSaveDraft = (completed: VerifierDraft) => {
    const id = completed.id ?? crypto.randomUUID();
    if (completed.originalDataUrl && completed.enhancedDataUrl) {
      sessionImagesRef.current.set(id, {
        originalDataUrl: completed.originalDataUrl,
        enhancedDataUrl: completed.enhancedDataUrl,
      });
    }

    const existing = completed.id ? sheets.find((s) => s.id === completed.id) : undefined;
    const newSheet: QuestionnaireSheet = {
      id,
      apellidosNombres: completed.apellidosNombres,
      gradoSeccion: completed.gradoSeccion,
      fecha: completed.fecha,
      scannedAt: existing?.scannedAt ?? new Date().toISOString(),
      answers: completed.answers,
      confidences: completed.confidences,
      observations: completed.observations,
      thumbnailDataUrl: completed.thumbnailDataUrl,
      sourceMode: completed.sourceMode,
      sourceFileName: completed.sourceFileName ?? existing?.sourceFileName,
      sourcePage: completed.sourcePage ?? existing?.sourcePage,
      reviewed: true,
    };

    setSheets((prev) => {
      const exists = prev.some((s) => s.id === newSheet.id);
      if (exists) {
        return prev.map((s) => (s.id === newSheet.id ? newSheet : s));
      }
      return [newSheet, ...prev];
    });

    setDraft(null);
    setNoticeMessage(
      completed.id ? 'Ficha actualizada correctamente.' : 'Ficha guardada en el consolidado.'
    );
  };

  const handleEditSheet = (sheet: QuestionnaireSheet) => {
    const confidences: Record<number, ConfidenceLevel> = {};
    for (const item of QUESTIONNAIRE_ITEMS) {
      confidences[item.number] = sheet.confidences?.[item.number] ?? 'alta';
    }
    const cached = sessionImagesRef.current.get(sheet.id);
    setDraft({
      id: sheet.id,
      apellidosNombres: sheet.apellidosNombres,
      gradoSeccion: sheet.gradoSeccion,
      fecha: sheet.fecha,
      answers: { ...sheet.answers },
      confidences,
      observations: sheet.observations ? { ...sheet.observations } : {},
      originalDataUrl: cached?.originalDataUrl ?? sheet.thumbnailDataUrl,
      enhancedDataUrl: cached?.enhancedDataUrl,
      thumbnailDataUrl: sheet.thumbnailDataUrl,
      sourceMode: sheet.sourceMode,
      sourceFileName: sheet.sourceFileName,
      sourcePage: sheet.sourcePage,
    });
    setActiveTab('scan');
  };

  const handleDeleteSheet = (id: string) => {
    sessionImagesRef.current.delete(id);
    setSheets((prev) => prev.filter((s) => s.id !== id));
    setNoticeMessage('Ficha eliminada.');
  };

  const handleExportExcel = async (targetSheets: QuestionnaireSheet[]) => {
    if (targetSheets.length === 0 || isExporting) return;
    setIsExporting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheets: targetSheets.map(({ thumbnailDataUrl: _t, ...clean }) => clean),
        }),
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Error al generar el archivo Excel.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Autoestima_Academica_Consolidado_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNoticeMessage('Archivo Excel (.xlsx) descargado con las 3 hojas de análisis.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo descargar el archivo Excel.';
      setErrorMessage(msg);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Barra superior compacta (3 zonas en escritorio, compacta en móvil <= 48px) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 md:h-16 flex items-center justify-between gap-8">
          <a
            href="#escaner"
            onClick={(e) => {
              e.preventDefault();
              setDraft(null);
              setActiveTab('scan');
            }}
            className="text-base md:text-lg font-bold tracking-tight text-blue-950 whitespace-nowrap shrink-0"
          >
            Autoestima Escáner
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'scan'
                  ? 'text-blue-950 border-blue-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Escanear
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setActiveTab('consolidated');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'consolidated'
                  ? 'text-blue-950 border-blue-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Consolidado
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setActiveTab('sheets');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'sheets'
                  ? 'text-blue-950 border-blue-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Fichas ({sheets.length})
            </button>
            <a
              href={INSTRUMENT_META.pdfAssetPath}
              target="_blank"
              rel="noopener noreferrer"
              className="py-1 border-b-2 border-transparent hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Plantilla PDF
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={sheets.length === 0 || isExporting}
              onClick={() => handleExportExcel(sheets)}
              className="min-h-[36px] md:min-h-[40px] px-3 md:px-4 py-1.5 md:py-2 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Exportar Excel</span>
            </button>
          </div>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-7 pb-20 md:pb-10 space-y-5">
        {/* Contexto del instrumento */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <p className="text-xs text-slate-500">
              {INSTRUMENT_META.institution} · {INSTRUMENT_META.subtitle}
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 text-balance">
              {activeTab === 'scan'
                ? draft
                  ? 'Revisión y confirmación de respuestas'
                  : batchProgress
                    ? 'Escaneo automático hoja por hoja'
                    : 'Escáner de Cuestionario de Autoestima Académica'
                : activeTab === 'consolidated'
                  ? 'Consolidado por Dimensión, Indicador e Ítem'
                  : 'Fichas de Estudiantes Registradas'}
            </h1>
          </div>

          <div className="text-xs text-slate-500 tabular-nums shrink-0">
            {sheets.length} {sheets.length === 1 ? 'ficha registrada' : 'fichas registradas'}
          </div>
        </div>

        {/* Notificación no intrusiva */}
        {noticeMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2.5 text-sm text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{noticeMessage}</span>
          </div>
        )}

        {/* Vistas principales */}
        {activeTab === 'scan' &&
          (draft ? (
            <ScanVerifier
              key={draft.id ?? draft.apellidosNombres}
              draft={draft}
              onSave={handleSaveDraft}
              onCancel={() => setDraft(null)}
              onAskAi={(d) => callScanApi(d.originalDataUrl ?? '', d.enhancedDataUrl ?? '')}
            />
          ) : batchProgress ? (
            <BatchScanProgress
              progress={batchProgress}
              sheets={sheets}
              filter={batchFilter}
              onFilterChange={setBatchFilter}
              canRetry={batchSourceRef.current !== null}
              onRetryPages={handleRetryPages}
              onStopBatch={handleStopBatch}
              onReviewSheet={handleEditSheet}
              onGoConsolidated={() => setActiveTab('consolidated')}
              onResetScanner={handleResetScanner}
            />
          ) : (
            <div className="space-y-4">
              <ScanModeSelector value={scanMode} onChange={setScanMode} />
              <CameraScanner
                isProcessing={isProcessing}
                queueStatus={null}
                errorMessage={errorMessage}
                onCaptureDataUrl={handleCaptureSingle}
                onUploadFiles={handleUploadImages}
                onUploadPdf={handleUploadPdf}
                onStartManual={() => setDraft(createEmptyDraft())}
                onDismissError={() => setErrorMessage(null)}
              />
            </div>
          ))}

        {activeTab === 'consolidated' && (
          <ConsolidatedTable
            sheets={sheets}
            isExporting={isExporting}
            onExportExcel={handleExportExcel}
            onGoScan={() => setActiveTab('scan')}
          />
        )}

        {activeTab === 'sheets' && (
          <ScannedSheetsList
            sheets={sheets}
            onEditSheet={handleEditSheet}
            onDeleteSheet={handleDeleteSheet}
            onClearAll={() => {
              sessionImagesRef.current.clear();
              setSheets([]);
              handleResetScanner();
              setNoticeMessage('Se vaciaron todas las fichas.');
            }}
            onGoScan={() => setActiveTab('scan')}
          />
        )}
      </main>

      {/* Pie de página discreto */}
      <footer className="hidden md:block border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {INSTRUMENT_META.authors} · {INSTRUMENT_META.advisor}
          </span>
          <span>{INSTRUMENT_META.cohort}</span>
        </div>
      </footer>

      {/* Barra inferior táctil en móviles */}
      <nav
        aria-label="Navegación principal móvil"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-3 h-14">
          <button
            type="button"
            onClick={() => setActiveTab('scan')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeTab === 'scan' ? 'text-blue-900' : 'text-slate-500'
            }`}
          >
            <Camera className="w-5 h-5" />
            <span>Escanear</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setActiveTab('consolidated');
            }}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeTab === 'consolidated' ? 'text-blue-900' : 'text-slate-500'
            }`}
          >
            <FileSpreadsheet className="w-5 h-5" />
            <span>Consolidado</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setActiveTab('sheets');
            }}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeTab === 'sheets' ? 'text-blue-900' : 'text-slate-500'
            }`}
          >
            <Users className="w-5 h-5" />
            <span className="tabular-nums">Fichas ({sheets.length})</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
