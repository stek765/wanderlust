/**
 * Tutte le query su D1. Nessun'altra parte del Worker scrive SQL.
 *
 * Le righe grezze restano confinate qui: verso l'esterno escono solo i DTO condivisi,
 * così i nomi delle colonne possono cambiare senza toccare le rotte.
 */

import type { PhotoDto, PlaceDto } from '../shared/api-types';

interface PlaceRow {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  cover_photo_id: string | null;
  write_token_hash: string;
  created_at: number;
}

interface PhotoRow {
  id: string;
  place_slug: string;
  r2_key: string;
  thumb_key: string;
  width: number;
  height: number;
  taken_at: number | null;
  sort_index: number;
  created_at: number;
}

function toPhotoDto(row: PhotoRow): PhotoDto {
  return {
    id: row.id,
    key: row.r2_key,
    thumbKey: row.thumb_key,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    sortIndex: row.sort_index,
  };
}

export async function insertPlace(
  db: D1Database,
  place: { slug: string; name: string; lat: number; lon: number; writeTokenHash: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO places (slug, name, lat, lon, cover_photo_id, write_token_hash, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(place.slug, place.name, place.lat, place.lon, place.writeTokenHash, Date.now())
    .run();
}

export async function getPlaceRow(db: D1Database, slug: string): Promise<PlaceRow | null> {
  return db.prepare('SELECT * FROM places WHERE slug = ?').bind(slug).first<PlaceRow>();
}

/** Il posto con tutte le sue foto già ordinate, pronto da servire. */
export async function getPlaceWithPhotos(db: D1Database, slug: string): Promise<PlaceDto | null> {
  const place = await getPlaceRow(db, slug);
  if (!place) return null;

  const { results } = await db
    .prepare('SELECT * FROM photos WHERE place_slug = ? ORDER BY sort_index ASC')
    .bind(slug)
    .all<PhotoRow>();

  return {
    slug: place.slug,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    coverPhotoId: place.cover_photo_id,
    photos: results.map(toPhotoDto),
  };
}

/**
 * Registra una foto e restituisce la posizione che le è stata assegnata.
 *
 * L'ordinamento è per data di scatto crescente. Le foto senza EXIF finiscono in coda
 * nell'ordine in cui sono arrivate: `sort_index` viene calcolato dalla data quando c'è,
 * e dal massimo corrente + 1 quando manca.
 */
export async function insertPhoto(
  db: D1Database,
  photo: {
    id: string;
    placeSlug: string;
    key: string;
    thumbKey: string;
    width: number;
    height: number;
    takenAt: number | null;
  },
): Promise<number> {
  const sortIndex = photo.takenAt ?? (await nextTailIndex(db, photo.placeSlug));

  await db
    .prepare(
      `INSERT INTO photos
         (id, place_slug, r2_key, thumb_key, width, height, taken_at, sort_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      photo.id,
      photo.placeSlug,
      photo.key,
      photo.thumbKey,
      photo.width,
      photo.height,
      photo.takenAt,
      sortIndex,
      Date.now(),
    )
    .run();

  return sortIndex;
}

/**
 * Una posizione oltre l'ultima occupata. Parte da Date.now() perché gli indici delle
 * foto con EXIF sono timestamp: una foto senza data deve finire dopo di loro, non in
 * mezzo.
 */
async function nextTailIndex(db: D1Database, placeSlug: string): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(sort_index) AS max_index FROM photos WHERE place_slug = ?')
    .bind(placeSlug)
    .first<{ max_index: number | null }>();

  const highest = row?.max_index ?? 0;
  return Math.max(highest + 1, Date.now());
}

/** Imposta la copertina solo se la foto appartiene davvero a quel posto. */
export async function setCoverPhoto(db: D1Database, slug: string, photoId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE places SET cover_photo_id = ?
       WHERE slug = ? AND EXISTS (SELECT 1 FROM photos WHERE id = ? AND place_slug = ?)`,
    )
    .bind(photoId, slug, photoId, slug)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/** Se è la prima foto del posto diventa anche la copertina, senza toccare le successive. */
export async function setCoverIfUnset(db: D1Database, slug: string, photoId: string): Promise<void> {
  await db
    .prepare('UPDATE places SET cover_photo_id = ? WHERE slug = ? AND cover_photo_id IS NULL')
    .bind(photoId, slug)
    .run();
}

export async function getPhotoRow(db: D1Database, slug: string, photoId: string): Promise<PhotoRow | null> {
  return db
    .prepare('SELECT * FROM photos WHERE id = ? AND place_slug = ?')
    .bind(photoId, slug)
    .first<PhotoRow>();
}

export async function deletePhoto(db: D1Database, slug: string, photoId: string): Promise<void> {
  await db.prepare('DELETE FROM photos WHERE id = ? AND place_slug = ?').bind(photoId, slug).run();
  // Se era la copertina il posto resta senza: la pagina ripiega sulla prima foto.
  await db
    .prepare('UPDATE places SET cover_photo_id = NULL WHERE slug = ? AND cover_photo_id = ?')
    .bind(slug, photoId)
    .run();
}

/** Dump completo dell'indice, per il backup settimanale. Non contiene chiavi. */
export async function dumpAll(db: D1Database): Promise<{ places: unknown[]; photos: unknown[] }> {
  const places = await db.prepare('SELECT slug, name, lat, lon, cover_photo_id, created_at FROM places').all();
  const photos = await db.prepare('SELECT * FROM photos').all();
  return { places: places.results, photos: photos.results };
}
