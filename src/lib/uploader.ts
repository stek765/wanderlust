/**
 * La coda di caricamento.
 *
 * È il punto del progetto dove l'utente può frustrarsi davvero, quindi le regole sono
 * severe: un fallimento non deve mai far ricominciare tutto, la rete che cade non è un
 * errore ma una pausa, e in ogni istante deve essere chiaro a che punto siamo.
 *
 * Quattro foto in parallelo: abbastanza da saturare una connessione mobile, poche
 * abbastanza da non far collassare la memoria di un telefono mentre ridimensiona.
 */

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

export type ItemStatus = 'attesa' | 'in-corso' | 'fatto' | 'fallito';

export interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  attempts: number;
  error?: string;
}

export interface UploadProgress {
  items: QueueItem[];
  done: number;
  failed: number;
  total: number;
  /** Vero se qualcuno ha fermato la coda: le foto rimaste in attesa ci restano. */
  cancelled: boolean;
}

/** Cosa fare con una singola foto. Isolato così la coda resta testabile senza rete. */
export type UploadOne = (file: File) => Promise<void>;

export interface UploaderOptions {
  onProgress?: (progress: UploadProgress) => void;
  /** Vero se c'è rete. Iniettabile perché navigator.onLine non si simula nei test. */
  isOnline?: () => boolean;
  /** Attesa prima di riprovare, in millisecondi. */
  waitBeforeRetry?: (attempt: number) => Promise<void>;
}

export class UploadQueue {
  private readonly items: QueueItem[] = [];
  private nextIndex = 0;
  private running = false;
  private cancelled = false;

  constructor(
    private readonly uploadOne: UploadOne,
    private readonly options: UploaderOptions = {},
  ) {}

  add(files: File[]): void {
    // Scegliere altre foto è una richiesta nuova: se la coda era stata fermata, riparte.
    this.cancelled = false;

    for (const file of files) {
      this.items.push({
        id: `${file.name}:${file.size}:${this.items.length}`,
        file,
        status: 'attesa',
        attempts: 0,
      });
    }
    this.report();
  }

  get progress(): UploadProgress {
    return {
      items: [...this.items],
      done: this.items.filter((i) => i.status === 'fatto').length,
      failed: this.items.filter((i) => i.status === 'fallito').length,
      total: this.items.length,
      cancelled: this.cancelled,
    };
  }

  /**
   * Ferma la coda: da qui in poi non parte più niente.
   *
   * Quello che è già in volo arriva comunque — una richiesta HTTP a metà non si richiama
   * indietro, e fingere il contrario significherebbe dire "annullato" a una foto che nel
   * frattempo si sta salvando. Le foto ancora in attesa restano in attesa, non diventano
   * fallite: non sono andate male, semplicemente non sono partite.
   */
  cancel(): void {
    this.cancelled = true;
    this.report();
  }

  /** Rimette in coda le foto fallite. Solo quelle: le altre sono già a posto. */
  retryFailed(): void {
    this.cancelled = false;

    for (const item of this.items) {
      if (item.status === 'fallito') {
        item.status = 'attesa';
        item.attempts = 0;
        delete item.error;
      }
    }
    this.nextIndex = 0;
    this.report();
  }

  /** Lavora la coda fino in fondo. Chiamarla mentre già gira non fa partire un secondo giro. */
  async run(): Promise<UploadProgress> {
    if (this.running) return this.progress;
    this.running = true;

    try {
      const workers = Array.from({ length: Math.min(CONCURRENCY, this.items.length) }, () => this.worker());
      await Promise.all(workers);
      return this.progress;
    } finally {
      this.running = false;
    }
  }

  private async worker(): Promise<void> {
    for (;;) {
      const item = this.takeNext();
      if (!item) return;

      item.status = 'in-corso';
      this.report();

      await this.attempt(item);
      this.report();
    }
  }

  private async attempt(item: QueueItem): Promise<void> {
    while (item.attempts < MAX_ATTEMPTS) {
      await this.waitForNetwork();
      // Fermata mentre aspettava la rete, o fra un tentativo e l'altro: torna in attesa.
      if (this.cancelled) {
        item.status = 'attesa';
        return;
      }
      item.attempts++;

      try {
        await this.uploadOne(item.file);
        item.status = 'fatto';
        return;
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
        if (item.attempts < MAX_ATTEMPTS) {
          await this.backoff(item.attempts);
        }
      }
    }

    // Esaurito il numero di tentativi la foto resta visibile come fallita, con il suo
    // errore: sparire in silenzio sarebbe il modo peggiore di perdere un ricordo.
    item.status = 'fallito';
  }

  /**
   * La rete assente non consuma tentativi: la coda aspetta e riprende da sola. Un
   * ascensore non deve costare una foto.
   */
  private async waitForNetwork(): Promise<void> {
    const isOnline = this.options.isOnline ?? (() => navigator.onLine);
    // La fermata va guardata anche qui, o una coda ferma senza rete aspetterebbe per sempre
    // un ritorno che a nessuno interessa più.
    while (!isOnline() && !this.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const wait = this.options.waitBeforeRetry ?? ((n: number) => new Promise<void>((r) => setTimeout(r, 400 * 2 ** (n - 1))));
    await wait(attempt);
  }

  private takeNext(): QueueItem | undefined {
    if (this.cancelled) return undefined;

    while (this.nextIndex < this.items.length) {
      const item = this.items[this.nextIndex++];
      if (item && item.status === 'attesa') return item;
    }
    return undefined;
  }

  private report(): void {
    this.options.onProgress?.(this.progress);
  }
}
