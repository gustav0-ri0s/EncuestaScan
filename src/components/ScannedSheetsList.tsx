import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, Download, Edit3, Loader2, Search, Trash2, Upload, Users } from 'lucide-react';
import { computeSheetScore, type QuestionnaireSheet } from '../data/questionnaire';
import { downloadBackup, readBackupFile } from '../utils/backup';

interface ScannedSheetsListProps {
  sheets: QuestionnaireSheet[];
  onEditSheet: (sheet: QuestionnaireSheet) => void;
  onDeleteSheet: (id: string) => void;
  onClearAll: () => void;
  onGoScan: () => void;
  onImportSheets: (sheets: QuestionnaireSheet[]) => void;
}

export const ScannedSheetsList: React.FC<ScannedSheetsListProps> = ({
  sheets,
  onEditSheet,
  onDeleteSheet,
  onClearAll,
  onGoScan,
  onImportSheets,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      onImportSheets(await readBackupFile(file));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'No se pudo importar el respaldo.');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const importControls = (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => handleImportFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={importing}
        onClick={() => importInputRef.current?.click()}
        title="Cargar fichas desde un archivo de respaldo (.json)"
        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
      >
        {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        <span>Importar respaldo</span>
      </button>
    </>
  );

  const importErrorBanner = importError && (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800 flex items-start gap-2 text-left"
    >
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{importError}</span>
    </div>
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sheets;
    return sheets.filter(
      (s) =>
        s.apellidosNombres.toLowerCase().includes(q) ||
        s.gradoSeccion.toLowerCase().includes(q) ||
        s.fecha.toLowerCase().includes(q)
    );
  }, [sheets, searchQuery]);

  if (sheets.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto">
          <Users className="w-6 h-6 text-slate-600" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h2 className="text-lg font-semibold text-slate-900">
            Sin fichas individuales registradas
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Cada cuestionario escaneado y confirmado aparecerá aquí para que puedas revisarlo,
            corregir cualquier respuesta o eliminarlo.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onGoScan}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Camera className="w-4 h-4" />
            <span>Escanear ficha</span>
          </button>
          {importControls}
        </div>
        <p className="text-xs text-slate-500">
          ¿Vienes de otra computadora? Importa el archivo de respaldo (.json) que exportaste allí.
        </p>
        {importErrorBanner}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por estudiante, grado o fecha..."
            className="w-full min-h-[42px] pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadBackup(sheets)}
            title="Descargar todas las fichas en un archivo para llevarlas a otra computadora"
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar respaldo</span>
          </button>
          {importControls}
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Vaciar lista</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
              <span className="text-xs font-medium text-red-900">¿Eliminar todas?</span>
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setConfirmClear(false);
                }}
                className="px-2.5 py-1 rounded-lg bg-red-700 text-white text-xs font-semibold hover:bg-red-800"
              >
                Sí, vaciar
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-medium"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {importErrorBanner}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 w-14 text-center">N°</th>
                <th className="py-3 px-4">Estudiante</th>
                <th className="py-3 px-4 w-32">Grado / Sec.</th>
                <th className="py-3 px-4 w-28">Fecha</th>
                <th className="py-3 px-3 w-28 text-center">Completitud</th>
                <th className="py-3 px-3 w-24 text-center">Puntaje</th>
                <th className="py-3 px-4 w-32 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((sheet, index) => {
                const score = computeSheetScore(sheet);
                return (
                  <tr key={sheet.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-xs text-slate-500 tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {sheet.thumbnailDataUrl && (
                          <img
                            src={sheet.thumbnailDataUrl}
                            alt={`Miniatura de ${sheet.apellidosNombres || 'ficha'}`}
                            referrerPolicy="no-referrer"
                            className="w-9 h-11 object-cover rounded border border-slate-200 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">
                            {sheet.apellidosNombres || 'Sin nombre / Anónimo'}
                          </p>
                          <p className="text-xs text-slate-500">
                            {sheet.sourceMode === 'camera'
                              ? 'Cámara'
                              : sheet.sourceMode === 'pdf'
                                ? `PDF${sheet.sourcePage ? ` · Pág. ${sheet.sourcePage}` : ''}`
                                : sheet.sourceMode === 'upload'
                                  ? 'Imagen subida'
                                  : 'Manual'}
                            {' · '}
                            {new Date(sheet.scannedAt).toLocaleTimeString('es-PE', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{sheet.gradoSeccion || '—'}</td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-xs tabular-nums">
                      {sheet.fecha || '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-xs tabular-nums">
                      <span
                        className={
                          score.answeredCount === 16
                            ? 'text-emerald-700 font-semibold'
                            : 'text-amber-700 font-semibold'
                        }
                      >
                        {score.answeredCount}/16
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-semibold text-slate-900 tabular-nums">
                      {score.totalScore}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEditSheet(sheet)}
                          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-700"
                          title="Ver o editar respuestas"
                          aria-label="Ver o editar respuestas"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSheet(sheet.id)}
                          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-700"
                          title="Eliminar ficha"
                          aria-label="Eliminar ficha"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
