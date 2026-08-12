import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CreateStopResponse,
  CreateTripResponse,
  RegisterPhotoResponse,
  TripSummaryDto,
  TripDto,
  UploadMediaResponse,
} from '../../shared/api-types';
import worker from '../../worker/index';

const MASTER = 'master-di-test';
const BASE = 'https://ricordi.test';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE}${path}`, init), env as never, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function creaViaggio(name = 'Thailandia'): Promise<CreateTripResponse> {
  const response = await call('/api/trips', {
    method: 'POST',
    headers: { ...auth(MASTER), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

async function creaTappa(tripSlug: string, name = 'Bangkok'): Promise<CreateStopResponse> {
  const response = await call(`/api/trips/${tripSlug}/stops`, {
    method: 'POST',
    headers: { ...auth(MASTER), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, lat: 13.7563, lon: 100.5018 }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

/** Carica un blob finto (per il Worker sono byte opachi comunque) e lo registra. */
async function caricaFoto(
  stopSlug: string,
  writeToken: string,
  takenAt: number | null = 1700000000000,
): Promise<RegisterPhotoResponse> {
  const upload = async (kind: 'full' | 'thumb') => {
    const response = await call(`/api/stops/${stopSlug}/media`, {
      method: 'POST',
      headers: { ...auth(writeToken), 'X-Media-Kind': kind },
      body: `ciphertext-${kind}`,
    });
    expect(response.status).toBe(200);
    return (await response.json<UploadMediaResponse>()).key;
  };

  const key = await upload('full');
  const thumbKey = await upload('thumb');

  const response = await call(`/api/stops/${stopSlug}/photos`, {
    method: 'POST',
    headers: { ...auth(writeToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, thumbKey, width: 1600, height: 1200, takenAt }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM photos');
  await env.DB.exec('DELETE FROM stops');
  await env.DB.exec('DELETE FROM trips');
});

describe('creazione viaggi', () => {
  it('rifiuta chi non ha il token master', async () => {
    const response = await call('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Thailandia' }),
    });
    expect(response.status).toBe(401);
  });

  it('crea il viaggio e restituisce slug e token di scrittura', async () => {
    const trip = await creaViaggio();
    expect(trip.slug).toMatch(/^[a-z0-9]{12}$/);
    expect(trip.writeToken.length).toBeGreaterThan(20);
  });

  it('rifiuta un nome vuoto', async () => {
    const response = await call('/api/trips', {
      method: 'POST',
      headers: auth(MASTER),
      body: JSON.stringify({ name: '   ' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('creazione tappe', () => {
  it('richiede il token master, non quello di scrittura', async () => {
    const trip = await creaViaggio();
    const response = await call(`/api/trips/${trip.slug}/stops`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bangkok', lat: 13.7, lon: 100.5 }),
    });
    expect(response.status).toBe(401);
  });

  it('rifiuta coordinate fuori dal mondo', async () => {
    const trip = await creaViaggio();
    const response = await call(`/api/trips/${trip.slug}/stops`, {
      method: 'POST',
      headers: { ...auth(MASTER), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nessun luogo', lat: 200, lon: 0 }),
    });
    expect(response.status).toBe(400);
  });

  it('rifiuta una tappa su un viaggio che non esiste', async () => {
    const response = await call('/api/trips/inventato/stops', {
      method: 'POST',
      headers: { ...auth(MASTER), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bangkok', lat: 13.7, lon: 100.5 }),
    });
    expect(response.status).toBe(404);
  });
});

describe('lettura del viaggio', () => {
  it('è aperta: chi ha il link legge senza token', async () => {
    const trip = await creaViaggio();
    await creaTappa(trip.slug);

    const response = await call(`/api/trips/${trip.slug}`);
    expect(response.status).toBe(200);

    const body = await response.json<TripDto>();
    expect(body.name).toBe('Thailandia');
    expect(body.stops).toHaveLength(1);
  });

  it('mostra tutte le tappe del viaggio', async () => {
    const trip = await creaViaggio();
    await creaTappa(trip.slug, 'Bangkok');
    await creaTappa(trip.slug, 'Phuket');

    const body = await (await call(`/api/trips/${trip.slug}`)).json<TripDto>();
    expect(body.stops.map((s: { name: string }) => s.name)).toEqual(['Bangkok', 'Phuket']);
  });

  it('risponde 404 a uno slug inventato, senza dire altro', async () => {
    const response = await call('/api/trips/inventatodinulla');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'non trovato' });
  });

  it('non espone mai l\'hash del token di scrittura', async () => {
    const trip = await creaViaggio();
    await creaTappa(trip.slug);
    const testo = await (await call(`/api/trips/${trip.slug}`)).text();

    expect(testo).not.toContain('write_token');
    expect(testo).not.toContain('Hash');
  });
});

describe('caricamento foto', () => {
  it('accetta il token del viaggio su una qualsiasi delle sue tappe', async () => {
    const trip = await creaViaggio();
    const bangkok = await creaTappa(trip.slug, 'Bangkok');
    const phuket = await creaTappa(trip.slug, 'Phuket');

    await caricaFoto(bangkok.slug, trip.writeToken);
    await caricaFoto(phuket.slug, trip.writeToken);

    const body = await (await call(`/api/trips/${trip.slug}`)).json<TripDto>();
    expect(body.stops.every((s: { photos: unknown[] }) => s.photos.length === 1)).toBe(true);
  });

  it('rifiuta il token di un altro viaggio', async () => {
    const thailandia = await creaViaggio('Thailandia');
    const sardegna = await creaViaggio('Sardegna');
    const tappa = await creaTappa(thailandia.slug);

    const response = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(sardegna.writeToken), 'X-Media-Kind': 'full' },
      body: 'roba',
    });
    expect(response.status).toBe(401);
  });

  it('rifiuta chi non presenta nessun token', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const response = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { 'X-Media-Kind': 'full' },
      body: 'roba',
    });
    expect(response.status).toBe(401);
  });

  it('mette il blob su R2 sotto lo slug della tappa', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const response = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'X-Media-Kind': 'full' },
      body: 'byte cifrati',
    });

    const { key } = await response.json<UploadMediaResponse>();
    expect(key.startsWith(`${tappa.slug}/`)).toBe(true);
    expect(await (await env.MEDIA.get(key))?.text()).toBe('byte cifrati');
  });

  it('rifiuta un tipo di media inventato', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const response = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'X-Media-Kind': 'video' },
      body: 'roba',
    });
    expect(response.status).toBe(400);
  });

  it('rifiuta un corpo vuoto', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const response = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'X-Media-Kind': 'full' },
      body: '',
    });
    expect(response.status).toBe(400);
  });

  it('rifiuta un blob oltre il limite', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const response = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'X-Media-Kind': 'full' },
      body: new Uint8Array(16 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
  });

  it('rifiuta chiavi che puntano nello spazio di un\'altra tappa', async () => {
    const trip = await creaViaggio();
    const bangkok = await creaTappa(trip.slug, 'Bangkok');
    const phuket = await creaTappa(trip.slug, 'Phuket');

    const response = await call(`/api/stops/${bangkok.slug}/photos`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: `${phuket.slug}/rubata-full`,
        thumbKey: `${phuket.slug}/rubata-thumb`,
        width: 100,
        height: 100,
        takenAt: null,
      }),
    });
    expect(response.status).toBe(400);
  });

  it('ordina le foto di una tappa per data di scatto', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const tardi = await caricaFoto(tappa.slug, trip.writeToken, 2000);
    const presto = await caricaFoto(tappa.slug, trip.writeToken, 1000);
    const senzaData = await caricaFoto(tappa.slug, trip.writeToken, null);

    const body = await (await call(`/api/trips/${trip.slug}`)).json<TripDto>();
    const ordine = body.stops[0]!.photos.map((p: { id: string }) => p.id);

    expect(ordine.slice(0, 2)).toEqual([presto.id, tardi.id]);
    expect(ordine.at(-1)).toBe(senzaData.id);
  });
});

describe('cancellazione', () => {
  it('toglie la foto dall\'elenco e i blob da R2', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);
    const photo = await caricaFoto(tappa.slug, trip.writeToken);

    const prima = await (await call(`/api/trips/${trip.slug}`)).json<TripDto>();
    const chiavi = [prima.stops[0]!.photos[0]!.key, prima.stops[0]!.photos[0]!.thumbKey];

    const response = await call(`/api/stops/${tappa.slug}/photos/${photo.id}`, {
      method: 'DELETE',
      headers: auth(trip.writeToken),
    });
    expect(response.status).toBe(200);

    const dopo = await (await call(`/api/trips/${trip.slug}`)).json<TripDto>();
    expect(dopo.stops[0]!.photos).toHaveLength(0);

    for (const key of chiavi) {
      expect(await env.MEDIA.get(key)).toBeNull();
    }
  });

  it('cancellare il viaggio porta via tappe, foto e blob', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);
    await caricaFoto(tappa.slug, trip.writeToken);

    const prima = await (await call(`/api/trips/${trip.slug}`)).json<TripDto>();
    const chiave = prima.stops[0]!.photos[0]!.key;

    const response = await call(`/api/trips/${trip.slug}`, { method: 'DELETE', headers: auth(MASTER) });
    expect(response.status).toBe(200);

    expect((await call(`/api/trips/${trip.slug}`)).status).toBe(404);
    expect(await env.MEDIA.get(chiave)).toBeNull();
  });

  it('la cancellazione di un viaggio richiede il token master', async () => {
    const trip = await creaViaggio();
    const response = await call(`/api/trips/${trip.slug}`, {
      method: 'DELETE',
      headers: auth(trip.writeToken),
    });
    expect(response.status).toBe(401);
  });
});

describe('elenco per il menu', () => {
  it('richiede il token master', async () => {
    expect((await call('/api/trips')).status).toBe(401);
  });

  it('elenca viaggi e tappe con il conteggio delle foto', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);
    await caricaFoto(tappa.slug, trip.writeToken);

    const elenco = await (await call('/api/trips', { headers: auth(MASTER) })).json<TripSummaryDto[]>();

    expect(elenco).toHaveLength(1);
    expect(elenco[0]?.stops[0]?.photoCount).toBe(1);
  });
});

describe('servizio dei media', () => {
  it('restituisce i byte cifrati a chi ha l\'URL', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const upload = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'X-Media-Kind': 'full' },
      body: 'byte cifrati',
    });
    const { key } = await upload.json<UploadMediaResponse>();

    const response = await call(`/media/${key}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('byte cifrati');
  });

  it('marca la risposta come immutabile, così la CDN se la tiene', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);

    const upload = await call(`/api/stops/${tappa.slug}/media`, {
      method: 'POST',
      headers: { ...auth(trip.writeToken), 'X-Media-Kind': 'thumb' },
      body: 'miniatura',
    });
    const { key } = await upload.json<UploadMediaResponse>();

    const response = await call(`/media/${key}`);
    expect(response.headers.get('Cache-Control')).toContain('immutable');
  });

  it('risponde 404 a una chiave inesistente', async () => {
    expect((await call('/media/mai/esistita')).status).toBe(404);
  });
});

describe('backup', () => {
  it('richiede il token master', async () => {
    expect((await call('/api/backup')).status).toBe(401);
  });

  it('contiene viaggi, tappe e foto ma nessun token', async () => {
    const trip = await creaViaggio();
    const tappa = await creaTappa(trip.slug);
    await caricaFoto(tappa.slug, trip.writeToken);

    const response = await call('/api/backup', { headers: auth(MASTER) });
    const testo = await response.text();

    expect(response.status).toBe(200);
    expect(testo).toContain(trip.slug);
    expect(testo).toContain(tappa.slug);
    expect(testo).not.toContain('write_token');
  });
});
