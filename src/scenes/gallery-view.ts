/**
 * Le foto di una tappa, a schermo intero, in ordine cronologico.
 *
 * Si apre toccando una scheda del carosello e copre la mappa. È l'unico posto del sito
 * dove si sfoglia: la schermata principale serve a scegliere dove, questa a guardare cosa.
 *
 * Una sola istanza per pagina, riusata per ogni tappa. Con una vista per tappa si
 * ritroverebbero otto sovrapposti a schermo intero nel documento, tutti nascosti, tutti
 * pronti a sbagliare — lo stesso motivo per cui il visore è uno solo.
 */

import type { PhotoDto, StopDto } from '../../shared/api-types';
import type { PhotoStore } from '../lib/photo-store';
import { averageColor, toGlow, toTint } from '../lib/tinta';
import { Gallery } from './gallery';
import { UploadPanel } from './upload-panel';

export interface GalleryViewOptions {
  store: PhotoStore;
  /** Null per chi è arrivato da un link condiviso: niente "+", niente "Elimina". */
  writeToken: string | null;
  /** La chiave del viaggio, per cifrare quello che si carica. */
  key: CryptoKey;
  onOpenPhoto: (photos: PhotoDto[], index: number) => void;
  /** L'elenco è cambiato: la scheda nel carosello va riallineata. */
  onPhotosChanged: (stopSlug: string, photos: PhotoDto[]) => void;
}

export class GalleryView {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly host: HTMLElement;
  private readonly uploaderHost: HTMLElement;
  private gallery: Gallery | null = null;
  private stop: StopDto | null = null;
  private photos: PhotoDto[] = [];
  private cambioInSospeso = false;
  /** Di quale foto è la tinta attualmente applicata: ricalcolarla a ogni foto è sprecato. */
  private tintaDi: string | null = null;

  constructor(private readonly options: GalleryViewOptions) {
    this.element = document.createElement('section');
    this.element.className = 'shelf';
    this.element.hidden = true;

    const bar = document.createElement('header');
    bar.className = 'shelf__bar';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'shelf__back';
    back.setAttribute('aria-label', 'Torna alla mappa');
    back.textContent = '‹';
    back.addEventListener('click', () => this.close());

    this.title = document.createElement('h2');
    this.title.className = 'shelf__title';

    this.meta = document.createElement('p');
    this.meta.className = 'shelf__meta';

    const testi = document.createElement('div');
    testi.className = 'shelf__texts';
    testi.append(this.title, this.meta);

    bar.append(back, testi);

    this.host = document.createElement('div');
    this.host.className = 'gallery';

    this.uploaderHost = document.createElement('div');

    this.element.append(bar, this.host, this.uploaderHost);
  }

  /** Mostra le foto di questa tappa. L'elenco arriva da fuori: qui non si interroga niente. */
  open(stop: StopDto, photos: PhotoDto[]): void {
    this.stop = stop;
    this.photos = photos;

    this.title.textContent = stop.name;
    this.meta.textContent = describeSpan(photos);

    this.redraw();
    this.buildUploader();
    void this.applyTint();

    this.element.hidden = false;
    document.body.classList.add('is-locked');
    // Ogni apertura riparte dall'alto: si entra da un tocco, non da dove si era rimasti.
    this.element.scrollTop = 0;
  }

  close(): void {
    this.element.hidden = true;
    document.body.classList.remove('is-locked');
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  /** La tappa attualmente aperta, per chi deve cancellare una delle sue foto. */
  currentSlug(): string | null {
    return this.stop?.slug ?? null;
  }

  /** Toglie una foto dall'elenco, dopo che il server l'ha già cancellata. */
  forget(photo: PhotoDto): void {
    if (!this.stop) return;
    this.photos = this.photos.filter((p) => p.id !== photo.id);
    this.afterChange();
  }

  private redraw(): void {
    this.gallery?.destroy();
    this.host.replaceChildren();

    if (this.photos.length === 0) {
      this.host.append(emptyState(Boolean(this.options.writeToken)));
      return;
    }

    this.gallery = new Gallery({
      container: this.host,
      photos: this.photos,
      store: this.options.store,
      onOpen: (index) => this.options.onOpenPhoto(this.photos, index),
    });
  }

  private buildUploader(): void {
    this.uploaderHost.replaceChildren();
    const stop = this.stop;
    if (!stop || !this.options.writeToken) return;

    new UploadPanel({
      container: this.uploaderHost,
      slug: stop.slug,
      writeToken: this.options.writeToken,
      key: this.options.key,
      onPhotoAdded: (photo, thumb) => {
        // La miniatura ce l'abbiamo già in chiaro: darla al magazzino evita di riscaricare
        // da R2 e ridecifrare una foto che è appena partita da questo telefono.
        this.options.store.adopt(photo.thumbKey, thumb);

        this.photos = [...this.photos, photo].sort((a, b) => a.sortIndex - b.sortIndex);
        this.scheduleChange();
      },
    });
  }

  /**
   * Raggruppa i riallineamenti in uno per fotogramma.
   *
   * Le foto arrivano a quattro per volta e ognuna ridisegna la griglia intera: senza
   * questo, trenta foto significano trenta ricostruzioni in pochi secondi, ognuna con il
   * suo giro di osservatori e il suo ricalcolo della tinta. Il risultato visibile sarebbe
   * lo stesso, il costo no.
   */
  private scheduleChange(): void {
    if (this.cambioInSospeso) return;
    this.cambioInSospeso = true;

    requestAnimationFrame(() => {
      this.cambioInSospeso = false;
      this.afterChange();
    });
  }

  /**
   * Riallinea tutto quello che dipende dall'elenco.
   *
   * Serve perché caricare o cancellare cambia tre cose insieme — la griglia, la riga delle
   * date e la scheda nel carosello — e aggiornarne una sola lascia sullo schermo la
   * contraddizione più fastidiosa possibile: "0 foto" scritto sopra tre foto.
   */
  private afterChange(): void {
    if (!this.stop) return;
    this.meta.textContent = describeSpan(this.photos);
    this.redraw();
    this.options.onPhotosChanged(this.stop.slug, this.photos);
    void this.applyTint();
  }

  /** Tinge la vista col colore delle sue foto: il mare fa ciano, il tramonto arancio. */
  private async applyTint(): Promise<void> {
    const prima = this.photos[0];
    if (!prima) return;
    // La tinta viene dalla prima foto, che durante un caricamento resta quasi sempre la
    // stessa: senza questo controllo si ripasserebbe il colore medio a ogni foto che arriva.
    if (this.tintaDi === prima.thumbKey) return;
    this.tintaDi = prima.thumbKey;

    try {
      const colore = await averageColor(await this.options.store.url(prima.thumbKey));
      if (!colore) return;

      this.element.style.setProperty('--tinta', toTint(colore, 0.14));
      this.element.style.setProperty('--tinta-viva', toGlow(colore));
    } catch {
      // Nessuna tinta, nessun problema: è decorazione, non contenuto.
    }
  }
}

/** "13 - 15 aprile 2026 · 22 foto", o solo il conteggio se l'EXIF non c'era. */
export function describeSpan(photos: PhotoDto[]): string {
  const dates = photos.map((p) => p.takenAt).filter((d): d is number => typeof d === 'number');
  const count = `${photos.length} foto`;
  if (dates.length === 0) return count;

  const format = (ms: number) =>
    new Date(ms).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  const first = format(Math.min(...dates));
  const last = format(Math.max(...dates));

  return first === last ? `${first} · ${count}` : `${first} - ${last} · ${count}`;
}

/** La data corta per la colonna a sinistra del carosello: "12 apr" sopra l'anno. */
export function shortDate(photos: PhotoDto[]): { giorno: string; anno: string } | null {
  const dates = photos.map((p) => p.takenAt).filter((d): d is number => typeof d === 'number');
  if (dates.length === 0) return null;

  const quando = new Date(Math.min(...dates));
  return {
    giorno: quando.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }),
    anno: String(quando.getFullYear()),
  };
}

function emptyState(canUpload: boolean): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = canUpload
    ? 'Ancora nessuna foto qui. Tocca "+ Aggiungi foto" per cominciare.'
    : 'Qui non c\'è ancora niente.';
  return empty;
}
