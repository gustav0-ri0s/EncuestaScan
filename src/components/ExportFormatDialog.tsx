import React, { useEffect } from 'react';
import { FileSpreadsheet, Table2, X } from 'lucide-react';

export type ExportFormat = 'consolidado' | 'resultados';

interface ExportFormatDialogProps {
  sheetCount: number;
  onChoose: (format: ExportFormat) => void;
  onClose: () => void;
}

const OPTIONS: Array<{
  value: ExportFormat;
  title: string;
  description: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'consolidado',
    title: 'Consolidado de análisis',
    description: 'El formato actual con conteos y porcentajes.',
    detail: 'Hojas: Resumen por Ítem · Resumen por Dimensión · Registro por Estudiante',
    icon: FileSpreadsheet,
  },
  {
    value: 'resultados',
    title: 'Resultados de aplicación',
    description: 'Una fila por estudiante (ID, I1–I16) con totales por dimensión y total V1.',
    detail: 'Hojas: V1 (con los datos) · V2 (con los mismos ID, lista para completar)',
    icon: Table2,
  },
];

export const ExportFormatDialog: React.FC<ExportFormatDialogProps> = ({
  sheetCount,
  onChoose,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-format-title"
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 id="export-format-title" className="text-base font-semibold text-slate-900">
              Exportar Excel
            </h2>
            <p className="text-xs text-slate-500 tabular-nums">
              {sheetCount} {sheetCount === 1 ? 'ficha' : 'fichas'} · Elige el formato del archivo
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-2.5">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChoose(opt.value)}
                className="w-full text-left rounded-xl border border-slate-200 hover:border-blue-900 hover:bg-blue-50/60 p-4 flex gap-3 transition-colors"
              >
                <Icon className="w-5 h-5 text-blue-900 shrink-0 mt-0.5" />
                <span className="space-y-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{opt.title}</span>
                  <span className="block text-xs text-slate-600">{opt.description}</span>
                  <span className="block text-[11px] text-slate-500">{opt.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
