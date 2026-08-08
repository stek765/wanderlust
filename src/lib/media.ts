/**
 * Da foto dell'iPhone a due immagini pronte da cifrare.
 *
 * Perché ridimensionare prima di caricare, e non dopo: una foto iPhone pesa 3-5 MB, e
 * trenta foto sono oltre cento megabyte spediti da un telefono in 4G. Ridotte a 1600px
 * di lato lungo scendono sotto i 400 KB senza differenza visibile su uno schermo, e
 * l'intero caricamento diventa questione di secondi invece di minuti.
 *
 * La miniatura è separata perché la griglia non deve mai scaricare le foto vere: con 300
 * foto in un posto è la differenza fra una pagina che si apre e una che si pianta.
 */

import exifr from 'exifr';

/** Lato lungo della versione che si vede aprendo una foto a schermo intero. */
export const FULL_MAX_EDGE = 1600;
/** Lato lungo della miniatura in griglia. 300px copre anche gli schermi a 3x. */
export const THUMB_MAX_EDGE = 300;

const QUALITY = 0.82;

export interface ProcessedImage {
  full: Blob;
  thumb: Blob;
  /** Dimensioni della versione grande, servono alla griglia per non far saltare il layout. */
  width: number;
  height: number;
  /** Data di scatto da EXIF, in millisecondi. null se la foto non ce l'ha. */
  takenAt: number | null;
}

export interface TargetSize {
  width: number;
  height: number;
}

/**
 * Riduce l'immagine perché il lato lungo non superi maxEdge, mantenendo le proporzioni.
 * Le immagini già più piccole non vengono ingrandite: allargare non aggiunge dettaglio,
 * aggiunge solo byte.
 */
export function computeTargetSize(width: number, height: number, maxEdge: number): TargetSize {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Legge la data di scatto. Torna null in tutti i casi incerti — screenshot, immagini
 * scaricate, EXIF ripulito dai social — invece di inventarsi una data plausibile: una
 * data sbagliata sposterebbe la foto nel punto sbagliato della cronologia, e nessuno
 * capirebbe perché.
 */
export async function readTakenAt(file: File): Promise<number | null> {
  try {
    const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const date = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.getTime();
  } catch {
    // Un EXIF illeggibile non è un errore: è una foto senza data.
  }
  return null;
}

/**
 * Vero se il file è HEIC/HEIF, il formato in cui l'iPhone salva le foto.
 *
 * Il tipo dichiarato dal browser non basta: molti browser su file .heic riportano
 * stringa vuota, oppure `image/heif` invece di `image/heic`. Quando il tipo non aiuta
 * si guarda l'estensione.
 */
export function looksLikeHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type.includes('heic') || type.includes('heif')) return true;
  if (type.startsWith('image/') && type !== 'image/') return false;
  return /\.hei[cf]$/i.test(file.name);
}

/**
 * Converte un HEIC in JPEG, se serve.
 *
 * Serve perché **Chrome, Brave e Firefox non sanno decodificare l'HEIC**: createImageBitmap
 * fallisce e la foto finirebbe fra quelle non caricate. Safari lo apre da solo, quindi
 * su iPhone il problema spesso non si vede — ma "spesso" non è "sempre", e le foto
 * caricate dal Mac passano quasi sempre da un browser che l'HEIC non lo sa leggere.
 *
 * Il decodificatore è un modulo WebAssembly di qualche megabyte: viene scaricato solo
 * quando incontra davvero un HEIC, non all'apertura della pagina.
 */
async function toDecodableImage(file: File): Promise<Blob> {
  if (!looksLikeHeic(file)) return file;

  const { heicTo } = await import('heic-to');
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}

/** Prepara una foto: versione grande, miniatura, dimensioni e data. */
export async function processImage(file: File): Promise<ProcessedImage> {
  // I metadati si leggono dall'originale: la conversione in JPEG non conserva l'EXIF.
  const takenAt = await readTakenAt(file);

  const decodable = await toDecodableImage(file);

  // `from-image` applica la rotazione EXIF ai pixel. Senza, le foto scattate in
  // verticale arriverebbero coricate — e la rotazione andrebbe persa comunque, visto
  // che ridisegnandole su canvas l'EXIF sparisce.
  const bitmap = await createImageBitmap(decodable, { imageOrientation: 'from-image' });

  try {
    const fullSize = computeTargetSize(bitmap.width, bitmap.height, FULL_MAX_EDGE);
    const thumbSize = computeTargetSize(bitmap.width, bitmap.height, THUMB_MAX_EDGE);

    const full = await renderToBlob(bitmap, fullSize);
    const thumb = await renderToBlob(bitmap, thumbSize);

    return { full, thumb, width: fullSize.width, height: fullSize.height, takenAt };
  } finally {
    // Le bitmap tengono memoria fuori dal garbage collector: su trenta foto di fila la
    // differenza fra chiuderle e non chiuderle è una scheda che crasha.
    bitmap.close();
  }
}

async function renderToBlob(bitmap: ImageBitmap, size: TargetSize): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas 2d non disponibile');

  context.drawImage(bitmap, 0, 0, size.width, size.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('conversione immagine fallita'))),
      'image/webp',
      QUALITY,
    );
  });
}
