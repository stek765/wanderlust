/**
 * Il mosaico delle miniature.
 *
 * Regola che decide se un posto con 300 foto si apre o si pianta: qui dentro non si
 * scarica mai una foto a piena dimensione, e nemmeno tutte le miniature. Ogni riquadro
 * chiede la sua immagine solo quando sta per entrare nello schermo.
 *
 * **Non è più una griglia di quadrati.** Ogni foto tiene le proprie proporzioni e i
 * riquadri si incastrano: le verticali sono alte, le orizzontali basse, e la pagina
 * smette di sembrare un foglio Excel. Prima erano tutti quadrati con la foto ritagliata
 * al centro — comodo per il layout, ma un ritaglio automatico taglia le teste, e su una
 * pagina che esiste per guardare le foto è il difetto peggiore possibile.
 *
 * **Due colonne, quindi ogni foto è mezza schermata.** È la misura in cui una faccia si
 * riconosce senza aprire niente.
 *
 * Perché l'altezza si calcola qui invece di lasciarla al CSS: incastrare riquadri di
 * altezze diverse senza buchi richiede di sapere quante righe occupa ognuno, e il CSS da
 * solo non sa quanto è alta una foto che non ha ancora scaricato. Le proporzioni però le
 * abbiamo già nel database, quindi il conto si fa prima che l'immagine arrivi — ed è per
 * questo che la pagina non balla mentre si riempie.
 */

import type { PhotoDto } from '../../shared/api-types';
import type { PhotoStore } from '../lib/photo-store';

export interface GalleryOptions {
  container: HTMLElement;
  photos: PhotoDto[];
  store: PhotoStore;
  onOpen: (index: number) => void;
}

/** L'unità di riga del mosaico, in pixel. Piccola: più è fine, meglio si incastrano. */
const RIGA = 6;
/** Lo spazio fra i riquadri. Sottile di proposito: le foto devono toccarsi quasi. */
const SPAZIO = 3;

/** Quante colonne, in base a quanto è largo lo spazio disponibile. */
function colonne(larghezza: number): number {
  if (larghezza >= 900) return 4;
  if (larghezza >= 560) return 3;
  return 2;
}

export class Gallery {
  private readonly observer: IntersectionObserver;
  private readonly tiles = new Map<Element, PhotoDto>();
  private readonly grid: HTMLElement;
  private readonly resize: ResizeObserver;

  constructor(private readonly options: GalleryOptions) {
    // 300px di anticipo: la miniatura arriva mentre il dito sta ancora scorrendo, così
    // non si vede mai il riquadro vuoto riempirsi.
    this.observer = new IntersectionObserver((entries) => this.onVisible(entries), { rootMargin: '300px' });

    this.grid = document.createElement('div');
    this.grid.className = 'grid';

    this.render();
    this.options.container.append(this.grid);

    // Ruotando il telefono cambia tutto: larghezza, numero di colonne e quindi l'altezza
    // di ogni riquadro. Senza, il mosaico resterebbe disegnato per l'orientamento di prima.
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.grid);
  }

  private render(): void {
    this.options.photos.forEach((photo, index) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.type = 'button';
      tile.setAttribute('aria-label', `Foto ${index + 1} di ${this.options.photos.length}`);
      tile.addEventListener('click', () => this.options.onOpen(index));

      this.tiles.set(tile, photo);
      this.observer.observe(tile);
      this.grid.append(tile);
    });

    this.layout();
  }

  /**
   * Dà a ogni riquadro l'altezza che gli spetta, in righe della griglia.
   *
   * Una foto senza dimensioni note — non dovrebbe succedere, ma il database le accetta
   * come numeri qualsiasi — viene trattata come quadrata invece di far collassare la riga.
   */
  private layout(): void {
    const larghezza = this.grid.clientWidth;
    if (larghezza === 0) return;

    const colonneOra = colonne(larghezza);
    this.grid.style.gridTemplateColumns = `repeat(${colonneOra}, 1fr)`;

    const larghezzaColonna = (larghezza - SPAZIO * (colonneOra - 1)) / colonneOra;

    for (const [element, photo] of this.tiles) {
      const proporzione = photo.width > 0 && photo.height > 0 ? photo.height / photo.width : 1;
      const altezza = larghezzaColonna * proporzione;
      const righe = Math.max(1, Math.round((altezza + SPAZIO) / (RIGA + SPAZIO)));
      (element as HTMLElement).style.gridRow = `span ${righe}`;
    }
  }

  private onVisible(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      const photo = this.tiles.get(entry.target);
      if (!photo) continue;

      // Una sola volta per riquadro: da qui in poi l'immagine è nel DOM.
      this.observer.unobserve(entry.target);
      void this.fill(entry.target as HTMLElement, photo);
    }
  }

  /**
   * Prima la miniatura, poi la foto vera.
   *
   * Le due strade da sole sbagliavano entrambe. Solo la miniatura: 300px stirati su mezza
   * schermata, e si vedevano i pixel. Solo la foto grande: aprire una tappa faceva partire
   * la decifratura di dodici immagini da mezzo megabyte **durante** l'animazione di
   * apertura, e AES sul thread principale mentre un pannello sale significa un pannello
   * che sale a scatti. Era il prezzo nascosto della nitidezza, e si sentiva tutto.
   *
   * Così invece il riquadro si riempie subito con quello che costa poco, e la versione
   * buona arriva quando il browser non ha altro da fare. Chi guarda vede una foto nitida
   * senza aver aspettato, e senza che l'apertura abbia singhiozzato.
   */
  private async fill(tile: HTMLElement, photo: PhotoDto): Promise<void> {
    try {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';

      image.src = await this.options.store.url(photo.thumbKey);
      tile.append(image);
      tile.classList.add('tile--loaded');

      this.upgrade(image, photo);
    } catch {
      // Una foto che non si decifra non deve portarsi dietro la griglia: resta un
      // riquadro segnato, tutto il resto continua a funzionare.
      tile.classList.add('tile--broken');
      tile.title = 'Questa foto non si apre';
    }
  }

  /**
   * Sostituisce la miniatura con la foto vera, quando c'è tempo.
   *
   * `requestIdleCallback` è la differenza fra "nitido" e "nitido senza far scattare
   * niente": aspetta che il browser abbia finito di animare, disegnare e rispondere al
   * dito. Safari non ce l'ha, e lì si ripiega su un ritardo fisso più lungo
   * dell'animazione di apertura — grezzo, ma con lo stesso effetto.
   *
   * Il cambio di `src` non si vede: l'immagine è la stessa scena, alla stessa posizione,
   * solo con più dettaglio. L'unico modo di accorgersene è guardarla da vicino.
   */
  private upgrade(image: HTMLImageElement, photo: PhotoDto): void {
    const sostituisci = async () => {
      // Il riquadro può essere già stato buttato via nel frattempo: cambiare posta a un
      // indirizzo che non esiste più significa decifrare mezzo megabyte per niente.
      if (!image.isConnected) return;

      try {
        const url = await this.options.store.url(photo.key);
        if (!image.isConnected) return;

        /*
         * La foto grande si decodifica PRIMA di finire sullo schermo.
         *
         * Assegnando la sorgente direttamente, il riquadro resta un istante senza niente
         * mentre il browser prepara l'immagine nuova: su una griglia intera diventa un
         * lampeggio diffuso, e sembra che le foto si stiano ricaricando. Qui la decodifica
         * avviene su un'immagine staccata dal documento, e lo scambio arriva a lavoro
         * finito — cioè non si vede.
         */
        const pronta = new Image();
        pronta.src = url;
        await pronta.decode().catch(() => undefined);

        if (image.isConnected) image.src = url;
      } catch {
        // La miniatura è già a posto: senza la versione grande si vede lo stesso.
      }
    };

    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;

    if (idle) idle(() => void sostituisci(), { timeout: 2000 });
    else setTimeout(() => void sostituisci(), 600);
  }

  destroy(): void {
    this.observer.disconnect();
    this.resize.disconnect();
    this.tiles.clear();
  }
}
