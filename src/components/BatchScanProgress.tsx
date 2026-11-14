import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  FileText,
  Loader2,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react';
import { computeSheetScore, type QuestionnaireSheet } from '../data/questionnaire';

export interface BatchPageOutcome {
  pageNumber: number;
  status: 'ok' | 'review' | 'error';
  sheetId?: string;
  studentName?: string;
  answeredCount?: number;
  flaggedCount?: number;
  errorMessage?: string;
  readBy?: 'local' | 'ia' | 'local+ia';
}

const READ_BY_LABEL: Record<NonNullable<BatchPageOutcome['readBy']>, string> = {
  local: 'Lectura local',
  ia: 'IA',
  'local+ia': 'Local + IA',
};

export interface BatchProgressState {
  active: boolean;
  finished: boolean;
  cancelled: boolean;
  fileName: string;
  totalPages: number;
  processedPages: number;
  currentPage: number;
  stageLabel: string;
  outcomes: BatchPageOutcome[];
}

export type BatchFilter = 'all' | 'review' | 'reviewed' | 'ok' | 'error';

type EffectiveStatus = Exclude<BatchFilter, 'all'>;

interface BatchScanProgressProps {
  progress: BatchProgressState;
  sheets: QuestionnaireSheet[];
  filter: BatchFilter;
  onFilterChange: (filter: BatchFilter) => void;
  canRetry: boolean;
  onRetryPages: (pages: number[]) => void;
  onStopBatch: () => void;
  onReviewSheet: (sheet: QuestionnaireSheet) => void;
  onGoConsolidated: () => void;
  onResetScanner: () => void;
}

export const BatchScanProgress: React.FC<BatchScanProgressProps> = ({
  progress,
  sheets,
  filter,
  onFilterChange,
  canRetry,
  onRetryPages,
  onStopBatch,
  onReviewSheet,
  onGoConsolidated,
  onResetScanner,
}) => {
  const percent =
    progress.totalPages > 0
      ? Math.min(100, Math.round((progress.processedPages / progress.totalPages) * 100))
      : 0;

  // Una hoja "para revisar" pasa a "revisada" cuando se confirma en el verificador
  const rows = progress.outcomes.map((outcome) => {
    const matchedSheet = outcome.sheetId
      ? sheets.find((s) => s.id === outcome.sheetId)
      : undefined;
    const status: EffectiveStatus =
      outcome.status === 'review' && matchedSheet?.reviewed ? 'reviewed' : outcome.status;
    return { outcome, matchedSheet, status };
  });

  const countOf = (status: EffectiveStatus) => rows.filter((r) => r.status === status).length;
  const okCount = countOf('ok');
  const reviewCount = countOf('review');
  const reviewedCount = countOf('reviewed');
  const errorCount = countOf('error');
  const errorPages = rows.filter((r) => r.status === 'error').map((r) => r.outcome.pageNumber);
  const aiCount = rows.filter((r) => r.outcome.readBy && r.outcome.readBy !== 'local').length;

  const visibleRows = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const nextToReview = rows.find((r) => r.status === 'review' && r.matchedSheet)?.matchedSheet;

  const filterOptions: Array<{ value: BatchFilter; label: string; count: number; tone: string }> = [
    { value: 'all', label: 'Todas', count: rows.length, tone: 'text-slate-700' },
    { value: 'review', label: 'Para revisar', count: reviewCount, tone: 'text-amber-800' },
    { value: 'reviewed', label: 'Revisadas', count: reviewedCount, tone: 'text-blue-800' },
    { value: 'ok', label: 'Claras', count: okCount, tone: 'text-emerald-800' },
    { value: 'error', label: 'Errores', count: errorCount, tone: 'text-red-700' },
  ];

  return (
    <div className="space-y-5">
      {/* Tarjeta principal de avance */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <FileText className="w-3.5 h-3.5 text-blue-800 shrink-0" />
              <span className="truncate font-medium text-slate-700">{progress.fileName}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums shrink-0">{progress.totalPages} hojas</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums shrink-0">
                {aiCount === 0 ? 'Sin uso de IA' : `IA usada en ${aiCount}`}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              {progress.active
                ? `Escaneando hoja ${progress.currentPage} de ${progress.totalPages}`
                : progress.cancelled
                  ? 'Escaneo detenido por el usuario'
                  : 'Lectura del PDF completada'}
            </h2>
            <p className="text-sm text-slate-600 flex items-center gap-2">
              {progress.active && <Loader2 className="w-4 h-4 animate-spin text-blue-800 shrink-0" />}
              <span>{progress.stageLabel}</span>
            </p>
          </div>

          <div className="text-right shrink-0">
            <div className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-blue-950">
              {percent}%
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              {progress.processedPages} / {progress.totalPages} hojas
            </div>
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200"
          >
            <div
              className={`h-full transition-[width] duration-300 ease-out ${
                progress.cancelled
                  ? 'bg-amber-600'
                  : percent === 100
                    ? 'bg-emerald-600'
                    : 'bg-blue-800'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-3 tabular-nums">
              <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Claras: {okCount}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                Para revisar: {reviewCount}
              </span>
              {reviewedCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-blue-800 font-medium">
                    <Edit3 className="w-3.5 h-3.5" />
                    Revisadas: {reviewedCount}
                  </span>
                </>
              )}
              {errorCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                    <XCircle className="w-3.5 h-3.5" />
                    Errores: {errorCount}
                  </span>
                </>
              )}
            </div>

            {progress.active ? (
              <button
                type="button"
                onClick={onStopBatch}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Detener escaneo</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {canRetry && errorPages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onRetryPages(errorPages)}
                    className="min-h-[42px] px-4 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reintentar errores ({errorPages.length})</span>
                  </button>
                )}
                {nextToReview && (
                  <button
                    type="button"
                    onClick={() => onReviewSheet(nextToReview)}
                    className="min-h-[42px] px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Revisar siguiente pendiente</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onResetScanner}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  Escanear otro archivo
                </button>
                <button
                  type="button"
                  onClick={onGoConsolidated}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Ver Consolidado y Excel</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detalle hoja por hoja */}
      {progress.outcomes.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Registro de lectura hoja por hoja
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">
                Guardadas automáticamente en Fichas
              </span>
            </div>
            <div role="tablist" aria-label="Filtrar hojas" className="flex flex-wrap gap-1.5">
              {filterOptions.map((opt) => {
                const selected = filter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => onFilterChange(opt.value)}
                    className={`min-h-[34px] px-3 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      selected
                        ? 'bg-blue-900 border-blue-900 text-white'
                        : `bg-white border-slate-200 hover:bg-slate-100 ${opt.tone}`
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={`tabular-nums rounded px-1.5 ${
                        selected ? 'bg-white/20' : 'bg-slate-100'
                      }`}
                    >
                      {opt.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {visibleRows.length === 0 && (
              <p className="px-4 py-6 text-sm text-slate-500 text-center">
                No hay hojas en esta categoría.
              </p>
            )}
            {visibleRows.map(({ outcome, matchedSheet, status }) => {
              const liveScore = matchedSheet ? computeSheetScore(matchedSheet) : null;

              return (
                <div
                  key={outcome.pageNumber}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 tabular-nums shrink-0">
                      Pág. {outcome.pageNumber}
                    </span>

                    <div className="min-w-0">
                      {status === 'error' ? (
                        <>
                          <p className="text-sm font-medium text-red-800 truncate">
                            No se pudo leer esta hoja
                          </p>
                          <p className="text-xs text-red-700 truncate">{outcome.errorMessage}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {matchedSheet?.apellidosNombres ||
                              outcome.studentName ||
                              'Estudiante sin nombre / Anónimo'}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                            <span>
                              {liveScore?.answeredCount ?? outcome.answeredCount ?? 0}/16 ítems
                            </span>
                            {outcome.readBy && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{READ_BY_LABEL[outcome.readBy]}</span>
                              </>
                            )}
                            {matchedSheet?.gradoSeccion && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{matchedSheet.gradoSeccion}</span>
                              </>
                            )}
                            {status === 'review' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                                  <AlertTriangle className="w-3 h-3" />
                                  {outcome.flaggedCount} por revisar
                                </span>
                              </>
                            )}
                            {status === 'reviewed' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-blue-800 font-medium">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Revisada
                                </span>
                              </>
                            )}
                            {status === 'ok' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Lectura clara
                                </span>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {status === 'error' && canRetry && !progress.active && (
                    <button
                      type="button"
                      onClick={() => onRetryPages([outcome.pageNumber])}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reintentar</span>
                    </button>
                  )}

                  {matchedSheet && (
                    <button
                      type="button"
                      onClick={() => onReviewSheet(matchedSheet)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Revisar</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
