/**
 * Tutte le query su D1. Nessun'altra parte del Worker scrive SQL.
 *
 * Le righe grezze restano confinate qui: verso l'esterno escono solo i DTO condivisi,
 * così i nomi delle colonne possono cambiare senza toccare le rotte.
 */

import type { PhotoDto, StopDto, TripDto, TripSummaryDto } from '../shared/api-types';

/**
 * La data di una tappa: quella della sua foto più vecchia. Null se la tappa è vuota.
 *
 * Una tappa senza foto non ha un posto nel tempo, e non è un difetto da aggirare: è
 * un'informazione che non esiste ancora. Inventarle una data la metterebbe nel punto
 * sbagliato del racconto senza che nessuno capisca perché.
 */
const DATA_TAPPA = '(SELECT MIN(p.taken_at) FROM photos p WHERE p.stop_slug = s.slug) AS first_taken_at';

/**
 * L'ordine delle tappe, scritto una volta sola perché valga ovunque.
 *
 * Esisteva in due copie divergenti, e nessuna delle due sembrava sbagliata guardandola da
 * sola: la pagina del viaggio ordinava per data, il menu della pagina master per data di
 * creazione. Il risultato era che la mappa collegava le tappe nel tempo mentre l'elenco
 * sotto le mostrava in un altro ordine — due racconti dello stesso viaggio, e nessuno dei
 * due credibile. **Chi aggiunge un terzo elenco di tappe usa questa costante.**
 *
 * Le tappe senza foto finiscono in fondo, per ordine di creazione: non essendo collocabili
 * nel tempo, quello è l'unico ordine onesto che si possa dare loro.
 *
 * `position` sta davanti a tutto e vale come eccezione: quando qualcuno sposta una tappa a
 * mano, a **tutte** le tappe di quel viaggio viene scritta una posizione, e da lì in poi
 * comanda quella. O tutte o nessuna — mescolare tappe posizionate e tappe ordinate per
 * data darebbe un ordine che nessuno saprebbe più spiegare.
 */
const ORDINE_TAPPE =
  '(s.position IS NULL) ASC, s.position ASC, (first_taken_at IS NULL) ASC, first_taken_at ASC, s.created_at ASC';

export interface PhotoRow {
  id: string;
  stop_slug: string;
  r2_key: string;
  thumb_key: string;
  width: number;
  height: number;
  taken_at: number | null;
  sort_index: number;
  created_at: number;
}

interface StopRow {
  slug: string;
  trip_slug: string;
  name: string;
  lat: number;
  lon: number;
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

export async function insertTrip(
  db: D1Database,
  trip: { slug: string; name: string; writeTokenHash: string },
): Promise<void> {
  await db
    .prepare('INSERT INTO trips (slug, name, write_token_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(trip.slug, trip.name, trip.writeTokenHash, Date.now())
    .run();
}

export async function tripExists(db: D1Database, tripSlug: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS uno FROM trips WHERE slug = ?').bind(tripSlug).first();
  return row !== null;
}

/** Falso se il viaggio non esiste: una tappa orfana non deve poter nascere. */
export async function insertStop(
  db: D1Database,
  stop: { slug: string; tripSlug: string; name: string; lat: number; lon: number },
): Promise<boolean> {
  if (!(await tripExists(db, stop.tripSlug))) return false;

  await db
    .prepare('INSERT INTO stops (slug, trip_slug, name, lat, lon, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(stop.slug, stop.tripSlug, stop.name, stop.lat, stop.lon, Date.now())
    .run();

  return true;
}

/**
 * Il viaggio con tutte le sue tappe: è quello che apre il magnete.
 *
 * L'ordine delle tappe è la data della foto più vecchia di ciascuna. Le tappe ancora
 * vuote non hanno una data e finiscono in fondo, in ordine di creazione — è l'unico
 * ordine sensato per qualcosa che non è ancora successo.
 */
export async function getTrip(db: D1Database, tripSlug: string): Promise<TripDto | null> {
  const trip = await db
    .prepare('SELECT slug, name FROM trips WHERE slug = ?')
    .bind(tripSlug)
    .first<{ slug: string; name: string }>();

  if (!trip) return null;

  const { results: stops } = await db
    .prepare(
      `SELECT s.*, ${DATA_TAPPA}
         FROM stops s
        WHERE s.trip_slug = ?
        ORDER BY ${ORDINE_TAPPE}`,
    )
    .bind(trip.slug)
    .all<StopRow & { first_taken_at: number | null }>();

  const { results: photos } = await db
    .prepare(
      `SELECT p.*
         FROM photos p
         JOIN stops s ON s.slug = p.stop_slug
        WHERE s.trip_slug = ?
        ORDER BY p.sort_index ASC`,
    )
    .bind(trip.slug)
    .all<PhotoRow>();

  const perStop = new Map<string, PhotoDto[]>();
  for (const photo of photos) {
    const list = perStop.get(photo.stop_slug) ?? [];
    list.push(toPhotoDto(photo));
    perStop.set(photo.stop_slug, list);
  }

  const stopDtos: StopDto[] = stops.map((row) => ({
    slug: row.slug,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    photos: perStop.get(row.slug) ?? [],
  }));

  return { slug: trip.slug, name: trip.name, stops: stopDtos };
}

/**
 * Sceglie la copertina di un viaggio. Falso se quella foto non è sua: una copertina presa
 * da un altro viaggio sarebbe illeggibile, perché cifrata con un'altra chiave.
 */
export async function setTripCover(
  db: D1Database,
  tripSlug: string,
  photoId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE trips SET cover_photo_id = ?
        WHERE slug = ?
          AND EXISTS (
            SELECT 1 FROM photos p JOIN stops s ON s.slug = p.stop_slug
             WHERE p.id = ? AND s.trip_slug = ?
          )`,
    )
    .bind(photoId, tripSlug, photoId, tripSlug)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Fissa l'ordine delle tappe di un viaggio, così come glielo si è dato a mano.
 *
 * Scrive una posizione a **tutte** le tappe elencate, non solo a quella spostata: mescolare
 * tappe posizionate e tappe ordinate per data darebbe un ordine che nessuno saprebbe più
 * spiegare guardandolo.
 *
 * Falso se l'elenco non corrisponde esattamente alle tappe di quel viaggio — mancante,
 * ripetuto, o con dentro una tappa altrui. Un ordine parziale è peggio di nessun ordine.
 */
export async function setStopOrder(db: D1Database, tripSlug: string, slugs: string[]): Promise<boolean> {
  const { results } = await db
    .prepare('SELECT slug FROM stops WHERE trip_slug = ?')
    .bind(tripSlug)
    .all<{ slug: string }>();

  const sue = new Set(results.map((r) => r.slug));
  if (slugs.length !== sue.size || new Set(slugs).size !== slugs.length) return false;
  if (!slugs.every((slug) => sue.has(slug))) return false;

  await db.batch(
    slugs.map((slug, posizione) =>
      db.prepare('UPDATE stops SET position = ? WHERE slug = ? AND trip_slug = ?').bind(posizione, slug, tripSlug),
    ),
  );

  return true;
}

/**
 * Toglie l'ordine manuale: le tappe tornano a disporsi da sole, per data.
 *
 * Serve perché una scelta senza ritorno non è una scelta. Chi sposta una tappa deve poter
 * dire "lascia stare, rimettile come vengono".
 */
export async function clearStopOrder(db: D1Database, tripSlug: string): Promise<void> {
  await db.prepare('UPDATE stops SET position = NULL WHERE trip_slug = ?').bind(tripSlug).run();
}

/** L'hash del token di scrittura del viaggio a cui appartiene questa tappa. */
export async function getWriteTokenHashByStop(db: D1Database, stopSlug: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT t.write_token_hash AS hash
         FROM trips t
         JOIN stops s ON s.trip_slug = t.slug
        WHERE s.slug = ?`,
    )
    .bind(stopSlug)
    .first<{ hash: string }>();

  return row?.hash ?? null;
}

/** Viaggi e tappe per il menu. Nessun token, nessun hash: questa roba finisce nel DOM. */
export async function listTrips(db: D1Database): Promise<TripSummaryDto[]> {
  const { results: trips } = await db
    .prepare('SELECT slug, name, created_at, cover_photo_id FROM trips ORDER BY created_at DESC')
    .all<{ slug: string; name: string; created_at: number; cover_photo_id: string | null }>();

  const { results: stops } = await db
    .prepare(
      `SELECT s.slug, s.trip_slug, s.name, ${DATA_TAPPA},
              (SELECT COUNT(*) FROM photos p WHERE p.stop_slug = s.slug) AS photo_count,
              (SELECT p.thumb_key FROM photos p WHERE p.stop_slug = s.slug
                ORDER BY p.sort_index ASC LIMIT 1) AS cover
         FROM stops s
        ORDER BY ${ORDINE_TAPPE}`,
    )
    .all<{ slug: string; trip_slug: string; name: string; photo_count: number; cover: string | null }>();

  /*
   * La copertina: la miniatura della foto più vecchia del viaggio.
   *
   * `MIN()` con una colonna nuda accanto è un comportamento documentato di SQLite —
   * le colonne non aggregate arrivano dalla riga che ha prodotto il minimo. Evita di
   * scaricare tutte le foto per poi ordinarle in JavaScript.
   */
  const { results: covers } = await db
    .prepare(
      `SELECT s.trip_slug AS trip_slug, p.thumb_key AS thumb_key, p.r2_key AS r2_key,
              MIN(p.sort_index) AS piu_vecchia
         FROM photos p
         JOIN stops s ON s.slug = p.stop_slug
        GROUP BY s.trip_slug`,
    )
    .all<{ trip_slug: string; thumb_key: string; r2_key: string }>();

  const perTrip = new Map(covers.map((c) => [c.trip_slug, c]));

  // La copertina scelta a mano, quando c'è, batte quella automatica.
  const { results: scelte } = await db
    .prepare(
      `SELECT id, thumb_key, r2_key FROM photos
        WHERE id IN (SELECT cover_photo_id FROM trips WHERE cover_photo_id IS NOT NULL)`,
    )
    .all<{ id: string; thumb_key: string; r2_key: string }>();
  const perId = new Map(scelte.map((r) => [r.id, r]));

  /*
   * Di ogni copertina escono due riferimenti, non uno.
   *
   * La miniatura è da 300px: perfetta per i cerchietti delle tappe, e visibilmente
   * sgranata sulla scheda grande, che su un telefono moderno occupa oltre mille pixel
   * veri. Chi disegna sceglie quale dei due gli serve.
   */
  const copertina = (trip: { slug: string; cover_photo_id: string | null }) =>
    (trip.cover_photo_id ? perId.get(trip.cover_photo_id) : null) ?? perTrip.get(trip.slug) ?? null;

  return trips.map((trip) => ({
    slug: trip.slug,
    name: trip.name,
    createdAt: trip.created_at,
    coverThumbKey: copertina(trip)?.thumb_key ?? null,
    coverKey: copertina(trip)?.r2_key ?? null,
    stops: stops
      .filter((s) => s.trip_slug === trip.slug)
      .map((s) => ({
        slug: s.slug,
        name: s.name,
        photoCount: s.photo_count,
        coverThumbKey: s.cover,
      })),
  }));
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
    stopSlug: string;
    key: string;
    thumbKey: string;
    width: number;
    height: number;
    takenAt: number | null;
  },
): Promise<number> {
  const sortIndex = photo.takenAt ?? (await nextTailIndex(db, photo.stopSlug));

  await db
    .prepare(
      `INSERT INTO photos
         (id, stop_slug, r2_key, thumb_key, width, height, taken_at, sort_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      photo.id,
      photo.stopSlug,
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
async function nextTailIndex(db: D1Database, stopSlug: string): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(sort_index) AS max_index FROM photos WHERE stop_slug = ?')
    .bind(stopSlug)
    .first<{ max_index: number | null }>();

  const highest = row?.max_index ?? 0;
  return Math.max(highest + 1, Date.now());
}

export async function getPhotoRow(db: D1Database, stopSlug: string, photoId: string): Promise<PhotoRow | null> {
  return db
    .prepare('SELECT * FROM photos WHERE id = ? AND stop_slug = ?')
    .bind(photoId, stopSlug)
    .first<PhotoRow>();
}

export async function deletePhoto(db: D1Database, stopSlug: string, photoId: string): Promise<void> {
  await db.prepare('DELETE FROM photos WHERE id = ? AND stop_slug = ?').bind(photoId, stopSlug).run();
}

/**
 * Cancella un viaggio con tutto quello che ci sta dentro e restituisce le chiavi R2
 * rimaste orfane.
 *
 * Le righe se ne andrebbero anche da sole per vincolo di chiave esterna, i blob no: R2
 * non sa niente di SQL. Chi chiama deve cancellarli, e per farlo deve saperne i nomi —
 * da qui il valore di ritorno.
 */
export async function deleteTrip(db: D1Database, tripSlug: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT p.r2_key, p.thumb_key
         FROM photos p
         JOIN stops s ON s.slug = p.stop_slug
        WHERE s.trip_slug = ?`,
    )
    .bind(tripSlug)
    .all<{ r2_key: string; thumb_key: string }>();

  await db
    .prepare('DELETE FROM photos WHERE stop_slug IN (SELECT slug FROM stops WHERE trip_slug = ?)')
    .bind(tripSlug)
    .run();
  await db.prepare('DELETE FROM stops WHERE trip_slug = ?').bind(tripSlug).run();
  await db.prepare('DELETE FROM trips WHERE slug = ?').bind(tripSlug).run();

  return results.flatMap((row) => [row.r2_key, row.thumb_key]);
}

/**
 * Cancella una tappa con le sue foto, e restituisce le chiavi R2 rimaste orfane.
 *
 * Come per il viaggio: le righe se ne vanno da sole, i blob no — R2 non sa niente di SQL.
 * Chi chiama deve cancellarli, e per farlo deve saperne i nomi.
 */
export async function deleteStop(db: D1Database, stopSlug: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT r2_key, thumb_key FROM photos WHERE stop_slug = ?')
    .bind(stopSlug)
    .all<{ r2_key: string; thumb_key: string }>();

  await db.prepare('DELETE FROM photos WHERE stop_slug = ?').bind(stopSlug).run();
  await db.prepare('DELETE FROM stops WHERE slug = ?').bind(stopSlug).run();

  return results.flatMap((row) => [row.r2_key, row.thumb_key]);
}

/** Dump completo dell'indice, per il backup settimanale. Non contiene chiavi né token. */
export async function dumpAll(
  db: D1Database,
): Promise<{ trips: unknown[]; stops: unknown[]; photos: unknown[] }> {
  const trips = await db.prepare('SELECT slug, name, created_at FROM trips').all();
  const stops = await db.prepare('SELECT slug, trip_slug, name, lat, lon, created_at FROM stops').all();
  const photos = await db.prepare('SELECT * FROM photos').all();
  return { trips: trips.results, stops: stops.results, photos: photos.results };
}
