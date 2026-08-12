/**
 * Il portachiavi dei viaggi.
 *
 * Le chiavi di cifratura esistono in due posti soli: dentro gli URL scritti sui tag NFC di
 * un viaggio, e qui. Se si perdono entrambi, quelle foto non le riapre più nessuno — non
 * c'è recupero, non c'è assistenza, non c'è scorciatoia.
 *
 * Per questo il portachiavi sa fare una cosa che sembra banale e non lo è: esportarsi.
 * Il file JSON che produce va in 1Password, e va rifatto a ogni viaggio nuovo — aggiungere
 * una tappa invece non produce chiavi nuove, perché la chiave è del viaggio.
 *
 * E sa reimportarsi, che è l'altra metà della stessa cosa: il portachiavi vive nel
 * `localStorage` di **un** browser, quindi un viaggio creato dal telefono sul computer
 * resta illeggibile finché la sua chiave non ci arriva. Per un po' l'esportazione è
 * esistita senza il suo inverso, e il file prodotto non si poteva ricaricare da nessuna
 * parte: un backup che non si può ripristinare non è un backup.
 */

const STORAGE_KEY = 'ricordi:keychain';

export interface KeychainEntry {
  /** Lo slug del VIAGGIO: la chiave e il token valgono per tutte le sue tappe. */
  slug: string;
  name: string;
  /** La chiave in base64url, la stessa che sta nel frammento degli URL del viaggio. */
  key: string;
  /** Il token di scrittura: senza, i tag NFC non si potrebbero riscrivere se si rompono. */
  writeToken: string;
  createdAt: number;
}

export function loadKeychain(storage: Storage): KeychainEntry[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    // Un portachiavi illeggibile non deve impedire di crearne di nuovi: meglio partire
    // vuoti che bloccare la pagina.
    return [];
  }
}

export function addToKeychain(storage: Storage, entry: KeychainEntry): KeychainEntry[] {
  // Uno slug è unico: se ricompare è lo stesso viaggio ricreato, e vince il nuovo.
  const entries = [...loadKeychain(storage).filter((e) => e.slug !== entry.slug), entry];
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return entries;
}

/** Il file da salvare in 1Password. Formattato in modo che sia leggibile a occhio. */
export function exportKeychain(entries: KeychainEntry[]): Blob {
  const payload = {
    avviso:
      'Queste chiavi sono l\'unico modo per riaprire le foto. Senza, sono perse per sempre. Conservare in un gestore di password.',
    esportatoIl: new Date().toISOString(),
    viaggi: entries,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export interface ImportSummary {
  /** Chiavi che questo browser non aveva: da qui in poi quei viaggi si aprono. */
  aggiunte: number;
  /** Già presenti e identiche: reimportare lo stesso file non fa danni. */
  giaPresenti: number;
  /**
   * Stesso viaggio, chiave diversa. Non si sovrascrive niente: una delle due non apre
   * quelle foto, e indovinare quale significherebbe scommettere su dei ricordi.
   */
  conflitti: string[];
}

/**
 * Rimette in questo browser le chiavi esportate da un altro.
 *
 * È il pezzo che mancava, e la sua assenza si vedeva: un viaggio creato dal telefono, sul
 * computer compariva nell'elenco ma con le copertine grigie e la scritta "le chiavi non
 * sono su questo browser" — vera ma senza via d'uscita, perché una via d'uscita non c'era.
 *
 * Non sovrascrive mai una chiave esistente. Se lo stesso viaggio ha due chiavi diverse,
 * una delle due non apre le sue foto: la scelta va segnalata a chi guarda, non presa qui.
 */
export function importKeychain(storage: Storage, json: string): ImportSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Questo file non è un portachiavi: non è nemmeno JSON valido.');
  }

  // Accetta sia il file esportato da qui sia un semplice elenco, così un JSON ricomposto
  // a mano da un gestore di password funziona lo stesso.
  const raw: unknown = Array.isArray(parsed) ? parsed : (parsed as { viaggi?: unknown })?.viaggi;
  if (!Array.isArray(raw)) {
    throw new Error('Questo file non contiene un elenco di viaggi.');
  }

  const arrivate = raw.filter(isEntry);
  if (arrivate.length === 0) {
    throw new Error('Nessuna chiave leggibile in questo file.');
  }

  const esistenti = loadKeychain(storage);
  const perSlug = new Map(esistenti.map((e) => [e.slug, e]));
  const summary: ImportSummary = { aggiunte: 0, giaPresenti: 0, conflitti: [] };

  for (const entry of arrivate) {
    const gia = perSlug.get(entry.slug);
    if (!gia) {
      perSlug.set(entry.slug, entry);
      summary.aggiunte++;
    } else if (gia.key === entry.key) {
      summary.giaPresenti++;
    } else {
      summary.conflitti.push(entry.name);
    }
  }

  if (summary.aggiunte > 0) {
    storage.setItem(STORAGE_KEY, JSON.stringify([...perSlug.values()]));
  }

  return summary;
}

/** Vero se nel portachiavi c'è qualcosa che non è ancora stato esportato. */
export function needsExport(entries: KeychainEntry[], lastExportAt: number | null): boolean {
  if (entries.length === 0) return false;
  if (lastExportAt === null) return true;
  return entries.some((entry) => entry.createdAt > lastExportAt);
}

function isEntry(value: unknown): value is KeychainEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.slug === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.key === 'string' &&
    typeof entry.writeToken === 'string' &&
    typeof entry.createdAt === 'number'
  );
}
