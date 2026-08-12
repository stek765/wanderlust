import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../worker/db';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM photos');
  await env.DB.exec('DELETE FROM stops');
  await env.DB.exec('DELETE FROM trips');
});

async function viaggio(slug = 'v1'): Promise<string> {
  await db.insertTrip(env.DB, { slug, name: 'Thailandia', writeTokenHash: 'hash' });
  return slug;
}

async function tappa(tripSlug: string, slug: string, name: string): Promise<string> {
  await db.insertStop(env.DB, { slug, tripSlug, name, lat: 13.7, lon: 100.5 });
  return slug;
}

async function foto(stopSlug: string, takenAt: number | null): Promise<void> {
  await db.insertPhoto(env.DB, {
    id: `${stopSlug}-${takenAt ?? 'null'}-${Math.random().toString(36).slice(2)}`,
    stopSlug,
    key: `${stopSlug}/full`,
    thumbKey: `${stopSlug}/thumb`,
    width: 100,
    height: 100,
    takenAt,
  });
}

describe('lettura del viaggio', () => {
  it('restituisce tutte le sue tappe', async () => {
    const v = await viaggio();
    await tappa(v, 'bangkok', 'Bangkok');
    await tappa(v, 'phuket', 'Phuket');

    const vista = await db.getTrip(env.DB, v);

    expect(vista?.name).toBe('Thailandia');
    expect(vista?.stops.map((s) => s.slug)).toEqual(['bangkok', 'phuket']);
  });

  it('non trova niente per un viaggio inesistente', async () => {
    expect(await db.getTrip(env.DB, 'mai-esistito')).toBeNull();
  });

  it('ordina le tappe per la foto più vecchia di ciascuna', async () => {
    const v = await viaggio();
    await tappa(v, 'primo', 'Primo creato');
    await tappa(v, 'secondo', 'Secondo creato');

    await foto('primo', 3000);
    await foto('secondo', 1000);

    const vista = await db.getTrip(env.DB, v);
    expect(vista?.stops.map((s) => s.slug)).toEqual(['secondo', 'primo']);
  });

  it('manda in fondo le tappe ancora senza foto, in ordine di creazione', async () => {
    const v = await viaggio();
    await tappa(v, 'vuota-a', 'Vuota A');
    await tappa(v, 'vuota-b', 'Vuota B');
    await tappa(v, 'piena', 'Piena');
    await foto('piena', 5000);

    const vista = await db.getTrip(env.DB, v);
    expect(vista?.stops.map((s) => s.slug)).toEqual(['piena', 'vuota-a', 'vuota-b']);
  });

  it('mette le foto di ogni tappa nella tappa giusta, ordinate per scatto', async () => {
    const v = await viaggio();
    await tappa(v, 'bangkok', 'Bangkok');
    await tappa(v, 'phuket', 'Phuket');
    await foto('bangkok', 2000);
    await foto('bangkok', 1000);
    await foto('phuket', 3000);

    const vista = await db.getTrip(env.DB, v);
    const bangkok = vista!.stops.find((s) => s.slug === 'bangkok')!;
    const phuket = vista!.stops.find((s) => s.slug === 'phuket')!;

    expect(bangkok.photos.map((p) => p.takenAt)).toEqual([1000, 2000]);
    expect(phuket.photos).toHaveLength(1);
  });
});

describe('autorizzazione', () => {
  it('risale dalla tappa al token del viaggio', async () => {
    const v = await viaggio();
    await tappa(v, 'bangkok', 'Bangkok');
    expect(await db.getWriteTokenHashByStop(env.DB, 'bangkok')).toBe('hash');
  });

  it('non restituisce niente per una tappa che non esiste', async () => {
    expect(await db.getWriteTokenHashByStop(env.DB, 'niente')).toBeNull();
  });
});

describe('tappe', () => {
  it('rifiuta una tappa su un viaggio inesistente', async () => {
    const creata = await db.insertStop(env.DB, {
      slug: 'orfana',
      tripSlug: 'mai-esistito',
      name: 'Orfana',
      lat: 0,
      lon: 0,
    });
    expect(creata).toBe(false);
  });
});

describe('elenco per il menu', () => {
  it('conta le foto di ogni tappa e non espone token', async () => {
    const v = await viaggio();
    await tappa(v, 'bangkok', 'Bangkok');
    await foto('bangkok', 1000);
    await foto('bangkok', 2000);

    const elenco = await db.listTrips(env.DB);

    expect(elenco).toHaveLength(1);
    expect(elenco[0]?.stops).toEqual([
      { slug: 'bangkok', name: 'Bangkok', photoCount: 2, coverThumbKey: 'bangkok/thumb' },
    ]);
    expect(JSON.stringify(elenco)).not.toContain('hash');
  });

  it('indica come copertina la miniatura della foto più vecchia del viaggio', async () => {
    const v = await viaggio();
    await tappa(v, 'tardi', 'Tardi');
    await tappa(v, 'presto', 'Presto');
    await foto('tardi', 9000);
    await foto('presto', 1000);

    const elenco = await db.listTrips(env.DB);
    expect(elenco[0]?.coverThumbKey).toBe('presto/thumb');
  });

  it('un viaggio senza foto non ha copertina, e non è un errore', async () => {
    const v = await viaggio();
    await tappa(v, 'vuota', 'Vuota');

    const elenco = await db.listTrips(env.DB);
    expect(elenco[0]?.coverThumbKey).toBeNull();
  });
});

describe('cancellazione del viaggio', () => {
  it('porta via tappe e foto e restituisce le chiavi R2', async () => {
    const v = await viaggio();
    await tappa(v, 'bangkok', 'Bangkok');
    await foto('bangkok', 1000);

    const chiavi = await db.deleteTrip(env.DB, v);

    expect(chiavi).toEqual(expect.arrayContaining(['bangkok/full', 'bangkok/thumb']));
    expect(await db.getTrip(env.DB, v)).toBeNull();

    const rimaste = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>();
    expect(rimaste?.n).toBe(0);
  });
});
