import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  buildTagUrl,
  cleanedUrl,
  parseRoute,
  recallWriteToken,
  resolveWriteToken,
} from '../../src/lib/session';

const ORIGIN = 'https://ricordi.example';
const KEY = 'q7Fk3aX2m4Qz8vN1pR5tY7uI9oP0sD2fG4hJ6kL8mN0';
const TOKEN = 'tok3n-di-scrittura';

/** localStorage finto: happy-dom lo ha, ma uno esplicito rende i test indipendenti. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('lettura dell\'URL', () => {
  it('riconosce un URL arrivato dal tag NFC', () => {
    const route = parseRoute(`${ORIGIN}/p/bangkok12345?w=${TOKEN}#${KEY}`);

    expect(route).toEqual({
      kind: 'place',
      slug: 'bangkok12345',
      keyMaterial: KEY,
      writeTokenFromUrl: TOKEN,
    });
  });

  it('riconosce un link condiviso: chiave sì, potere di scrittura no', () => {
    const route = parseRoute(`${ORIGIN}/p/bangkok12345#${KEY}`);

    expect(route.kind).toBe('place');
    if (route.kind !== 'place') return;
    expect(route.keyMaterial).toBe(KEY);
    expect(route.writeTokenFromUrl).toBeNull();
  });

  it('segnala un URL senza chiave invece di fingere che vada bene', () => {
    const route = parseRoute(`${ORIGIN}/p/bangkok12345`);

    expect(route.kind).toBe('place');
    if (route.kind !== 'place') return;
    expect(route.keyMaterial).toBeNull();
  });

  it('riconosce la pagina master', () => {
    expect(parseRoute(`${ORIGIN}/m/segretissimo`)).toEqual({ kind: 'master', masterToken: 'segretissimo' });
  });

  it('non scambia la home per un posto', () => {
    expect(parseRoute(`${ORIGIN}/`).kind).toBe('unknown');
    expect(parseRoute(`${ORIGIN}/p/`).kind).toBe('unknown');
  });
});

describe('condivisione', () => {
  it('il link condiviso non contiene il token di scrittura', () => {
    const share = buildShareUrl(ORIGIN, 'bangkok12345', KEY);

    expect(share).not.toContain(TOKEN);
    expect(share).not.toContain('w=');
    expect(share).toContain(`#${KEY}`);
  });

  it('chi riceve il link condiviso può leggere ma non scrivere', () => {
    const route = parseRoute(buildShareUrl(ORIGIN, 'bangkok12345', KEY));

    expect(route.kind).toBe('place');
    if (route.kind !== 'place') return;
    expect(route.keyMaterial).toBe(KEY);
    expect(route.writeTokenFromUrl).toBeNull();
  });

  it('l\'URL del tag si rilegge esattamente com\'era stato costruito', () => {
    const tagUrl = buildTagUrl(ORIGIN, 'bangkok12345', TOKEN, KEY);
    const route = parseRoute(tagUrl);

    expect(route.kind).toBe('place');
    if (route.kind !== 'place') return;
    expect(route.slug).toBe('bangkok12345');
    expect(route.writeTokenFromUrl).toBe(TOKEN);
    expect(route.keyMaterial).toBe(KEY);
  });

  it('l\'URL del tag sta comodamente in un NTAG215', () => {
    const tagUrl = buildTagUrl(ORIGIN, 'bangkok12345', 'a'.repeat(43), KEY);
    // NTAG215: 504 byte utili. Serve margine, non un incastro al limite.
    expect(tagUrl.length).toBeLessThan(200);
  });
});

describe('pulizia della barra degli indirizzi', () => {
  it('toglie il token ma tiene la chiave', () => {
    const cleaned = cleanedUrl(`${ORIGIN}/p/bangkok12345?w=${TOKEN}#${KEY}`);

    expect(cleaned).toBe(`/p/bangkok12345#${KEY}`);
    expect(cleaned).not.toContain(TOKEN);
  });

  it('l\'URL ripulito resta leggibile: senza chiave non si potrebbe ricaricare', () => {
    const cleaned = cleanedUrl(`${ORIGIN}/p/bangkok12345?w=${TOKEN}#${KEY}`);
    const route = parseRoute(ORIGIN + cleaned);

    expect(route.kind).toBe('place');
    if (route.kind !== 'place') return;
    expect(route.keyMaterial).toBe(KEY);
  });
});

describe('memoria del token di scrittura', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('il token arrivato dal tag viene messo da parte', () => {
    const route = parseRoute(`${ORIGIN}/p/bangkok12345?w=${TOKEN}#${KEY}`);
    if (route.kind !== 'place') throw new Error('rotta sbagliata');

    expect(resolveWriteToken(storage, route)).toBe(TOKEN);
    expect(recallWriteToken(storage, 'bangkok12345')).toBe(TOKEN);
  });

  it('una visita successiva senza token lo ritrova', () => {
    const dalTag = parseRoute(`${ORIGIN}/p/bangkok12345?w=${TOKEN}#${KEY}`);
    if (dalTag.kind !== 'place') throw new Error('rotta sbagliata');
    resolveWriteToken(storage, dalTag);

    const daPreferito = parseRoute(`${ORIGIN}/p/bangkok12345#${KEY}`);
    if (daPreferito.kind !== 'place') throw new Error('rotta sbagliata');

    expect(resolveWriteToken(storage, daPreferito)).toBe(TOKEN);
  });

  it('il token di un posto non vale per un altro', () => {
    const route = parseRoute(`${ORIGIN}/p/bangkok12345?w=${TOKEN}#${KEY}`);
    if (route.kind !== 'place') throw new Error('rotta sbagliata');
    resolveWriteToken(storage, route);

    const altro = parseRoute(`${ORIGIN}/p/lisbona67890#${KEY}`);
    if (altro.kind !== 'place') throw new Error('rotta sbagliata');

    expect(resolveWriteToken(storage, altro)).toBeNull();
  });

  it('chi apre un link condiviso su un telefono nuovo resta in sola lettura', () => {
    const route = parseRoute(buildShareUrl(ORIGIN, 'bangkok12345', KEY));
    if (route.kind !== 'place') throw new Error('rotta sbagliata');

    expect(resolveWriteToken(storage, route)).toBeNull();
  });
});
