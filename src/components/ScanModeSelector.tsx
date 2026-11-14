import React from 'react';
import { Cpu, Sparkles, Zap } from 'lucide-react';
import type { ScanMode } from '../utils/omrReader';

interface ScanModeSelectorProps {
  value: ScanMode;
  onChange: (mode: ScanMode) => void;
}

const OPTIONS: Array<{
  value: ScanMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'hybrid',
    label: 'Local + IA para dudosas',
    description: 'Lee las marcas en tu equipo y usa la IA solo en hojas dudosas. Recomendado.',
    icon: Zap,
  },
  {
    value: 'local',
    label: 'Solo lectura local',
    description: 'Gratis, sin límites y sin internet. Las dudas quedan para revisión manual.',
    icon: Cpu,
  },
  {
    value: 'ai',
    label: 'Solo IA',
    description: 'Cada hoja consume una solicitud de la API de Gemini. Lee también los nombres.',
    icon: Sparkles,
  },
];

export const ScanModeSelector: React.FC<ScanModeSelectorProps> = ({ value, onChange }) => (
  <fieldset className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
    <legend className="sr-only">Modo de lectura</legend>
    <p className="text-sm font-semibold text-slate-900">Modo de lectura</p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        const Icon = opt.icon;
        return (
          <label
            key={opt.value}
            className={`rounded-xl border p-3 cursor-pointer transition-colors flex gap-2.5 ${
              selected
                ? 'border-blue-900 bg-blue-50/70 ring-1 ring-blue-900'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="scan-mode"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? 'text-blue-900' : 'text-slate-500'}`} />
            <span className="space-y-0.5 min-w-0">
              <span className="block text-sm font-medium text-slate-900">{opt.label}</span>
              <span className="block text-xs text-slate-600">{opt.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);
