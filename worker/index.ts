/**
 * L'unico Worker del progetto: serve l'API, i file cifrati e il sito statico.
 *
 * Cosa NON fa, deliberatamente: non decifra niente e non vede mai una chiave. Per lui i
 * media sono sequenze di byte opache. Se un giorno questo file iniziasse a leggere il
 * contenuto delle foto, la promessa di privacy del progetto sarebbe rotta.
 */

import { Hono } from 'hono';
import type {
  CreateStopRequest,
  CreateStopResponse,
  CreateTripRequest,
  CreateTripResponse,
  RegisterPhotoRequest,
  RegisterPhotoResponse,
  UploadMediaResponse,
} from '../shared/api-types';
import { bearerToken, sha256Hex, tokenMatches } from './auth';
import * as db from './db';
import { randomId, randomToken } from './ids';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** SHA-256 del token master. `wrangler secret put MASTER_TOKEN_HASH`. */
  MASTER_TOKEN_HASH: string;
}

/** Un blob cifrato oltre questa soglia non è una foto compressa: è un errore o un abuso. */
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Media: lettura pubblica, scrittura col token del viaggio
// ---------------------------------------------------------------------------

/**
 * Serve un blob cifrato.
 *
 * Volutamente senza autenticazione: il contenuto è ciphertext, e senza la chiave — che
 * sta nel frammento dell'URL e non arriva mai qui — non è distinguibile da rumore. In
 * cambio la risposta è cacheabile dalla CDN, quindi il Worker viene toccato una volta
 * sola per file invece che a ogni visita.
 */
app.get('/media/*', async (c) => {
  const key = c.req.path.slice('/media/'.length);
  if (!key) return c.notFound();

  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  const object = await c.env.MEDIA.get(key);
  if (!object) return c.notFound();

  const response = new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      // I blob sono immutabili per costruzione: la chiave R2 contiene un id casuale,
      // quindi un contenuto diverso ha sempre un URL diverso.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.httpEtag,
    },
  });

  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

// ---------------------------------------------------------------------------
// Viaggi: solo dalla pagina master
// ---------------------------------------------------------------------------

app.post('/api/trips', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);

  const body = await c.req.json<CreateTripRequest>().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'nome mancante' }, 400);
  }

  const slug = randomId(12);
  const writeToken = randomToken();

  await db.insertTrip(c.env.DB, {
    slug,
    name: body.name.trim(),
    writeTokenHash: await sha256Hex(writeToken),
  });

  // Unica occasione in cui il token viaggia in chiaro: da qui finisce negli URL dei tag.
  return c.json<CreateTripResponse>({ slug, writeToken }, 201);
});

/** L'elenco che riempie il menu. Nessun token, nessun hash: finisce nel DOM. */
app.get('/api/trips', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);
  return c.json(await db.listTrips(c.env.DB));
});

/**
 * Il viaggio con tutte le sue tappe: è questo che apre il magnete. Aperta, perché senza
 * chiave i riferimenti alle foto non servono a niente.
 */
app.get('/api/trips/:slug', async (c) => {
  const trip = await db.getTrip(c.env.DB, c.req.param('slug'));
  // 404 identica per slug inesistente e slug mai esistito: non confermiamo indovinelli.
  if (!trip) return c.json({ error: 'non trovato' }, 404);
  return c.json(trip);
});

/** Sceglie la copertina del viaggio fra le sue foto. */
app.patch('/api/trips/:slug/cover', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);

  const body = await c.req.json<{ photoId?: string }>().catch(() => null);
  if (!body?.photoId) return c.json({ error: 'photoId mancante' }, 400);

  const ok = await db.setTripCover(c.env.DB, c.req.param('slug'), body.photoId);
  if (!ok) return c.json({ error: 'foto non trovata in questo viaggio' }, 404);

  return c.json({ ok: true });
});

/**
 * Fissa l'ordine delle tappe, o lo toglie mandando un elenco vuoto.
 *
 * Token master e non token di scrittura: riordinare le tappe cambia il racconto del
 * viaggio e il disegno della rotta sulla mappa, che è una cosa da chi possiede il viaggio,
 * non da chiunque abbia toccato un magnete.
 */
app.patch('/api/trips/:slug/order', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);

  const body = await c.req.json<{ slugs?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.slugs) || !body.slugs.every((s) => typeof s === 'string')) {
    return c.json({ error: 'slugs deve essere un elenco di stringhe' }, 400);
  }

  const tripSlug = c.req.param('slug');

  if (body.slugs.length === 0) {
    await db.clearStopOrder(c.env.DB, tripSlug);
    return c.json({ ok: true });
  }

  const ok = await db.setStopOrder(c.env.DB, tripSlug, body.slugs as string[]);
  // Un ordine parziale è peggio di nessun ordine: o l'elenco è esattamente quello delle
  // sue tappe, o non si scrive niente.
  if (!ok) return c.json({ error: 'l\'elenco non corrisponde alle tappe di questo viaggio' }, 400);

  return c.json({ ok: true });
});

app.delete('/api/trips/:slug', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);

  const orphans = await db.deleteTrip(c.env.DB, c.req.param('slug'));
  // R2 non sa niente di chiavi esterne: i blob vanno tolti a mano, o restano lì a pesare.
  if (orphans.length > 0) await c.env.MEDIA.delete(orphans);

  return c.json({ ok: true });
});

/**
 * Aggiunge una tappa. Richiede il token master e non quello di scrittura, perché una
 * tappa nuova significa un magnete nuovo, e i magneti li fa solo chi ha il portachiavi.
 */
app.post('/api/trips/:slug/stops', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);

  const body = await c.req.json<CreateStopRequest>().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'nome mancante' }, 400);
  }
  if (!isLatitude(body.lat) || !isLongitude(body.lon)) {
    return c.json({ error: 'coordinate non valide' }, 400);
  }

  const slug = randomId(12);
  const created = await db.insertStop(c.env.DB, {
    slug,
    tripSlug: c.req.param('slug'),
    name: body.name.trim(),
    lat: body.lat,
    lon: body.lon,
  });

  if (!created) return c.json({ error: 'viaggio non trovato' }, 404);
  return c.json<CreateStopResponse>({ slug }, 201);
});

// ---------------------------------------------------------------------------
// Tappe
// ---------------------------------------------------------------------------



/**
 * Cancella una tappa. Token master, come per crearla: una tappa che sparisce è un magnete
 * in meno, e i magneti li governa chi ha il portachiavi.
 */
app.delete('/api/stops/:slug', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);

  const orphans = await db.deleteStop(c.env.DB, c.req.param('slug'));
  if (orphans.length > 0) await c.env.MEDIA.delete(orphans);

  return c.json({ ok: true });
});

/** Carica un blob già cifrato dal browser e restituisce dove è finito. */
app.post('/api/stops/:slug/media', async (c) => {
  const slug = c.req.param('slug');
  if (!(await canWrite(c.env, c.req.raw, slug))) return unauthorized(c);

  const kind = c.req.header('X-Media-Kind');
  if (kind !== 'full' && kind !== 'thumb') {
    return c.json({ error: 'X-Media-Kind deve essere "full" o "thumb"' }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'corpo vuoto' }, 400);
  if (body.byteLength > MAX_MEDIA_BYTES) return c.json({ error: 'file troppo grande' }, 413);

  // La chiave comincia con lo slug della tappa: anche dentro lo stesso viaggio i file
  // restano separati, e l'id casuale la rende non indovinabile.
  const key = `${slug}/${randomId(16)}-${kind}`;
  await c.env.MEDIA.put(key, body);

  return c.json<UploadMediaResponse>({ key });
});

/** Registra una foto già caricata su R2. */
app.post('/api/stops/:slug/photos', async (c) => {
  const slug = c.req.param('slug');
  if (!(await canWrite(c.env, c.req.raw, slug))) return unauthorized(c);

  const body = await c.req.json<RegisterPhotoRequest>().catch(() => null);
  if (!body || !isOwnKey(body.key, slug) || !isOwnKey(body.thumbKey, slug)) {
    return c.json({ error: 'chiavi non valide' }, 400);
  }
  if (!Number.isFinite(body.width) || !Number.isFinite(body.height)) {
    return c.json({ error: 'dimensioni non valide' }, 400);
  }

  const id = randomId(16);
  const sortIndex = await db.insertPhoto(c.env.DB, {
    id,
    stopSlug: slug,
    key: body.key,
    thumbKey: body.thumbKey,
    width: body.width,
    height: body.height,
    takenAt: typeof body.takenAt === 'number' ? body.takenAt : null,
  });

  return c.json<RegisterPhotoResponse>({ id, sortIndex }, 201);
});

app.delete('/api/stops/:slug/photos/:id', async (c) => {
  const slug = c.req.param('slug');
  if (!(await canWrite(c.env, c.req.raw, slug))) return unauthorized(c);

  const photo = await db.getPhotoRow(c.env.DB, slug, c.req.param('id'));
  if (!photo) return c.json({ error: 'foto non trovata' }, 404);

  await db.deletePhoto(c.env.DB, slug, photo.id);
  await c.env.MEDIA.delete([photo.r2_key, photo.thumb_key]);

  return c.json({ ok: true });
});

/** Scarica l'indice. Serve alla pagina master per il backup manuale. */
app.get('/api/backup', async (c) => {
  if (!(await isMaster(c.env, c.req.raw))) return unauthorized(c);
  return c.json(await db.dumpAll(c.env.DB));
});

// ---------------------------------------------------------------------------
// Sito statico
// ---------------------------------------------------------------------------

/**
 * Tutto il resto è il sito. Gli asset veri (JS, CSS) li serve Cloudflare da solo prima
 * di arrivare qui; questo ramo si occupa delle rotte del browser — /p/<slug> e
 * /m/<token> — che devono ricevere index.html perché il routing avviene nel client.
 */
app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Nessuna pagina di questo sito deve finire in un motore di ricerca.
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
});

// ---------------------------------------------------------------------------

function unauthorized(c: { json: (body: unknown, status: 401) => Response }): Response {
  return c.json({ error: 'non autorizzato' }, 401);
}

async function isMaster(env: Env, request: Request): Promise<boolean> {
  return tokenMatches(bearerToken(request), env.MASTER_TOKEN_HASH);
}

/**
 * Il permesso di scrivere appartiene al viaggio, non alla tappa: si risale dalla tappa
 * toccata al viaggio che la contiene. È questo che permette di caricare foto su Bangkok
 * dopo aver toccato il magnete di Chiang Mai.
 */
async function canWrite(env: Env, request: Request, stopSlug: string): Promise<boolean> {
  const hash = await db.getWriteTokenHashByStop(env.DB, stopSlug);
  if (!hash) return false;
  return tokenMatches(bearerToken(request), hash);
}

/** Impedisce che un token valido per un viaggio depositi file nello spazio di una tappa altrui. */
function isOwnKey(key: unknown, slug: string): boolean {
  return typeof key === 'string' && key.startsWith(`${slug}/`);
}

const isLatitude = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLongitude = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

export default {
  fetch: app.fetch,

  /** Backup settimanale dell'indice su R2. Le foto non c'entrano: quelle sono già lì. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const dump = await db.dumpAll(env.DB);
    const stamp = new Date().toISOString().slice(0, 10);
    await env.MEDIA.put(`_backup/index-${stamp}.json`, JSON.stringify(dump, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
  },
};
