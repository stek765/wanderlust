/**
 * Il portachiavi della pagina master.
 *
 * Le chiavi di cifratura esistono in due posti soli: dentro l'URL scritto sul tag NFC, e
 * qui. Se si perdono entrambi, quelle foto non le riapre più nessuno — non c'è recupero,
 * non c'è assistenza, non c'è scorciatoia.
 *
 * Per questo il portachiavi sa fare una cosa che sembra banale e non lo è: esportarsi.
 * Il file JSON che produce va in 1Password, e va rifatto a ogni posto nuovo.
 */

const STORAGE_KEY = 'ricordi:keychain';

export interface KeychainEntry {
  slug: string;
  name: string;
  /** La chiave in base64url, la stessa che sta nel frammento dell'URL. */
  key: string;
  /** Il token di scrittura: senza, il tag NFC non si potrebbe riscrivere se si rompe. */
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
  // Uno slug è unico: se ricompare è lo stesso posto ricreato, e vince il nuovo.
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
    posti: entries,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
