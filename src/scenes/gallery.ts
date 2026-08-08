/**
 * La griglia delle miniature.
 *
 * Regola che decide se un posto con 300 foto si apre o si pianta: qui dentro non si
 * scarica mai una foto a piena dimensione, e nemmeno tutte le miniature. Ogni riquadro
 * chiede la sua immagine solo quando sta per entrare nello schermo.
 */

import type { PhotoDto } from '../../shared/api-types';
import type { PhotoStore } from '../lib/photo-store';

export interface GalleryOptions {
  container: HTMLElement;
  photos: PhotoDto[];
  store: PhotoStore;
  onOpen: (index: number) => void;
}

export class Gallery {
  private readonly observer: IntersectionObserver;
  private readonly tiles = new Map<Element, PhotoDto>();

  constructor(private readonly options: GalleryOptions) {
    // 300px di anticipo: la miniatura arriva mentre il dito sta ancora scorrendo, così
    // non si vede mai il riquadro vuoto riempirsi.
    this.observer = new IntersectionObserver((entries) => this.onVisible(entries), { rootMargin: '300px' });
    this.render();
  }

  private render(): void {
    const grid = document.createElement('div');
    grid.className = 'grid';

    this.options.photos.forEach((photo, index) => {
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.type = 'button';
      tile.setAttribute('aria-label', `Foto ${index + 1} di ${this.options.photos.length}`);

      // I riquadri sono quadrati (lo impone il CSS) e non seguono le proporzioni della
      // foto: con verticali e orizzontali mescolate le righe si spezzano e restano
      // buchi. Ritagliare in anteprima non toglie niente — la foto intera si vede
      // toccandola.
      tile.addEventListener('click', () => this.options.onOpen(index));

      this.tiles.set(tile, photo);
      this.observer.observe(tile);
      grid.append(tile);
    });

    this.options.container.append(grid);
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

  private async fill(tile: HTMLElement, photo: PhotoDto): Promise<void> {
    try {
      const url = await this.options.store.url(photo.thumbKey);
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      tile.append(image);
      tile.classList.add('tile--loaded');
    } catch {
      // Una foto che non si decifra non deve portarsi dietro la griglia: resta un
      // riquadro segnato, tutto il resto continua a funzionare.
      tile.classList.add('tile--broken');
      tile.title = 'Questa foto non si apre';
    }
  }

  destroy(): void {
    this.observer.disconnect();
    this.tiles.clear();
  }
}
