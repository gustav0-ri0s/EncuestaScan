import React, { useMemo, useState } from 'react';
import { Camera, Download, Loader2, Table2 } from 'lucide-react';
import {
  DIMENSIONS,
  INDICATORS,
  SCALE_OPTIONS,
  computeConsolidatedCounts,
  type QuestionnaireSheet,
} from '../data/questionnaire';

interface ConsolidatedTableProps {
  sheets: QuestionnaireSheet[];
  isExporting: boolean;
  onExportExcel: (filteredSheets: QuestionnaireSheet[]) => void;
  onGoScan: () => void;
}

export const ConsolidatedTable: React.FC<ConsolidatedTableProps> = ({
  sheets,
  isExporting,
  onExportExcel,
  onGoScan,
}) => {
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'items' | 'dimensions'>('items');

  const availableGrades = useMemo(() => {
    const set = new Set<string>();
    for (const s of sheets) {
      const g = s.gradoSeccion.trim();
      if (g) set.add(g);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [sheets]);

  const filteredSheets = useMemo(() => {
    if (gradeFilter === 'all') return sheets;
    return sheets.filter((s) => s.gradoSeccion.trim() === gradeFilter);
  }, [sheets, gradeFilter]);

  const rows = useMemo(() => computeConsolidatedCounts(filteredSheets), [filteredSheets]);

  const totals = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalMarks = 0;
    let weightedSum = 0;
    for (const r of rows) {
      counts[1] += r.counts[1];
      counts[2] += r.counts[2];
      counts[3] += r.counts[3];
      counts[4] += r.counts[4];
      counts[5] += r.counts[5];
      totalMarks += r.total;
      weightedSum += r.average * r.total;
    }
    const expectedMarks = filteredSheets.length * 16;
    const completeness = expectedMarks > 0 ? Math.round((totalMarks / expectedMarks) * 100) : 0;
    const globalAvg = totalMarks > 0 ? weightedSum / totalMarks : 0;
    return { counts, totalMarks, completeness, globalAvg };
  }, [rows, filteredSheets.length]);

  if (sheets.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto">
          <Table2 className="w-6 h-6 text-slate-600" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h2 className="text-lg font-semibold text-slate-900">
            Aún no hay cuestionarios registrados
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Escanea la primera hoja con la cámara o sube fotografías para ver aquí la tabla
            consolidada por Dimensión, Indicador e Ítem lista para exportar a Excel.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoScan}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Camera className="w-4 h-4" />
          <span>Escanear primera ficha</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 4 métricas clave en fila horizontal limpia */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Fichas incluidas</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {filteredSheets.length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total marcas (X)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {totals.totalMarks}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Promedio escala (1–5)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {totals.globalAvg.toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Completitud</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {totals.completeness}%
          </p>
        </div>
      </div>

      {/* Barra de herramientas del consolidado */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('items')}
              className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'items' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Tabla por Ítem (Formato PDF)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('dimensions')}
              className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'dimensions' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Resumen por Dimensión
            </button>
          </div>

          {availableGrades.length > 0 && (
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              aria-label="Filtrar por grado y sección"
              className="min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">Todos los grados ({sheets.length})</option>
              {availableGrades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          disabled={isExporting || filteredSheets.length === 0}
          onClick={() => onExportExcel(filteredSheets)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          {isExporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span>Descargar Excel (.xlsx)</span>
        </button>
      </div>

      {/* Tabla principal réplica exacta del PDF */}
      {viewMode === 'items' ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[880px]">
              <thead>
                <tr className="bg-blue-950 text-white text-xs">
                  <th className="py-3 px-3 font-semibold border-r border-blue-900 w-36">
                    Dimensión
                  </th>
                  <th className="py-3 px-3 font-semibold border-r border-blue-900 w-44">
                    Indicador
                  </th>
                  <th className="py-3 px-2 font-semibold border-r border-blue-900 text-center w-10">
                    N°
                  </th>
                  <th className="py-3 px-3 font-semibold border-r border-blue-900">Ítems</th>
                  {SCALE_OPTIONS.map((opt) => (
                    <th
                      key={opt.value}
                      className="py-2.5 px-2 font-semibold border-r border-blue-900 text-center w-20"
                    >
                      <div className="font-mono text-sm">{opt.value}</div>
                      <div className="text-[10px] font-normal text-blue-200">{opt.shortLabel}</div>
                    </th>
                  ))}
                  <th className="py-3 px-2 font-semibold border-r border-blue-900 text-center w-16">
                    Total
                  </th>
                  <th className="py-3 px-2 font-semibold text-center w-16">Prom.</th>
                </tr>
              </thead>
              <tbody className="text-xs sm:text-sm divide-y divide-slate-200">
                {rows.map((row, idx) => {
                  const dimDef = DIMENSIONS.find((d) => d.id === row.item.dimensionId)!;
                  const indDef = INDICATORS.find((i) => i.id === row.item.indicatorId)!;
                  const isFirstInDim = dimDef.itemNumbers[0] === row.item.number;
                  const isFirstInInd = indDef.itemNumbers[0] === row.item.number;

                  return (
                    <tr key={row.item.number} className="hover:bg-slate-50/70 transition-colors">
                      {isFirstInDim && (
                        <td
                          rowSpan={dimDef.itemNumbers.length}
                          className={`p-3 font-semibold text-center align-middle border-r border-slate-200 ${dimDef.bgClass} ${dimDef.textClass}`}
                        >
                          {dimDef.name}
                        </td>
                      )}
                      {isFirstInInd && (
                        <td
                          rowSpan={indDef.itemNumbers.length}
                          className={`p-3 font-medium text-center align-middle border-r border-slate-200 ${dimDef.bgClass} text-slate-800`}
                        >
                          {indDef.name}
                        </td>
                      )}
                      <td className="py-2.5 px-2 font-mono font-semibold text-center text-slate-900 border-r border-slate-200 tabular-nums">
                        {row.item.number}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800 border-r border-slate-200 leading-snug">
                        {row.item.text}
                      </td>
                      {SCALE_OPTIONS.map((opt) => {
                        const count = row.counts[opt.value];
                        return (
                          <td
                            key={opt.value}
                            className={`py-2.5 px-2 text-center font-mono tabular-nums border-r border-slate-200 ${
                              count > 0
                                ? 'font-semibold text-slate-900 bg-blue-50/40'
                                : 'text-slate-400'
                            }`}
                          >
                            {count}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-2 text-center font-mono font-semibold tabular-nums text-slate-900 border-r border-slate-200">
                        {row.total}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono tabular-nums text-slate-700">
                        {row.average.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 text-xs sm:text-sm font-semibold text-slate-900">
                  <td colSpan={4} className="py-3 px-4 text-right border-r border-slate-200">
                    TOTAL DE MARCAS REGISTRADAS
                  </td>
                  {SCALE_OPTIONS.map((opt) => (
                    <td
                      key={opt.value}
                      className="py-3 px-2 text-center font-mono tabular-nums border-r border-slate-200"
                    >
                      {totals.counts[opt.value]}
                    </td>
                  ))}
                  <td className="py-3 px-2 text-center font-mono tabular-nums border-r border-slate-200">
                    {totals.totalMarks}
                  </td>
                  <td className="py-3 px-2 text-center font-mono tabular-nums">
                    {totals.globalAvg.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        /* Vista agrupada por Dimensión e Indicador */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[760px]">
              <thead>
                <tr className="bg-blue-950 text-white text-xs">
                  <th className="py-3 px-3 font-semibold border-r border-blue-900">Dimensión</th>
                  <th className="py-3 px-3 font-semibold border-r border-blue-900">Indicador</th>
                  {SCALE_OPTIONS.map((opt) => (
                    <th
                      key={opt.value}
                      className="py-2.5 px-2 font-semibold border-r border-blue-900 text-center w-24"
                    >
                      {opt.value} · {opt.shortLabel}
                    </th>
                  ))}
                  <th className="py-3 px-2 font-semibold border-r border-blue-900 text-center w-20">
                    Total
                  </th>
                  <th className="py-3 px-2 font-semibold text-center w-20">Prom.</th>
                </tr>
              </thead>
              <tbody className="text-xs sm:text-sm divide-y divide-slate-200">
                {DIMENSIONS.map((dim) => {
                  const dimIndicators = INDICATORS.filter((i) => i.dimensionId === dim.id);
                  const dimRows = rows.filter((r) => r.item.dimensionId === dim.id);
                  const dCounts = {
                    1: dimRows.reduce((s, r) => s + r.counts[1], 0),
                    2: dimRows.reduce((s, r) => s + r.counts[2], 0),
                    3: dimRows.reduce((s, r) => s + r.counts[3], 0),
                    4: dimRows.reduce((s, r) => s + r.counts[4], 0),
                    5: dimRows.reduce((s, r) => s + r.counts[5], 0),
                  };
                  const dTot =
                    dCounts[1] + dCounts[2] + dCounts[3] + dCounts[4] + dCounts[5];
                  const dAvg =
                    dTot > 0
                      ? (dCounts[1] +
                          dCounts[2] * 2 +
                          dCounts[3] * 3 +
                          dCounts[4] * 4 +
                          dCounts[5] * 5) /
                        dTot
                      : 0;

                  return (
                    <React.Fragment key={dim.id}>
                      {dimIndicators.map((ind, idx) => {
                        const indRows = rows.filter((r) => r.item.indicatorId === ind.id);
                        const c = {
                          1: indRows.reduce((s, r) => s + r.counts[1], 0),
                          2: indRows.reduce((s, r) => s + r.counts[2], 0),
                          3: indRows.reduce((s, r) => s + r.counts[3], 0),
                          4: indRows.reduce((s, r) => s + r.counts[4], 0),
                          5: indRows.reduce((s, r) => s + r.counts[5], 0),
                        };
                        const tot = c[1] + c[2] + c[3] + c[4] + c[5];
                        const avg =
                          tot > 0
                            ? (c[1] + c[2] * 2 + c[3] * 3 + c[4] * 4 + c[5] * 5) / tot
                            : 0;

                        return (
                          <tr key={ind.id} className="hover:bg-slate-50/70">
                            {idx === 0 && (
                              <td
                                rowSpan={dimIndicators.length}
                                className={`p-3 font-semibold text-center align-middle border-r border-slate-200 ${dim.bgClass} ${dim.textClass}`}
                              >
                                {dim.name}
                              </td>
                            )}
                            <td className="py-2.5 px-3 text-slate-800 border-r border-slate-200">
                              {ind.name}
                            </td>
                            {SCALE_OPTIONS.map((opt) => (
                              <td
                                key={opt.value}
                                className="py-2.5 px-2 text-center font-mono tabular-nums border-r border-slate-200 text-slate-900"
                              >
                                {c[opt.value]}
                              </td>
                            ))}
                            <td className="py-2.5 px-2 text-center font-mono font-semibold tabular-nums border-r border-slate-200">
                              {tot}
                            </td>
                            <td className="py-2.5 px-2 text-center font-mono tabular-nums text-slate-700">
                              {avg.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-50 font-semibold text-slate-900">
                        <td colSpan={2} className="py-2.5 px-3 text-right border-r border-slate-200">
                          Subtotal · {dim.name}
                        </td>
                        {SCALE_OPTIONS.map((opt) => (
                          <td
                            key={opt.value}
                            className="py-2.5 px-2 text-center font-mono tabular-nums border-r border-slate-200"
                          >
                            {dCounts[opt.value]}
                          </td>
                        ))}
                        <td className="py-2.5 px-2 text-center font-mono tabular-nums border-r border-slate-200">
                          {dTot}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono tabular-nums">
                          {dAvg.toFixed(2)}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
