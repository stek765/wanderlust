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

  /*
   * La scheda grande dell'indice usava la miniatura da 300px, stirata su una scheda che
   * occupa oltre mille pixel veri: sembrava un difetto grafico ed era una scelta di dato.
   */
  it('della copertina dà anche la versione a piena risoluzione', async () => {
    const v = await viaggio();
    await tappa(v, 'bangkok', 'Bangkok');
    await foto('bangkok', 1000);

    const elenco = await db.listTrips(env.DB);
    expect(elenco[0]?.coverThumbKey).toBe('bangkok/thumb');
    expect(elenco[0]?.coverKey).toBe('bangkok/full');
  });

  it('un viaggio senza foto non ha copertina, e non è un errore', async () => {
    const v = await viaggio();
    await tappa(v, 'vuota', 'Vuota');

    const elenco = await db.listTrips(env.DB);
    expect(elenco[0]?.coverThumbKey).toBeNull();
  });

  /*
   * Il menu e la mappa devono raccontare lo stesso viaggio.
   *
   * Regressione vera, trovata usando il sito: le due query avevano ORDER BY diversi — la
   * pagina del viaggio ordinava per data, il menu per ordine di creazione. Nessuna delle
   * due sembrava sbagliata guardandola da sola, e nessun test le confrontava.
   */
  it('elenca le tappe nello stesso ordine della pagina del viaggio', async () => {
    const v = await viaggio();
    // Create in un ordine che non ha niente a che vedere con la cronologia del viaggio.
    await tappa(v, 'terza', 'Terza');
    await tappa(v, 'prima', 'Prima');
    await tappa(v, 'seconda', 'Seconda');

    await foto('terza', 3000);
    await foto('prima', 1000);
    await foto('seconda', 2000);

    const menu = (await db.listTrips(env.DB))[0]?.stops.map((s) => s.slug);
    const pagina = (await db.getTrip(env.DB, v))?.stops.map((s) => s.slug);

    expect(menu).toEqual(['prima', 'seconda', 'terza']);
    expect(menu).toEqual(pagina);
  });

  it('mette in fondo le tappe senza foto, che nel tempo non sono collocabili', async () => {
    const v = await viaggio();
    await tappa(v, 'vuota', 'Vuota');
    await tappa(v, 'datata', 'Datata');
    await foto('datata', 5000);

    const menu = (await db.listTrips(env.DB))[0]?.stops.map((s) => s.slug);
    // Creata per prima, ma senza foto: non ha un posto nel tempo e finisce in coda.
    expect(menu).toEqual(['datata', 'vuota']);
  });
});

describe('ordine dato a mano', () => {
  it('comanda sulle date, e si può togliere', async () => {
    const v = await viaggio();
    await tappa(v, 'prima', 'Prima');
    await tappa(v, 'seconda', 'Seconda');
    await foto('prima', 1000);
    await foto('seconda', 2000);

    const perData = (await db.getTrip(env.DB, v))?.stops.map((s) => s.slug);
    expect(perData).toEqual(['prima', 'seconda']);

    expect(await db.setStopOrder(env.DB, v, ['seconda', 'prima'])).toBe(true);
    const aMano = (await db.getTrip(env.DB, v))?.stops.map((s) => s.slug);
    expect(aMano).toEqual(['seconda', 'prima']);

    // Una scelta senza ritorno non è una scelta.
    await db.clearStopOrder(env.DB, v);
    expect((await db.getTrip(env.DB, v))?.stops.map((s) => s.slug)).toEqual(['prima', 'seconda']);
  });

  it('vale anche per il menu, non solo per la mappa', async () => {
    const v = await viaggio();
    await tappa(v, 'a', 'A');
    await tappa(v, 'b', 'B');
    await db.setStopOrder(env.DB, v, ['b', 'a']);

    const menu = (await db.listTrips(env.DB))[0]?.stops.map((s) => s.slug);
    expect(menu).toEqual(['b', 'a']);
  });

  it('rifiuta un elenco che non è esattamente quello delle sue tappe', async () => {
    const v = await viaggio();
    await tappa(v, 'a', 'A');
    await tappa(v, 'b', 'B');

    // Un ordine parziale è peggio di nessun ordine: le tappe non elencate finirebbero in
    // un limbo fra "posizionate" e "per data".
    expect(await db.setStopOrder(env.DB, v, ['a'])).toBe(false);
    expect(await db.setStopOrder(env.DB, v, ['a', 'a'])).toBe(false);
    expect(await db.setStopOrder(env.DB, v, ['a', 'b', 'inventata'])).toBe(false);

    // E non deve aver scritto niente.
    expect((await db.getTrip(env.DB, v))?.stops.map((s) => s.slug)).toEqual(['a', 'b']);
  });

  it('mette a mano anche le tappe senza foto, che è il caso per cui esiste', async () => {
    const v = await viaggio();
    await tappa(v, 'datata', 'Datata');
    await tappa(v, 'vuota', 'Vuota');
    await foto('datata', 5000);

    // Senza date la tappa vuota finiva in fondo e non c'era modo di spostarla.
    await db.setStopOrder(env.DB, v, ['vuota', 'datata']);
    expect((await db.getTrip(env.DB, v))?.stops.map((s) => s.slug)).toEqual(['vuota', 'datata']);
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
