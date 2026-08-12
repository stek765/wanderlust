import { beforeEach, describe, expect, it } from 'vitest';
import { addToKeychain, exportKeychain, importKeychain, loadKeychain, needsExport, type KeychainEntry } from '../../src/lib/keychain';

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
  name: `Viaggio ${slug}`,
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

  it('non duplica lo stesso viaggio', () => {
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

    expect(parsed.viaggi[0].key).toBe('chiave-in-base64url');
    expect(parsed.viaggi[0].writeToken).toBe('token-di-scrittura');
    expect(parsed.avviso).toMatch(/perse per sempre/);
  });

  it('avverte finché c\'è un viaggio nuovo non esportato', () => {
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

  /*
   * L'importazione è l'altra metà dell'esportazione: senza, il file prodotto non si
   * poteva ricaricare da nessuna parte, e un backup che non si ripristina non è un backup.
   */
  describe('importazione', () => {
    let storage: Storage;
    beforeEach(() => {
      storage = new MemoryStorage();
    });

    const fileEsportato = (entries: KeychainEntry[]) =>
      JSON.stringify({ avviso: 'x', esportatoIl: '2026-08-12', viaggi: entries });

    it('rimette in questo browser le chiavi esportate da un altro', () => {
      const esito = importKeychain(storage, fileEsportato([entry('bangkok'), entry('lisbona')]));

      expect(esito.aggiunte).toBe(2);
      expect(loadKeychain(storage).map((e) => e.slug).sort()).toEqual(['bangkok', 'lisbona']);
    });

    it('reimportare lo stesso file non fa danni', () => {
      const file = fileEsportato([entry('bangkok')]);
      importKeychain(storage, file);
      const esito = importKeychain(storage, file);

      expect(esito.aggiunte).toBe(0);
      expect(esito.giaPresenti).toBe(1);
      expect(loadKeychain(storage)).toHaveLength(1);
    });

    it('non sovrascrive una chiave diversa per lo stesso viaggio, e lo dice', () => {
      addToKeychain(storage, entry('bangkok'));
      const altra = { ...entry('bangkok'), key: 'una-chiave-completamente-diversa' };

      const esito = importKeychain(storage, fileEsportato([altra]));

      // Una delle due non apre quelle foto: indovinare quale sarebbe scommettere su
      // dei ricordi, quindi si segnala e non si tocca niente.
      expect(esito.conflitti).toEqual(['Viaggio bangkok']);
      expect(loadKeychain(storage)[0]?.key).toBe('chiave-in-base64url');
    });

    it('accetta anche un semplice elenco, non solo il file completo', () => {
      const esito = importKeychain(storage, JSON.stringify([entry('bangkok')]));
      expect(esito.aggiunte).toBe(1);
    });

    it('spiega perché un file non va, invece di fallire in silenzio', () => {
      expect(() => importKeychain(storage, 'non sono json')).toThrow(/JSON/);
      expect(() => importKeychain(storage, '{"viaggi": "no"}')).toThrow(/elenco/);
      expect(() => importKeychain(storage, '{"viaggi": [{"roba": 1}]}')).toThrow(/leggibile/);
    });
  });
});
