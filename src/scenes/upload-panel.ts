/**
 * Il pulsante "+ Aggiungi foto" e la barra di avanzamento.
 *
 * Compare solo a chi ha il token di scrittura, cioè a chi ha toccato il magnete. Chi
 * arriva da un link condiviso non lo vede nemmeno.
 *
 * Qui si incontrano tutti i pezzi: ridimensiona → cifra → carica → registra. L'ordine
 * conta: la foto viene cifrata prima di toccare la rete, sempre.
 */

import type { PhotoDto } from '../../shared/api-types';
import { registerPhoto, uploadMedia } from '../lib/api-client';
import { encryptBlob } from '../lib/crypto';
import { processImage } from '../lib/media';
import { UploadQueue, type UploadProgress } from '../lib/uploader';

export interface UploadPanelOptions {
  container: HTMLElement;
  slug: string;
  writeToken: string;
  key: CryptoKey;
  /** Chiamata a caricamento finito, per rinfrescare la griglia. */
  onFinished: (added: PhotoDto[]) => void;
}

export class UploadPanel {
  private readonly status: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly retryButton: HTMLButtonElement;
  private added: PhotoDto[] = [];

  constructor(private readonly options: UploadPanelOptions) {
    const panel = document.createElement('div');
    panel.className = 'uploader';

    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = 'image/*';
    this.input.multiple = true;
    this.input.hidden = true;
    this.input.addEventListener('change', () => void this.start());

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'uploader__trigger';
    trigger.textContent = '+ Aggiungi foto';
    trigger.addEventListener('click', () => this.input.click());

    this.status = document.createElement('p');
    this.status.className = 'uploader__status';

    this.bar = document.createElement('div');
    this.bar.className = 'uploader__bar';

    this.retryButton = document.createElement('button');
    this.retryButton.type = 'button';
    this.retryButton.className = 'uploader__retry';
    this.retryButton.textContent = 'Riprova le foto fallite';
    this.retryButton.hidden = true;

    panel.append(trigger, this.input, this.bar, this.status, this.retryButton);
    options.container.append(panel);
  }

  private async start(): Promise<void> {
    const files = [...(this.input.files ?? [])];
    if (files.length === 0) return;

    this.added = [];
    const queue = new UploadQueue((file) => this.handleOne(file), {
      onProgress: (progress) => this.renderProgress(progress),
    });

    queue.add(files);
    const result = await queue.run();

    // Il pulsante di ripetizione compare solo se serve davvero.
    this.retryButton.hidden = result.failed === 0;
    this.retryButton.onclick = () => {
      queue.retryFailed();
      void queue.run().then((again) => {
        this.retryButton.hidden = again.failed === 0;
        this.finish(again);
      });
    };

    this.finish(result);
    // Permette di riselezionare gli stessi file dopo un errore.
    this.input.value = '';
  }

  /** Il ciclo di vita di una singola foto, dall'album alla riga nel database. */
  private async handleOne(file: File): Promise<void> {
    const processed = await processImage(file);

    // Cifratura prima della rete: da questo punto in poi nessuno, nemmeno Cloudflare,
    // può vedere cosa c'è dentro.
    const [encryptedFull, encryptedThumb] = await Promise.all([
      encryptBlob(this.options.key, await processed.full.arrayBuffer()),
      encryptBlob(this.options.key, await processed.thumb.arrayBuffer()),
    ]);

    const [key, thumbKey] = await Promise.all([
      uploadMedia(this.options.slug, this.options.writeToken, encryptedFull, 'full'),
      uploadMedia(this.options.slug, this.options.writeToken, encryptedThumb, 'thumb'),
    ]);

    const registered = await registerPhoto(this.options.slug, this.options.writeToken, {
      key,
      thumbKey,
      width: processed.width,
      height: processed.height,
      takenAt: processed.takenAt,
    });

    this.added.push({
      id: registered.id,
      key,
      thumbKey,
      width: processed.width,
      height: processed.height,
      takenAt: processed.takenAt,
      sortIndex: registered.sortIndex,
    });
  }

  private renderProgress(progress: UploadProgress): void {
    const finished = progress.done + progress.failed;
    const percent = progress.total === 0 ? 0 : Math.round((finished / progress.total) * 100);

    this.bar.style.setProperty('--progress', `${percent}%`);
    this.bar.classList.toggle('is-active', finished < progress.total);

    this.status.textContent =
      finished < progress.total
        ? `Caricate ${progress.done} di ${progress.total}…`
        : this.summary(progress);
  }

  private summary(progress: UploadProgress): string {
    if (progress.failed === 0) return `Fatto: ${progress.done} foto aggiunte.`;
    return `${progress.done} caricate, ${progress.failed} non sono passate.`;
  }

  private finish(progress: UploadProgress): void {
    this.renderProgress(progress);
    if (this.added.length > 0) {
      this.options.onFinished([...this.added]);
      this.added = [];
    }
  }
}
