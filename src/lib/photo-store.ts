/**
 * Trasforma i riferimenti a blob cifrati in URL che un <img> può usare.
 *
 * Fra R2 e il tag <img> c'è un passaggio che nei siti normali non esiste: scaricare,
 * decifrare, e costruire un blob URL locale. Costa, quindi il risultato va tenuto —
 * senza cache, uscire e rientrare da una foto la ridecifrerebbe ogni volta.
 *
 * I blob URL vanno revocati a mano: sono riferimenti che il garbage collector non tocca,
 * e trecento miniature dimenticate sono trecento immagini decompresse in memoria.
 */

import { fetchEncrypted } from './api-client';
import { decryptBlob } from './crypto';

export class PhotoStore {
  private readonly urls = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly key: CryptoKey) {}

  /**
   * URL utilizzabile per una chiave R2. Chiamate ripetute sulla stessa chiave
   * condividono lo stesso scaricamento invece di farne uno per chiamante.
   */
  async url(mediaKey: string): Promise<string> {
    const ready = this.urls.get(mediaKey);
    if (ready) return ready;

    const inFlight = this.pending.get(mediaKey);
    if (inFlight) return inFlight;

    const work = this.load(mediaKey);
    this.pending.set(mediaKey, work);

    try {
      return await work;
    } finally {
      this.pending.delete(mediaKey);
    }
  }

  private async load(mediaKey: string): Promise<string> {
    const encrypted = await fetchEncrypted(mediaKey);
    const plain = await decryptBlob(this.key, encrypted);
    // Il tipo è noto: tutto ciò che carichiamo lo produciamo noi in WebP.
    const url = URL.createObjectURL(new Blob([plain], { type: 'image/webp' }));
    this.urls.set(mediaKey, url);
    return url;
  }

  /** Scalda la cache in sottofondo, senza far fallire nulla se una foto non arriva. */
  async preload(mediaKeys: string[], concurrency = 6): Promise<void> {
    const queue = [...mediaKeys];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        await this.url(next).catch(() => undefined);
      }
    });
    await Promise.all(workers);
  }

  has(mediaKey: string): boolean {
    return this.urls.has(mediaKey);
  }

  /** Da chiamare lasciando la pagina. Senza, la memoria non torna indietro. */
  revokeAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
