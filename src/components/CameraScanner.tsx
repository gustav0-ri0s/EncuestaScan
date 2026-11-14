import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  FileText,
  FileUp,
  Flashlight,
  FlashlightOff,
  Loader2,
  PenLine,
  RefreshCw,
  SwitchCamera,
} from 'lucide-react';
import { fileToDataUrl } from '../utils/imageEnhancer';

interface CameraScannerProps {
  isProcessing: boolean;
  queueStatus: string | null;
  errorMessage: string | null;
  onCaptureDataUrl: (dataUrl: string, source: 'camera' | 'upload') => void;
  onUploadFiles: (dataUrls: string[]) => void;
  onUploadPdf: (file: File) => void;
  onStartManual: () => void;
  onDismissError: () => void;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  isProcessing,
  queueStatus,
  errorMessage,
  onCaptureDataUrl,
  onUploadFiles,
  onUploadPdf,
  onStartManual,
  onDismissError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'error' | 'paused'>(
    'starting'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setTorchEnabled(false);
    setTorchSupported(false);
  };

  const startCamera = async (mode: 'environment' | 'user') => {
    stopStream();
    setCameraState('starting');
    setCameraError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('error');
      setCameraError(
        'Este navegador no permite acceso directo a la cámara. Puedes subir una foto o escaneo desde tu dispositivo.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Verificar soporte de linterna (torch) en dispositivos móviles
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & {
          torch?: boolean;
        };
        setTorchSupported(Boolean(caps.torch));
      }

      setCameraState('active');
    } catch (err) {
      console.error('Error al iniciar cámara:', err);
      setCameraState('error');
      setCameraError(
        'No se pudo acceder a la cámara. Verifica los permisos del navegador o sube una fotografía del cuestionario.'
      );
    }
  };

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [facingMode]);

  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchEnabled(next);
    } catch (err) {
      console.warn('No se pudo alternar el flash:', err);
    }
  };

  const handleCapturePhoto = () => {
    if (!videoRef.current || cameraState !== 'active' || isProcessing) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    onCaptureDataUrl(dataUrl, 'camera');
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const list = Array.from(files);
      const pdfFile = list.find(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (pdfFile) {
        onUploadPdf(pdfFile);
        return;
      }
      const urls = await Promise.all(list.map((f) => fileToDataUrl(f)));
      onUploadFiles(urls);
    } catch (err) {
      console.error(err);
    } finally {
      e.target.value = '';
    }
  };

  const handlePdfSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadPdf(file);
    }
    e.target.value = '';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Visor de cámara / captura */}
      <div className="lg:col-span-7 bg-slate-950 rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative">
        <div className="relative w-full aspect-[3/4] sm:aspect-[4/3] lg:aspect-[4/3] bg-slate-950 flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover ${
              cameraState === 'active' ? 'opacity-100' : 'opacity-0'
            } transition-opacity duration-200`}
          />

          {/* Guía visual de encuadre A4 */}
          {cameraState === 'active' && !isProcessing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-8">
              <div className="relative w-full max-w-[380px] aspect-[3/4] max-h-full border border-white/40 rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.42)]">
                {/* Esquinas de alineación */}
                <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-[3px] border-l-[3px] border-white rounded-tl-md" />
                <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-[3px] border-r-[3px] border-white rounded-tr-md" />
                <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-[3px] border-l-[3px] border-white rounded-bl-md" />
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-[3px] border-r-[3px] border-white rounded-br-md" />

                <div className="absolute inset-x-0 bottom-3 flex justify-center px-2">
                  <span className="bg-slate-950/75 text-white text-xs font-medium px-2.5 py-1 rounded">
                    Encuadra los 16 ítems y columnas 1–5
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Controles superiores flotantes dentro del visor */}
          {cameraState === 'active' && (
            <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
              {torchSupported && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-900/75 text-white hover:bg-slate-900 border border-white/15 transition-colors"
                  aria-label={torchEnabled ? 'Apagar flash' : 'Encender flash'}
                  title={torchEnabled ? 'Apagar flash' : 'Encender flash'}
                >
                  {torchEnabled ? (
                    <Flashlight className="w-5 h-5 text-amber-300" />
                  ) : (
                    <FlashlightOff className="w-5 h-5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                }
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-900/75 text-white hover:bg-slate-900 border border-white/15 transition-colors"
                aria-label="Cambiar cámara"
                title="Cambiar cámara"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Estado iniciando */}
          {cameraState === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300 p-6 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-white" />
              <p className="text-sm font-medium">Activando cámara del dispositivo...</p>
            </div>
          )}

          {/* Estado error / sin permisos */}
          {cameraState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-slate-200 p-6 text-center bg-slate-900">
              <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                <Camera className="w-6 h-6 text-slate-300" />
              </div>
              <div className="max-w-sm space-y-1.5">
                <p className="text-sm font-semibold text-white">Cámara no disponible</p>
                <p className="text-xs text-slate-300 leading-relaxed">{cameraError}</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium inline-flex items-center gap-2 border border-slate-700 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reintentar cámara
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <FileUp className="w-4 h-4" />
                  Subir foto o escaneo
                </button>
              </div>
            </div>
          )}

          {/* Overlay de procesamiento */}
          {isProcessing && (
            <div className="absolute inset-0 z-20 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
              <Loader2 className="w-9 h-9 animate-spin text-blue-400" />
              <div className="space-y-1 max-w-xs">
                <p className="text-sm font-semibold">
                  {queueStatus ?? 'Analizando cuestionario...'}
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Aplicando realce de contraste adaptativo para detectar marcas X tenues en los
                  16 ítems.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Barra inferior de disparo y carga */}
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <FileUp className="w-4 h-4" />
            <span>Subir imágenes</span>
          </button>

          <button
            type="button"
            disabled={cameraState !== 'active' || isProcessing}
            onClick={handleCapturePhoto}
            className="min-h-[48px] px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Camera className="w-4 h-4" />
            <span>Escanear hoja</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={onStartManual}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <PenLine className="w-4 h-4" />
            <span className="hidden sm:inline">Manual</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handlePdfSelected}
          />
        </div>
      </div>

      {/* Panel lateral de instrucciones prácticas */}
      <div className="lg:col-span-5 space-y-5">
        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-red-900">Error al procesar imagen</p>
              <p className="text-xs text-red-800 leading-relaxed">{errorMessage}</p>
              <button
                type="button"
                onClick={onDismissError}
                className="text-xs font-medium text-red-900 underline mt-1"
              >
                Cerrar aviso
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Subir PDF con todas las fichas escaneadas
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Si ya tienes un archivo PDF de varias páginas, súbelo aquí para leerlo hoja por hoja
              con porcentaje de avance automático y realce de marcas tenues.
            </p>
          </div>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => pdfInputRef.current?.click()}
            className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <FileText className="w-4 h-4" />
            <span>Subir PDF multipágina (.pdf)</span>
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Escaneo de marcas tenues y hojas de baja calidad
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              El sistema normaliza automáticamente sombras e iluminación antes de leer cada una de
              las 16 filas (columnas 1 al 5) y los datos del estudiante.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500">
              Recomendaciones para mejor precisión
            </h3>
            <ul className="space-y-2.5 text-sm text-slate-700">
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                  01
                </span>
                <span>
                  Alinea la hoja completa dentro del recuadro para incluir cabecera y los ítems 1 al
                  16.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                  02
                </span>
                <span>
                  Si la hoja fue escaneada en baja calidad o con lápiz muy claro, el realce
                  adaptativo resaltará la X en la pantalla de verificación para que la confirmes.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="font-mono text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                  03
                </span>
                <span>
                  Puedes subir un <strong>PDF completo</strong> o varias fotos con{' '}
                  <strong>Subir imágenes</strong> para procesarlas hoja por hoja automáticamente.
                </span>
              </li>
            </ul>
          </div>

          <div className="border-t border-slate-100 pt-4 flex items-center justify-between text-xs text-slate-500">
            <span>Escala: 1 Nunca · 2 Casi nunca · 3 A veces · 4 Casi siempre · 5 Siempre</span>
          </div>
        </div>
      </div>
    </div>
  );
};
