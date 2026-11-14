import type { ScanApiResponse, ScannedItemResult } from '../data/questionnaire';
import { readAnswerGrid, rgbaToGray, type OmrResult } from './omrCore';

/**
 * Modo de lectura de las hojas:
 * - local: solo lectura óptica en el navegador (gratis, sin límites, sin conexión)
 * - hybrid: lectura local y la IA solo para hojas dudosas o que no se pudieron ubicar
 * - ai: todas las hojas con la IA (consume cuota de la API)
 */
export type ScanMode = 'local' | 'hybrid' | 'ai';

export type ReadBy = 'local' | 'ia' | 'local+ia';

export async function readSheetLocally(dataUrl: string): Promise<OmrResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('No se pudo leer la imagen para la lectura local.'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo para la lectura local.');
  }
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  return readAnswerGrid(rgbaToGray(data, img.width, img.height));
}

export function isLocalReadClear(omr: OmrResult): boolean {
  return omr.ok && omr.items.every((i) => i.confidence === 'alta' && i.selectedValue !== null);
}

export function payloadFromLocal(omr: OmrResult, note?: string): ScanApiResponse {
  return {
    apellidosNombres: '',
    gradoSeccion: '',
    fecha: '',
    qualityNote: note ?? 'Lectura óptica local (sin IA).',
    items: omr.items,
  };
}

/**
 * Combina la lectura local con la de la IA. Cuando la lectura local es de
 * confianza alta y la IA coincide, se confirma; si no coinciden, se marca para revisión.
 */
export function mergeLocalAndAi(omr: OmrResult, ai: ScanApiResponse): ScanApiResponse {
  if (!omr.ok) return ai;
  return { ...ai, items: mergeItemsWithAi(omr.items, ai.items) };
}

/** Combina ítem por ítem una lectura previa (local o ya revisada) con la de la IA */
export function mergeItemsWithAi(
  previous: ScannedItemResult[],
  aiItems: ScannedItemResult[],
  previousLabel = 'Lectura local'
): ScannedItemResult[] {
  return previous.map((local) => {
    const fromAi = aiItems.find((i) => i.itemNumber === local.itemNumber);
    if (!fromAi) return local;

    const agree = fromAi.selectedValue === local.selectedValue;
    const describe = (v: number | null) => (v === null ? 'sin marca' : `columna ${v}`);

    if (local.confidence === 'alta') {
      return agree
        ? local
        : {
            ...local,
            confidence: 'media',
            observation: `${previousLabel}: ${describe(local.selectedValue)} · IA: ${describe(fromAi.selectedValue)}`,
          };
    }

    if (agree) {
      return local.selectedValue !== null && fromAi.confidence === 'alta'
        ? { ...fromAi, observation: '' }
        : fromAi;
    }

    // La lectura anterior era muy dudosa (vacía, doble marca, trazo casi invisible): se acepta la IA segura
    if (local.confidence === 'baja' && fromAi.confidence === 'alta') {
      return {
        ...fromAi,
        observation: `Resuelto por IA (${previousLabel.toLowerCase()}: ${describe(local.selectedValue)})`,
      };
    }

    return {
      ...fromAi,
      confidence: fromAi.confidence === 'alta' ? 'media' : fromAi.confidence,
      observation: [fromAi.observation, `${previousLabel}: ${describe(local.selectedValue)}`]
        .filter(Boolean)
        .join(' · '),
    };
  });
}
