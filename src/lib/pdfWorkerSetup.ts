import * as pdfjsLib from 'pdfjs-dist';

// Initialize and configure pdfjs worker with robust fallbacks
function initWorker() {
  if (typeof window === 'undefined') return;

  try {
    const origin = window.location && window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : '';

    if (origin && origin.startsWith('http')) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${origin}/pdf.worker.min.mjs`;
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }
  } catch (e) {
    console.warn('Falling back to CDN pdf.worker:', e);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '6.2.108'}/build/pdf.worker.min.mjs`;
  }
}

initWorker();

export function getPdfLoadOptions(data: Uint8Array | ArrayBuffer) {
  const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const origin =
    typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : '';

  return {
    data: uint8,
    cMapUrl: origin ? `${origin}/cmaps/` : '/cmaps/',
    cMapPacked: true,
    wasmUrl: origin ? `${origin}/wasm/` : '/wasm/',
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '6.2.108'}/standard_fonts/`,
  };
}

export { pdfjsLib };
