import { beforeEach, describe, expect, it } from 'vitest';
import { addToKeychain, exportKeychain, loadKeychain, needsExport, type KeychainEntry } from '../../src/lib/keychain';

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

const entry = (slug: string, createdAt = 1000): KeychainEntry => ({
  slug,
  name: `Posto ${slug}`,
  key: 'chiave-in-base64url',
  writeToken: 'token-di-scrittura',
  createdAt,
});

describe('portachiavi', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('parte vuoto', () => {
    expect(loadKeychain(storage)).toEqual([]);
  });

  it('conserva le chiavi fra un caricamento e l\'altro', () => {
    addToKeychain(storage, entry('bangkok'));
    addToKeychain(storage, entry('lisbona'));

    expect(loadKeychain(storage).map((e) => e.slug)).toEqual(['bangkok', 'lisbona']);
  });

  it('non duplica lo stesso posto', () => {
    addToKeychain(storage, entry('bangkok', 1000));
    addToKeychain(storage, { ...entry('bangkok', 2000), name: 'Bangkok davvero' });

    const entries = loadKeychain(storage);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Bangkok davvero');
  });

  it('sopravvive a un portachiavi corrotto invece di bloccare la pagina', () => {
    storage.setItem('ricordi:keychain', '{non è json');
    expect(loadKeychain(storage)).toEqual([]);

    // E si deve poter ricominciare a salvare.
    addToKeychain(storage, entry('bangkok'));
    expect(loadKeychain(storage)).toHaveLength(1);
  });

  it('scarta le voci malformate senza buttare via quelle buone', () => {
    storage.setItem('ricordi:keychain', JSON.stringify([entry('bangkok'), { slug: 'rotta' }]));
    expect(loadKeychain(storage).map((e) => e.slug)).toEqual(['bangkok']);
  });
});

describe('esportazione', () => {
  it('contiene chiavi, token e un avviso leggibile', async () => {
    const testo = await exportKeychain([entry('bangkok')]).text();
    const parsed = JSON.parse(testo);

    expect(parsed.posti[0].key).toBe('chiave-in-base64url');
    expect(parsed.posti[0].writeToken).toBe('token-di-scrittura');
    expect(parsed.avviso).toMatch(/perse per sempre/);
  });

  it('avverte finché c\'è un posto nuovo non esportato', () => {
    const entries = [entry('bangkok', 1000)];

    expect(needsExport(entries, null)).toBe(true);
    expect(needsExport(entries, 500)).toBe(true);
    expect(needsExport(entries, 1500)).toBe(false);

    entries.push(entry('lisbona', 2000));
    expect(needsExport(entries, 1500)).toBe(true);
  });

  it('non avverte se non c\'è ancora niente da perdere', () => {
    expect(needsExport([], null)).toBe(false);
  });
});
