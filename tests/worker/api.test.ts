import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreatePlaceResponse, PlaceDto, RegisterPhotoResponse, UploadMediaResponse } from '../../shared/api-types';
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

async function creaPosto(name = 'Bangkok'): Promise<CreatePlaceResponse> {
  const response = await call('/api/places', {
    method: 'POST',
    headers: { ...auth(MASTER), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, lat: 13.7563, lon: 100.5018 }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

/** Carica un blob finto (per il Worker sono byte opachi comunque) e lo registra. */
async function caricaFoto(place: CreatePlaceResponse, contenuto = 'ciphertext'): Promise<RegisterPhotoResponse> {
  const upload = async (kind: 'full' | 'thumb') => {
    const response = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': kind },
      body: `${contenuto}-${kind}`,
    });
    expect(response.status).toBe(200);
    return (await response.json<UploadMediaResponse>()).key;
  };

  const key = await upload('full');
  const thumbKey = await upload('thumb');

  const response = await call(`/api/places/${place.slug}/photos`, {
    method: 'POST',
    headers: { ...auth(place.writeToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, thumbKey, width: 1600, height: 1200, takenAt: 1700000000000 }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM photos');
  await env.DB.exec('DELETE FROM places');
});

describe('creazione posti', () => {
  it('rifiuta chi non ha il token master', async () => {
    const response = await call('/api/places', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bangkok', lat: 13.7, lon: 100.5 }),
    });
    expect(response.status).toBe(401);
  });

  it('rifiuta un token master sbagliato', async () => {
    const response = await call('/api/places', {
      method: 'POST',
      headers: auth('quasi-giusto'),
      body: JSON.stringify({ name: 'Bangkok', lat: 13.7, lon: 100.5 }),
    });
    expect(response.status).toBe(401);
  });

  it('crea il posto e restituisce slug e token di scrittura', async () => {
    const place = await creaPosto();

    expect(place.slug).toMatch(/^[a-z0-9]{12}$/);
    expect(place.writeToken.length).toBeGreaterThan(20);
  });

  it('dà slug e token diversi a due posti creati di fila', async () => {
    const primo = await creaPosto('Bangkok');
    const secondo = await creaPosto('Lisbona');

    expect(primo.slug).not.toBe(secondo.slug);
    expect(primo.writeToken).not.toBe(secondo.writeToken);
  });

  it('rifiuta coordinate fuori dal mondo', async () => {
    const response = await call('/api/places', {
      method: 'POST',
      headers: auth(MASTER),
      body: JSON.stringify({ name: 'Nessun luogo', lat: 200, lon: 0 }),
    });
    expect(response.status).toBe(400);
  });

  it('rifiuta un nome vuoto', async () => {
    const response = await call('/api/places', {
      method: 'POST',
      headers: auth(MASTER),
      body: JSON.stringify({ name: '   ', lat: 13.7, lon: 100.5 }),
    });
    expect(response.status).toBe(400);
  });
});

describe('lettura di un posto', () => {
  it('è aperta: chi ha il link legge senza token', async () => {
    const place = await creaPosto();
    const response = await call(`/api/places/${place.slug}`);

    expect(response.status).toBe(200);
    const body = await response.json<PlaceDto>();
    expect(body.name).toBe('Bangkok');
    expect(body.photos).toEqual([]);
  });

  it('risponde 404 a uno slug inventato, senza dire altro', async () => {
    const response = await call('/api/places/inventatodinulla');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'non trovato' });
  });

  it('non espone mai l\'hash del token di scrittura', async () => {
    const place = await creaPosto();
    const testo = await (await call(`/api/places/${place.slug}`)).text();

    expect(testo).not.toContain('write_token');
    expect(testo).not.toContain('Hash');
  });
});

describe('caricamento foto', () => {
  it('rifiuta chi non ha il token di scrittura del posto', async () => {
    const place = await creaPosto();
    const response = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { 'X-Media-Kind': 'full' },
      body: 'roba',
    });
    expect(response.status).toBe(401);
  });

  it('rifiuta il token di scrittura di un altro posto', async () => {
    const bangkok = await creaPosto('Bangkok');
    const lisbona = await creaPosto('Lisbona');

    const response = await call(`/api/places/${bangkok.slug}/media`, {
      method: 'POST',
      headers: { ...auth(lisbona.writeToken), 'X-Media-Kind': 'full' },
      body: 'roba',
    });
    expect(response.status).toBe(401);
  });

  it('mette il blob su R2 sotto lo slug del posto', async () => {
    const place = await creaPosto();
    const response = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': 'full' },
      body: 'byte cifrati',
    });

    const { key } = await response.json<UploadMediaResponse>();
    expect(key.startsWith(`${place.slug}/`)).toBe(true);

    const stored = await env.MEDIA.get(key);
    expect(await stored?.text()).toBe('byte cifrati');
  });

  it('rifiuta un tipo di media inventato', async () => {
    const place = await creaPosto();
    const response = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': 'video' },
      body: 'roba',
    });
    expect(response.status).toBe(400);
  });

  it('rifiuta un corpo vuoto', async () => {
    const place = await creaPosto();
    const response = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': 'full' },
      body: '',
    });
    expect(response.status).toBe(400);
  });

  it('rifiuta un blob oltre il limite', async () => {
    const place = await creaPosto();
    const response = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': 'full' },
      body: new Uint8Array(16 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
  });
});

describe('registrazione foto', () => {
  it('la foto compare nel posto dopo la registrazione', async () => {
    const place = await creaPosto();
    const photo = await caricaFoto(place);

    const body = await (await call(`/api/places/${place.slug}`)).json<PlaceDto>();

    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]?.id).toBe(photo.id);
    expect(body.photos[0]?.width).toBe(1600);
  });

  it('la prima foto diventa automaticamente la copertina', async () => {
    const place = await creaPosto();
    const prima = await caricaFoto(place);
    await caricaFoto(place);

    const body = await (await call(`/api/places/${place.slug}`)).json<PlaceDto>();
    expect(body.coverPhotoId).toBe(prima.id);
  });

  it('rifiuta chiavi che puntano nello spazio di un altro posto', async () => {
    const bangkok = await creaPosto('Bangkok');
    const lisbona = await creaPosto('Lisbona');

    const response = await call(`/api/places/${bangkok.slug}/photos`, {
      method: 'POST',
      headers: { ...auth(bangkok.writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: `${lisbona.slug}/rubata-full`,
        thumbKey: `${lisbona.slug}/rubata-thumb`,
        width: 100,
        height: 100,
        takenAt: null,
      }),
    });

    expect(response.status).toBe(400);
  });

  it('ordina le foto per data di scatto', async () => {
    const place = await creaPosto();

    const registra = async (takenAt: number | null) => {
      const response = await call(`/api/places/${place.slug}/photos`, {
        method: 'POST',
        headers: { ...auth(place.writeToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: `${place.slug}/a-full`,
          thumbKey: `${place.slug}/a-thumb`,
          width: 10,
          height: 10,
          takenAt,
        }),
      });
      return response.json<RegisterPhotoResponse>();
    };

    const tardi = await registra(2000);
    const presto = await registra(1000);
    const senzaData = await registra(null);

    const body = await (await call(`/api/places/${place.slug}`)).json<PlaceDto>();
    const ordine = body.photos.map((p) => p.id);

    expect(ordine.slice(0, 2)).toEqual([presto.id, tardi.id]);
    // Le foto senza EXIF vanno in fondo, non in mezzo alla cronologia.
    expect(ordine.at(-1)).toBe(senzaData.id);
  });
});

describe('copertina', () => {
  it('si può cambiare a mano', async () => {
    const place = await creaPosto();
    await caricaFoto(place);
    const seconda = await caricaFoto(place);

    const response = await call(`/api/places/${place.slug}/cover`, {
      method: 'PATCH',
      headers: { ...auth(place.writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: seconda.id }),
    });
    expect(response.status).toBe(200);

    const body = await (await call(`/api/places/${place.slug}`)).json<PlaceDto>();
    expect(body.coverPhotoId).toBe(seconda.id);
  });

  it('rifiuta una foto che appartiene a un altro posto', async () => {
    const bangkok = await creaPosto('Bangkok');
    const lisbona = await creaPosto('Lisbona');
    await caricaFoto(bangkok);
    const altrove = await caricaFoto(lisbona);

    const response = await call(`/api/places/${bangkok.slug}/cover`, {
      method: 'PATCH',
      headers: { ...auth(bangkok.writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId: altrove.id }),
    });

    expect(response.status).toBe(404);
  });
});

describe('cancellazione', () => {
  it('toglie la foto dall\'elenco e i blob da R2', async () => {
    const place = await creaPosto();
    const photo = await caricaFoto(place);

    const prima = await (await call(`/api/places/${place.slug}`)).json<PlaceDto>();
    const chiavi = [prima.photos[0]!.key, prima.photos[0]!.thumbKey];

    const response = await call(`/api/places/${place.slug}/photos/${photo.id}`, {
      method: 'DELETE',
      headers: auth(place.writeToken),
    });
    expect(response.status).toBe(200);

    const dopo = await (await call(`/api/places/${place.slug}`)).json<PlaceDto>();
    expect(dopo.photos).toHaveLength(0);
    expect(dopo.coverPhotoId).toBeNull();

    for (const key of chiavi) {
      expect(await env.MEDIA.get(key)).toBeNull();
    }
  });

  it('rifiuta chi non ha il token di scrittura', async () => {
    const place = await creaPosto();
    const photo = await caricaFoto(place);

    const response = await call(`/api/places/${place.slug}/photos/${photo.id}`, { method: 'DELETE' });
    expect(response.status).toBe(401);
  });
});

describe('servizio dei media', () => {
  it('restituisce i byte cifrati a chi ha l\'URL', async () => {
    const place = await creaPosto();
    const upload = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': 'full' },
      body: 'byte cifrati',
    });
    const { key } = await upload.json<UploadMediaResponse>();

    const response = await call(`/media/${key}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('byte cifrati');
  });

  it('marca la risposta come immutabile, così la CDN se la tiene', async () => {
    const place = await creaPosto();
    const upload = await call(`/api/places/${place.slug}/media`, {
      method: 'POST',
      headers: { ...auth(place.writeToken), 'X-Media-Kind': 'thumb' },
      body: 'miniatura',
    });
    const { key } = await upload.json<UploadMediaResponse>();

    const response = await call(`/media/${key}`);
    expect(response.headers.get('Cache-Control')).toContain('immutable');
  });

  it('risponde 404 a una chiave inesistente', async () => {
    const response = await call('/media/mai/esistita');
    expect(response.status).toBe(404);
  });
});

describe('backup', () => {
  it('richiede il token master', async () => {
    expect((await call('/api/backup')).status).toBe(401);
  });

  it('contiene posti e foto ma nessun token', async () => {
    const place = await creaPosto();
    await caricaFoto(place);

    const response = await call('/api/backup', { headers: auth(MASTER) });
    const testo = await response.text();

    expect(response.status).toBe(200);
    expect(testo).toContain(place.slug);
    expect(testo).not.toContain('write_token');
  });
});
