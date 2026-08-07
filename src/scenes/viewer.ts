/**
 * La foto a schermo intero, con scorrimento fra una e l'altra.
 *
 * Qui si carica la versione grande — l'unico punto del sito in cui succede. Mentre si
 * guarda una foto, le due adiacenti vengono preparate in sottofondo: scorrere deve
 * sembrare istantaneo anche se ogni immagine va prima decifrata.
 */

import type { PhotoDto } from '../../shared/api-types';
import type { PhotoStore } from '../lib/photo-store';

export interface ViewerActions {
  /** Presenti solo per chi ha il token di scrittura. */
  onSetCover?: (photo: PhotoDto) => Promise<void>;
  onDelete?: (photo: PhotoDto) => Promise<void>;
}

export class Viewer {
  private readonly root: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLElement;
  private index = 0;
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKey(event);

  constructor(
    private readonly photos: PhotoDto[],
    private readonly store: PhotoStore,
    private readonly actions: ViewerActions = {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'viewer';
    this.root.hidden = true;

    this.image = document.createElement('img');
    this.image.className = 'viewer__image';
    this.image.alt = '';

    this.caption = document.createElement('p');
    this.caption.className = 'viewer__caption';

    this.root.append(this.buildTopBar(), this.image, this.caption, this.buildNav());
    document.body.append(this.root);
    this.attachSwipe();
  }

  async open(index: number): Promise<void> {
    this.index = index;
    this.root.hidden = false;
    // Il corpo non deve scorrere dietro alla foto aperta.
    document.body.classList.add('is-locked');
    document.addEventListener('keydown', this.onKeyDown);
    await this.show();
  }

  close(): void {
    this.root.hidden = true;
    document.body.classList.remove('is-locked');
    document.removeEventListener('keydown', this.onKeyDown);
  }

  private async show(): Promise<void> {
    const photo = this.photos[this.index];
    if (!photo) return;

    this.image.classList.add('is-loading');
    this.caption.textContent = this.describe(photo);

    try {
      this.image.src = await this.store.url(photo.key);
    } catch {
      this.caption.textContent = 'Questa foto non si apre.';
    } finally {
      this.image.classList.remove('is-loading');
    }

    this.preloadNeighbours();
  }

  /** Prepara la precedente e la successiva: lo scorrimento non deve mai aspettare. */
  private preloadNeighbours(): void {
    const neighbours = [this.photos[this.index - 1], this.photos[this.index + 1]]
      .filter((p): p is PhotoDto => Boolean(p))
      .map((p) => p.key);

    void this.store.preload(neighbours, 2);
  }

  private describe(photo: PhotoDto): string {
    if (!photo.takenAt) return `${this.index + 1} di ${this.photos.length}`;
    const date = new Date(photo.takenAt).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return `${date} · ${this.index + 1} di ${this.photos.length}`;
  }

  private async move(delta: number): Promise<void> {
    const next = this.index + delta;
    if (next < 0 || next >= this.photos.length) return;
    this.index = next;
    await this.show();
  }

  private buildTopBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'viewer__bar';

    const close = button('Chiudi', 'viewer__close', () => this.close());
    bar.append(close);

    if (this.actions.onSetCover) {
      bar.append(
        button('Copertina', 'viewer__action', async () => {
          const photo = this.photos[this.index];
          if (photo) await this.actions.onSetCover?.(photo);
        }),
      );
    }

    if (this.actions.onDelete) {
      bar.append(
        button('Elimina', 'viewer__action viewer__action--danger', async () => {
          const photo = this.photos[this.index];
          if (!photo) return;
          // Volutamente non si usa confirm(): su iOS un dialogo di sistema qui è
          // brutto e blocca tutto. La conferma è il secondo tocco sul pulsante.
          const target = this.root.querySelector('.viewer__action--danger') as HTMLButtonElement | null;
          if (target && target.dataset.armed !== 'si') {
            target.dataset.armed = 'si';
            target.textContent = 'Confermi?';
            setTimeout(() => {
              target.dataset.armed = 'no';
              target.textContent = 'Elimina';
            }, 4000);
            return;
          }
          await this.actions.onDelete?.(photo);
          this.close();
        }),
      );
    }

    return bar;
  }

  private buildNav(): HTMLElement {
    const nav = document.createElement('div');
    nav.className = 'viewer__nav';
    nav.append(
      button('‹', 'viewer__arrow', () => void this.move(-1)),
      button('›', 'viewer__arrow', () => void this.move(1)),
    );
    return nav;
  }

  /** Scorrimento col dito: su un telefono è il gesto naturale, le frecce sono un ripiego. */
  private attachSwipe(): void {
    let startX = 0;
    this.root.addEventListener('touchstart', (event) => {
      startX = event.changedTouches[0]?.clientX ?? 0;
    });
    this.root.addEventListener('touchend', (event) => {
      const endX = event.changedTouches[0]?.clientX ?? 0;
      const distance = endX - startX;
      // Sotto i 50px è un tocco storto, non una strisciata.
      if (Math.abs(distance) < 50) return;
      void this.move(distance < 0 ? 1 : -1);
    });
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.close();
    if (event.key === 'ArrowLeft') void this.move(-1);
    if (event.key === 'ArrowRight') void this.move(1);
  }
}

function button(label: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', () => void onClick());
  return element;
}
