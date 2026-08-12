/**
 * Il contratto fra Worker e browser. Importato da entrambi, così una modifica alla
 * forma dei dati rompe la compilazione invece di rompersi in produzione.
 *
 * Nota: le chiavi di cifratura non compaiono in nessuno di questi tipi. Non attraversano
 * mai la rete, quindi non devono esistere nemmeno come possibilità nel contratto.
 */

export interface PhotoDto {
  id: string;
  /** Percorso su R2 del blob cifrato a piena dimensione. */
  key: string;
  /** Percorso su R2 della miniatura cifrata. */
  thumbKey: string;
  width: number;
  height: number;
  /** Data di scatto da EXIF, in millisecondi. null se la foto non ce l'aveva. */
  takenAt: number | null;
  sortIndex: number;
}

/** Una tappa: un magnete, un punto sulla mappa, un gruppo di foto. */
export interface StopDto {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  photos: PhotoDto[];
}

/**
 * Il viaggio con tutte le sue tappe, già in ordine cronologico.
 *
 * È la risposta di `GET /api/trips/:slug`, cioè quello che si apre toccando il magnete.
 * Solo metadati — nessuna immagine — quindi anche otto tappe restano una risposta piccola.
 */
export interface TripDto {
  slug: string;
  name: string;
  stops: StopDto[];
}

export interface CreateTripRequest {
  name: string;
}

export interface CreateTripResponse {
  slug: string;
  /** Mostrato una volta sola: finisce negli URL scritti sui tag NFC di questo viaggio. */
  writeToken: string;
}

export interface CreateStopRequest {
  name: string;
  lat: number;
  lon: number;
}

export interface CreateStopResponse {
  slug: string;
}

/** Quel che serve al menu per elencare viaggi e tappe. Nessun token, nessuna chiave. */
export interface TripSummaryDto {
  slug: string;
  name: string;
  createdAt: number;
  /**
   * La miniatura della foto più vecchia del viaggio, da usare come copertina nell'indice.
   * È un riferimento a un blob cifrato: senza la chiave del viaggio resta illeggibile,
   * quindi può viaggiare come qualsiasi altro `thumbKey`. null se il viaggio è vuoto.
   */
  coverThumbKey: string | null;
  stops: Array<{
    slug: string;
    name: string;
    photoCount: number;
    /** Miniatura della foto più vecchia della tappa, per l'anteprima nell'indice. */
    coverThumbKey: string | null;
  }>;
}

export interface RegisterPhotoRequest {
  key: string;
  thumbKey: string;
  width: number;
  height: number;
  takenAt: number | null;
}

export interface RegisterPhotoResponse {
  id: string;
  sortIndex: number;
}

export interface UploadMediaResponse {
  key: string;
}

export interface ApiError {
  error: string;
}
