/**
 * Le chiamate al Worker. Nessun altro file fa fetch verso l'API.
 *
 * Attenzione a una cosa sola: qui passano blob già cifrati e riferimenti, mai chiavi.
 * Se un giorno una funzione di questo file accettasse una CryptoKey, sarebbe il segnale
 * che qualcosa è andato storto nel design.
 */

import type {
  CreatePlaceRequest,
  CreatePlaceResponse,
  PlaceDto,
  RegisterPhotoRequest,
  RegisterPhotoResponse,
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

/** Il posto con le sue foto. Non richiede token: senza chiave i riferimenti sono inerti. */
export async function fetchPlace(slug: string): Promise<PlaceDto> {
  return parse(await fetch(`/api/places/${slug}`));
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

export async function uploadMedia(slug: string, writeToken: string, blob: Blob, kind: 'full' | 'thumb'): Promise<string> {
  const response = await fetch(`/api/places/${slug}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeToken}`, 'X-Media-Kind': kind },
    body: blob,
  });
  const body = await parse<UploadMediaResponse>(response);
  return body.key;
}

export async function registerPhoto(
  slug: string,
  writeToken: string,
  photo: RegisterPhotoRequest,
): Promise<RegisterPhotoResponse> {
  return parse(
    await fetch(`/api/places/${slug}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(photo),
    }),
  );
}

export async function setCover(slug: string, writeToken: string, photoId: string): Promise<void> {
  await parse(
    await fetch(`/api/places/${slug}/cover`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId }),
    }),
  );
}

export async function deletePhoto(slug: string, writeToken: string, photoId: string): Promise<void> {
  await parse(
    await fetch(`/api/places/${slug}/photos/${photoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${writeToken}` },
    }),
  );
}

export async function createPlace(masterToken: string, place: CreatePlaceRequest): Promise<CreatePlaceResponse> {
  return parse(
    await fetch('/api/places', {
      method: 'POST',
      headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(place),
    }),
  );
}
