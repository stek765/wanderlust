/**
 * Il pulsante "+ Aggiungi foto", l'avanzamento, e il modo di fermarsi.
 *
 * Compare solo a chi ha il token di scrittura, cioè a chi ha toccato il magnete. Chi
 * arriva da un link condiviso non lo vede nemmeno.
 *
 * Qui si incontrano tutti i pezzi: ridimensiona → cifra → carica → registra. L'ordine
 * conta: la foto viene cifrata prima di toccare la rete, sempre.
 *
 * Le tre regole che governano questo file, tutte scritte guardando trenta foto partire
 * insieme da un telefono:
 *
 *   1. **Si prepara una foto alla volta, se ne caricano quattro.** Ridimensionare è
 *      lavoro di processore e di memoria, caricare è attesa di rete: sono due code
 *      diverse e mescolarle fa danni (vedi `prepara`).
 *   2. **Ogni foto che arriva si vede subito.** Non alla fine: durante. Una griglia che
 *      si riempie è l'unica prova che il telefono non si è impiantato.
 *   3. **Si può sempre fermare.** Trenta foto scelte per sbaglio non devono costringere
 *      a guardare una barra fino in fondo.
 */

import type { PhotoDto } from '../../shared/api-types';
import { registerPhoto, uploadMedia } from '../lib/api-client';
import { encryptBlob } from '../lib/crypto';
import { processImage, type ProcessedImage } from '../lib/media';
import { UploadQueue, type UploadProgress } from '../lib/uploader';

export interface UploadPanelOptions {
  container: HTMLElement;
  slug: string;
  writeToken: string;
  key: CryptoKey;
  /**
   * Una foto è arrivata: è già registrata e ha il suo posto nella cronologia.
   *
   * Arrivano in chiaro **entrambe** le versioni, perché chi riceve la notizia possa
   * mostrarle senza riscaricare da R2 qualcosa che è appena partito da qui. Entrambe e non
   * solo la miniatura: il mosaico disegna la versione grande, e adottare solo la piccola
   * significherebbe rimandare a prenderne una che abbiamo già.
   */
  onPhotoAdded: (photo: PhotoDto, versioni: { thumb: Blob; full: Blob }) => void;
}

export class UploadPanel {
  private readonly status: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly trigger: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly failed: HTMLElement;

  /** La coda in corso. Null quando non si sta caricando niente. */
  private queue: UploadQueue | null = null;

  /**
   * Il turno per preparare le foto: una alla volta, in fila.
   *
   * Ridimensionare significa tenere in memoria l'immagine decodificata — una foto da 12
   * megapixel sono una cinquantina di megabyte di pixel veri — più i due canvas su cui
   * viene ridisegnata. Quattro insieme sono duecento megabyte, e Safari su iPhone chiude
   * la scheda molto prima di arrivarci. Caricare invece è quasi solo attesa, e lì le
   * quattro in parallelo servono davvero: quello che tengono in mano è un blob compresso
   * da poche centinaia di kilobyte.
   *
   * Il `catch` mantiene la fila intatta: una foto che non si lascia leggere non deve
   * impedire alle successive di prendere il proprio turno.
   */
  private turno: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: UploadPanelOptions) {
    const panel = document.createElement('div');
    panel.className = 'uploader';

    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = 'image/*';
    this.input.multiple = true;
    this.input.hidden = true;
    this.input.addEventListener('change', () => void this.start());

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'uploader__trigger';
    this.trigger.textContent = '+ Aggiungi foto';
    this.trigger.addEventListener('click', () => this.input.click());

    this.bar = document.createElement('div');
    this.bar.className = 'uploader__bar';

    this.status = document.createElement('p');
    this.status.className = 'uploader__status';

    this.failed = document.createElement('ul');
    this.failed.className = 'uploader__failed';
    this.failed.hidden = true;

    this.stopButton = document.createElement('button');
    this.stopButton.type = 'button';
    this.stopButton.className = 'uploader__secondary';
    this.stopButton.textContent = 'Ferma';
    this.stopButton.hidden = true;
    this.stopButton.addEventListener('click', () => {
      if (!this.queue) return;
      this.queue.cancel();

      // Fermare non è istantaneo: le foto già in volo atterrano comunque, e fino ad allora
      // il pannello è ancora occupato. Senza questa riga il pulsante resta acceso e
      // identico a prima, e l'unica lettura possibile è "non ha funzionato".
      this.stopButton.disabled = true;
      this.stopButton.textContent = 'Fermo le ultime…';
    });

    this.retryButton = document.createElement('button');
    this.retryButton.type = 'button';
    this.retryButton.className = 'uploader__secondary';
    this.retryButton.textContent = 'Riprova le foto fallite';
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', () => void this.retry());

    panel.append(
      this.trigger,
      this.input,
      this.bar,
      this.status,
      this.failed,
      this.stopButton,
      this.retryButton,
    );
    options.container.append(panel);
  }

  private async start(): Promise<void> {
    const files = [...(this.input.files ?? [])];
    // Svuotato subito, non alla fine: senza, riscegliere gli stessi file dopo un errore
    // non emette nessun evento e il pulsante sembra morto.
    this.input.value = '';
    if (files.length === 0) return;

    const queue = new UploadQueue((file) => this.handleOne(file), {
      onProgress: (progress) => this.render(progress),
    });

    this.queue = queue;
    queue.add(files);
    await this.workUntilDone(queue);
  }

  /** Rimette in coda solo le foto fallite, e riparte da quelle. */
  private async retry(): Promise<void> {
    const queue = this.queue;
    if (!queue) return;

    queue.retryFailed();
    await this.workUntilDone(queue);
  }

  /**
   * Fa girare la coda tenendo i pulsanti coerenti con quello che sta succedendo.
   *
   * Il "+" resta spento per tutta la durata: una seconda selezione mentre la prima è a
   * metà darebbe due code sullo stesso pannello, due barre che si contraddicono e un
   * "Ferma" che non si sa più cosa ferma. Chi ha sbagliato album usa "Ferma" e ricomincia.
   */
  private async workUntilDone(queue: UploadQueue): Promise<void> {
    this.trigger.disabled = true;
    this.stopButton.hidden = false;
    this.stopButton.disabled = false;
    this.stopButton.textContent = 'Ferma';
    this.retryButton.hidden = true;

    try {
      this.render(await queue.run());
    } finally {
      this.trigger.disabled = false;
      this.stopButton.hidden = true;
    }
  }

  /** Il ciclo di vita di una singola foto, dall'album alla riga nel database. */
  private async handleOne(file: File): Promise<void> {
    const processed = await this.prepara(file);

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

    // Annunciata una per una, non in blocco alla fine: la griglia si riempie sotto gli
    // occhi di chi carica, ed è così che si vede che sta funzionando.
    this.options.onPhotoAdded(
      {
        id: registered.id,
        key,
        thumbKey,
        width: processed.width,
        height: processed.height,
        takenAt: processed.takenAt,
        sortIndex: registered.sortIndex,
      },
      { thumb: processed.thumb, full: processed.full },
    );
  }

  /** Il turno di preparazione: una foto alla volta. Vedi il commento su `turno`. */
  private prepara(file: File): Promise<ProcessedImage> {
    const mio = this.turno.then(() => processImage(file));
    this.turno = mio.catch(() => undefined);
    return mio;
  }

  private render(progress: UploadProgress): void {
    const finished = progress.done + progress.failed;
    const percent = progress.total === 0 ? 0 : Math.round((finished / progress.total) * 100);
    const inCorso = finished < progress.total && !progress.cancelled;

    this.bar.style.setProperty('--progress', `${percent}%`);
    this.bar.classList.toggle('is-active', inCorso);

    this.status.textContent = inCorso ? `Caricate ${progress.done} di ${progress.total}…` : this.summary(progress);
    this.retryButton.hidden = inCorso || progress.failed === 0;

    this.renderFailures(progress);
  }

  private summary(progress: UploadProgress): string {
    if (progress.cancelled) {
      const rimaste = progress.total - progress.done - progress.failed;
      // "Non partite" e non "annullate": quelle già in volo sono arrivate lo stesso, e
      // dire il contrario farebbe cercare foto che invece ci sono.
      return `Fermato: ${progress.done} caricate, ${rimaste} non partite.`;
    }
    if (progress.failed === 0) return `Fatto: ${progress.done} foto aggiunte.`;
    return `${progress.done} caricate, ${progress.failed} non sono passate.`;
  }

  /**
   * Quali foto non ce l'hanno fatta, con il loro nome e il loro motivo.
   *
   * Il conteggio da solo non basta: "3 non sono passate" su trenta foto lascia senza
   * sapere quali riscegliere, e senza capire se il problema è la rete o quel particolare
   * file. Il motivo la coda ce l'ha già, era solo tenuto per sé.
   */
  private renderFailures(progress: UploadProgress): void {
    const rotte = progress.items.filter((i) => i.status === 'fallito');
    this.failed.hidden = rotte.length === 0;
    this.failed.replaceChildren();

    for (const item of rotte) {
      const riga = document.createElement('li');
      riga.textContent = item.error ? `${item.file.name} — ${item.error}` : item.file.name;
      this.failed.append(riga);
    }
  }
}
