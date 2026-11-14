import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Eye,
  Filter,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DIMENSIONS,
  QUESTIONNAIRE_ITEMS,
  SCALE_OPTIONS,
  type ConfidenceLevel,
  type RatingValue,
  type ScanApiResponse,
  type ScannedItemResult,
} from '../data/questionnaire';
import { mergeItemsWithAi } from '../utils/omrReader';

export interface VerifierDraft {
  id?: string;
  apellidosNombres: string;
  gradoSeccion: string;
  fecha: string;
  answers: Record<number, RatingValue | null>;
  confidences: Record<number, ConfidenceLevel>;
  observations: Record<number, string>;
  originalDataUrl?: string;
  enhancedDataUrl?: string;
  thumbnailDataUrl?: string;
  qualityNote?: string;
  sourceMode: 'camera' | 'upload' | 'pdf' | 'manual';
  sourceFileName?: string;
  sourcePage?: number;
}

interface ScanVerifierProps {
  draft: VerifierDraft;
  queueInfo?: { current: number; total: number } | null;
  onSave: (draft: VerifierDraft) => void;
  onCancel: () => void;
  /** Envía la hoja a la IA; si no se pasa, el botón no se muestra */
  onAskAi?: (draft: VerifierDraft) => Promise<ScanApiResponse>;
}

export const ScanVerifier: React.FC<ScanVerifierProps> = ({
  draft,
  queueInfo,
  onSave,
  onCancel,
  onAskAi,
}) => {
  const [apellidosNombres, setApellidosNombres] = useState(draft.apellidosNombres);
  const [gradoSeccion, setGradoSeccion] = useState(draft.gradoSeccion);
  const [fecha, setFecha] = useState(draft.fecha);
  const [answers, setAnswers] = useState<Record<number, RatingValue | null>>(draft.answers);
  const [confidences, setConfidences] = useState<Record<number, ConfidenceLevel>>(
    draft.confidences
  );
  const [observations, setObservations] = useState<Record<number, string>>(draft.observations);
  const [aiState, setAiState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'done'; message: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' });
  const [imageMode, setImageMode] = useState<'enhanced' | 'original'>(
    draft.enhancedDataUrl ? 'enhanced' : 'original'
  );
  const [zoom, setZoom] = useState<number>(1);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [mobileView, setMobileView] = useState<'form' | 'image'>('form');

  const hasImage = Boolean(draft.originalDataUrl || draft.enhancedDataUrl);
  // Solo hay imagen completa durante la sesión; tras recargar queda solo la miniatura
  const canAskAi = Boolean(onAskAi && draft.originalDataUrl && draft.enhancedDataUrl);

  const stats = useMemo(() => {
    let answered = 0;
    let flagged = 0;
    for (const item of QUESTIONNAIRE_ITEMS) {
      const val = answers[item.number];
      const conf = confidences[item.number] ?? 'alta';
      if (val !== null && val !== undefined) answered++;
      if (val === null || val === undefined || conf !== 'alta') flagged++;
    }
    return { answered, flagged };
  }, [answers, confidences]);

  const handleSelectRating = (itemNumber: number, val: RatingValue) => {
    setAnswers((prev) => ({
      ...prev,
      [itemNumber]: prev[itemNumber] === val ? null : val,
    }));
  };

  const handleAskAi = async () => {
    if (!onAskAi || aiState.status === 'loading') return;
    setAiState({ status: 'loading' });
    try {
      const ai = await onAskAi(draft);

      const current: ScannedItemResult[] = QUESTIONNAIRE_ITEMS.map((item) => ({
        itemNumber: item.number,
        selectedValue: answers[item.number] ?? null,
        confidence: confidences[item.number] ?? 'alta',
        observation: observations[item.number] ?? '',
      }));
      const merged = mergeItemsWithAi(current, ai.items, 'Lectura anterior');

      const nextAnswers = { ...answers };
      const nextConfidences = { ...confidences };
      const nextObservations: Record<number, string> = {};
      let changed = 0;
      let stillDoubtful = 0;
      for (const item of merged) {
        if (nextAnswers[item.itemNumber] !== item.selectedValue) changed++;
        nextAnswers[item.itemNumber] = item.selectedValue;
        nextConfidences[item.itemNumber] = item.confidence;
        if (item.observation) nextObservations[item.itemNumber] = item.observation;
        if (item.selectedValue === null || item.confidence !== 'alta') stillDoubtful++;
      }

      setAnswers(nextAnswers);
      setConfidences(nextConfidences);
      setObservations(nextObservations);
      // La IA también lee los datos manuscritos; solo se completan los campos vacíos
      if (!apellidosNombres.trim() && ai.apellidosNombres) setApellidosNombres(ai.apellidosNombres);
      if (!gradoSeccion.trim() && ai.gradoSeccion) setGradoSeccion(ai.gradoSeccion);
      if (!fecha.trim() && ai.fecha) setFecha(ai.fecha);

      const changedText = `${changed} ${changed === 1 ? 'ítem cambiado' : 'ítems cambiados'}`;
      setOnlyFlagged(stillDoubtful > 0);
      setAiState({
        status: 'done',
        message:
          stillDoubtful === 0
            ? `La IA confirmó la hoja: los 16 ítems quedaron claros (${changedText}).`
            : `La IA revisó la hoja (${changedText}); ${stillDoubtful} ${
                stillDoubtful === 1 ? 'sigue' : 'siguen'
              } por revisar a mano.`,
      });
    } catch (err) {
      setAiState({
        status: 'error',
        message: err instanceof Error ? err.message : 'No se pudo revisar la hoja con la IA.',
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...draft,
      apellidosNombres: apellidosNombres.trim(),
      gradoSeccion: gradoSeccion.trim(),
      fecha: fecha.trim(),
      answers,
      confidences,
      observations,
    });
  };

  const displayedImageUrl =
    imageMode === 'enhanced' && draft.enhancedDataUrl
      ? draft.enhancedDataUrl
      : draft.originalDataUrl || draft.enhancedDataUrl;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-24 lg:pb-8">
      {/* Cabecera de contexto de verificación */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3.5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{draft.id ? 'Editando ficha guardada' : 'Verificación de lectura'}</span>
            {queueInfo && queueInfo.total > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-blue-800">
                  Hoja {queueInfo.current} de {queueInfo.total} en cola
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums font-medium text-slate-700">
              {stats.answered}/16 respondidos
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">
            Confirma los datos y las marcas (X) detectadas
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {hasImage && (
            <div className="lg:hidden flex items-center bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setMobileView('form')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                  mobileView === 'form' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Respuestas
              </button>
              <button
                type="button"
                onClick={() => setMobileView('image')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors inline-flex items-center gap-1.5 ${
                  mobileView === 'image' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Ver hoja
              </button>
            </div>
          )}

          {onAskAi && (
            <button
              type="button"
              onClick={handleAskAi}
              disabled={!canAskAi || aiState.status === 'loading'}
              title={
                canAskAi
                  ? 'Enviar la hoja a la IA para resolver los ítems dudosos'
                  : 'La imagen completa ya no está disponible (se recargó la página). Vuelve a escanear la hoja.'
              }
              className="min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {aiState.status === 'loading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{aiState.status === 'loading' ? 'Revisando con IA...' : 'Revisar con IA'}</span>
            </button>
          )}

          {stats.flagged > 0 && (
            <button
              type="button"
              onClick={() => setOnlyFlagged((prev) => !prev)}
              className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                onlyFlagged
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Por revisar ({stats.flagged})</span>
            </button>
          )}
        </div>
      </div>

      {(aiState.status === 'done' || aiState.status === 'error') && (
        <div
          role="status"
          className={`rounded-xl px-4 py-2.5 text-xs border flex items-start gap-2 ${
            aiState.status === 'done'
              ? 'bg-violet-50 border-violet-200 text-violet-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {aiState.status === 'done' ? (
            <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          )}
          <span>{aiState.message}</span>
        </div>
      )}

      {draft.qualityNote && (
        <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-700">
          <span className="font-semibold text-slate-900">Nota de escaneo: </span>
          {draft.qualityNote}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Columna izquierda: Visor de hoja original vs realzada */}
        {hasImage && (
          <div
            className={`lg:col-span-5 lg:sticky lg:top-20 bg-white rounded-2xl border border-slate-200 overflow-hidden ${
              mobileView === 'image' ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
              <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
                <button
                  type="button"
                  disabled={!draft.enhancedDataUrl}
                  onClick={() => setImageMode('enhanced')}
                  className={`min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    imageMode === 'enhanced'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Realzado (Alto contraste)
                </button>
                <button
                  type="button"
                  disabled={!draft.originalDataUrl}
                  onClick={() => setImageMode('original')}
                  className={`min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    imageMode === 'original'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Original
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(1, Number((z - 0.4).toFixed(1))))}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  title="Alejar"
                  aria-label="Alejar imagen"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="font-mono text-xs tabular-nums text-slate-600 px-1.5">
                  {zoom.toFixed(1)}x
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.6, Number((z + 0.4).toFixed(1))))}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                  title="Acercar"
                  aria-label="Acercar imagen"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                {zoom > 1 && (
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    title="Restablecer zoom"
                    aria-label="Restablecer zoom"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[65vh] lg:max-h-[72vh] overflow-auto bg-slate-900 p-2">
              {displayedImageUrl && (
                <img
                  src={displayedImageUrl}
                  alt="Hoja escaneada del cuestionario"
                  referrerPolicy="no-referrer"
                  style={{
                    width: `${zoom * 100}%`,
                    maxWidth: 'none',
                  }}
                  className="rounded border border-slate-700 mx-auto block"
                />
              )}
            </div>
          </div>
        )}

        {/* Columna derecha: Datos del estudiante y matriz de 16 ítems */}
        <div
          className={`${hasImage ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-5 ${
            mobileView === 'image' && hasImage ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Datos del estudiante */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Datos del estudiante</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Apellidos y nombres
                </label>
                <input
                  type="text"
                  value={apellidosNombres}
                  onChange={(e) => setApellidosNombres(e.target.value)}
                  placeholder="Ej. Pérez García, Juan (o Anónimo)"
                  className="w-full min-h-[44px] px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Grado y sección
                </label>
                <input
                  type="text"
                  value={gradoSeccion}
                  onChange={(e) => setGradoSeccion(e.target.value)}
                  placeholder="Ej. 4° A"
                  className="w-full min-h-[44px] px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                <input
                  type="text"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  placeholder="Ej. 13/11/2026"
                  className="w-full min-h-[44px] px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          </div>

          {/* Lista de ítems agrupados por dimensión */}
          <div className="space-y-4">
            {DIMENSIONS.map((dim) => {
              const dimItems = QUESTIONNAIRE_ITEMS.filter((item) => {
                if (item.dimensionId !== dim.id) return false;
                if (!onlyFlagged) return true;
                const val = answers[item.number];
                const conf = confidences[item.number] ?? 'alta';
                return val === null || val === undefined || conf !== 'alta';
              });

              if (dimItems.length === 0) return null;

              return (
                <div
                  key={dim.id}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
                >
                  <div className={`px-4 py-3 border-b border-slate-200 ${dim.bgClass}`}>
                    <h3 className={`text-sm font-semibold ${dim.textClass}`}>{dim.name}</h3>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {dimItems.map((item) => {
                      const selected = answers[item.number] ?? null;
                      const conf = confidences[item.number] ?? 'alta';
                      const obs = observations[item.number];
                      const needsReview = selected === null || conf !== 'alta';

                      return (
                        <div
                          key={item.number}
                          className={`p-4 space-y-3 ${
                            needsReview ? 'bg-amber-50/40' : 'bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span className="font-mono font-semibold text-slate-900">
                                  Ítem {item.number}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{item.indicatorName}</span>
                              </div>
                              <p className="text-sm text-slate-900 leading-snug">{item.text}</p>
                            </div>

                            {needsReview && (
                              <div className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                                <span>{selected === null ? 'Sin marca' : 'Revisar'}</span>
                              </div>
                            )}
                          </div>

                          {obs && (
                            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                              {obs}
                            </p>
                          )}

                          {/* Botones táctiles 1 - 5 */}
                          <div className="grid grid-cols-5 gap-2">
                            {SCALE_OPTIONS.map((opt) => {
                              const isSelected = selected === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => handleSelectRating(item.number, opt.value)}
                                  className={`min-h-[46px] rounded-xl border text-center px-1 py-1.5 flex flex-col items-center justify-center transition-colors ${
                                    isSelected
                                      ? 'bg-blue-900 border-blue-900 text-white shadow-xs'
                                      : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
                                  }`}
                                >
                                  <span className="font-mono text-sm font-semibold tabular-nums flex items-center gap-1">
                                    {opt.value}
                                    {isSelected && <Check className="w-3.5 h-3.5" />}
                                  </span>
                                  <span
                                    className={`text-[10px] leading-tight mt-0.5 truncate max-w-full ${
                                      isSelected ? 'text-blue-100' : 'text-slate-500'
                                    }`}
                                  >
                                    {opt.shortLabel}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Barra de confirmación */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span>Descartar</span>
            </button>

            <button
              type="submit"
              className="min-h-[46px] px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-xs whitespace-nowrap shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>
                {queueInfo && queueInfo.current < queueInfo.total
                  ? `Guardar y continuar (${stats.answered}/16)`
                  : `Guardar ficha (${stats.answered}/16)`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
