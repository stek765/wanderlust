/**
 * Le chiamate al Worker. Nessun altro file fa fetch verso l'API.
 *
 * Attenzione a una cosa sola: qui passano blob già cifrati e riferimenti, mai chiavi.
 * Se un giorno una funzione di questo file accettasse una CryptoKey, sarebbe il segnale
 * che qualcosa è andato storto nel design.
 */

import type {
  CreateStopRequest,
  CreateStopResponse,
  CreateTripRequest,
  CreateTripResponse,
  RegisterPhotoRequest,
  RegisterPhotoResponse,
  TripSummaryDto,
  TripDto,
  UploadMediaResponse,
} from '../../shared/api-types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `errore ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

const asJson = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

// --- Lettura -----------------------------------------------------------------

/**
 * Il viaggio con tutte le sue tappe. Non richiede token: senza chiave i riferimenti alle
 * foto sono inerti.
 */
export async function fetchTrip(tripSlug: string): Promise<TripDto> {
  return parse(await fetch(`/api/trips/${tripSlug}`));
}

/** URL da cui scaricare un blob cifrato. */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

export async function fetchEncrypted(key: string): Promise<ArrayBuffer> {
  const response = await fetch(mediaUrl(key));
  if (!response.ok) throw new ApiError(`media non trovato: ${key}`, response.status);
  return response.arrayBuffer();
}

// --- Scrittura, col token del viaggio ----------------------------------------

export async function uploadMedia(
  stopSlug: string,
  writeToken: string,
  blob: Blob,
  kind: 'full' | 'thumb',
): Promise<string> {
  const response = await fetch(`/api/stops/${stopSlug}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeToken}`, 'X-Media-Kind': kind },
    body: blob,
  });
  const body = await parse<UploadMediaResponse>(response);
  return body.key;
}

export async function registerPhoto(
  stopSlug: string,
  writeToken: string,
  photo: RegisterPhotoRequest,
): Promise<RegisterPhotoResponse> {
  return parse(
    await fetch(`/api/stops/${stopSlug}/photos`, {
      method: 'POST',
      headers: asJson(writeToken),
      body: JSON.stringify(photo),
    }),
  );
}

export async function deletePhoto(stopSlug: string, writeToken: string, photoId: string): Promise<void> {
  await parse(
    await fetch(`/api/stops/${stopSlug}/photos/${photoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${writeToken}` },
    }),
  );
}

// --- Creazione, col token master ---------------------------------------------

export async function createTrip(masterToken: string, trip: CreateTripRequest): Promise<CreateTripResponse> {
  return parse(
    await fetch('/api/trips', { method: 'POST', headers: asJson(masterToken), body: JSON.stringify(trip) }),
  );
}

export async function fetchTrips(masterToken: string): Promise<TripSummaryDto[]> {
  return parse(await fetch('/api/trips', { headers: { Authorization: `Bearer ${masterToken}` } }));
}

export async function createStop(
  masterToken: string,
  tripSlug: string,
  stop: CreateStopRequest,
): Promise<CreateStopResponse> {
  return parse(
    await fetch(`/api/trips/${tripSlug}/stops`, {
      method: 'POST',
      headers: asJson(masterToken),
      body: JSON.stringify(stop),
    }),
  );
}

export async function setTripCover(
  masterToken: string,
  tripSlug: string,
  photoId: string,
): Promise<void> {
  await parse(
    await fetch(`/api/trips/${tripSlug}/cover`, {
      method: 'PATCH',
      headers: asJson(masterToken),
      body: JSON.stringify({ photoId }),
    }),
  );
}

/**
 * Fissa l'ordine delle tappe di un viaggio. Un elenco vuoto lo toglie, e le tappe tornano
 * a disporsi per data.
 */
export async function setStopOrder(
  masterToken: string,
  tripSlug: string,
  slugs: string[],
): Promise<void> {
  await parse(
    await fetch(`/api/trips/${tripSlug}/order`, {
      method: 'PATCH',
      headers: asJson(masterToken),
      body: JSON.stringify({ slugs }),
    }),
  );
}

export async function deleteStop(masterToken: string, stopSlug: string): Promise<void> {
  await parse(
    await fetch(`/api/stops/${stopSlug}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${masterToken}` },
    }),
  );
}

export async function deleteTrip(masterToken: string, tripSlug: string): Promise<void> {
  await parse(
    await fetch(`/api/trips/${tripSlug}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${masterToken}` },
    }),
  );
}
