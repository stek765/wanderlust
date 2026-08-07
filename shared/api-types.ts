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

export interface PlaceDto {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  coverPhotoId: string | null;
  photos: PhotoDto[];
}

export interface CreatePlaceRequest {
  name: string;
  lat: number;
  lon: number;
}

export interface CreatePlaceResponse {
  slug: string;
  /** Mostrato una volta sola, alla creazione: finisce nell'URL scritto sul tag NFC. */
  writeToken: string;
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
