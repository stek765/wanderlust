/**
 * La foto a schermo intero, con scorrimento fra una e l'altra.
 *
 * Qui si carica la versione grande — l'unico punto del sito in cui succede. Mentre si
 * guarda una foto, le due adiacenti vengono preparate in sottofondo: scorrere deve
 * sembrare istantaneo anche se ogni immagine va prima decifrata.
 */

import type { PhotoDto } from '../../shared/api-types';
import type { PhotoStore } from '../lib/photo-store';
import { concludi, Velocita } from '../lib/gesto';

export interface ViewerActions {
  /** Presente solo per chi ha il token di scrittura. */
  onDelete?: (photo: PhotoDto) => Promise<void>;
}

export class Viewer {
  private readonly root: HTMLElement;
  /** La fila che si trascina: dentro ci sono sempre e solo tre foto. */
  private readonly track: HTMLElement;
  /** Precedente, corrente, successiva. La posizione nell'array non cambia mai. */
  private readonly slots: HTMLImageElement[];
  /** Lo sfondo sfocato di ogni lastra, che riempie le bande lasciate dalla foto. */
  private readonly blurs: HTMLElement[];
  private readonly caption: HTMLElement;
  private index = 0;
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKey(event);
  /**
   * L'assestamento ancora da concludere, se ce n'è uno.
   *
   * Prima la conclusione era appesa a `transitionend`, e bastava cominciare un secondo
   * gesto prima che l'animazione finisse perché quell'evento non arrivasse mai: la
   * transizione veniva sostituita, l'ascoltatore restava lì, e l'indice non si aggiornava.
   * Il gesto dopo ne faceva scattare due insieme e la fila restava parcheggiata a metà fra
   * due foto. Andando piano non succedeva mai; andando veloce, sempre.
   *
   * Con un lavoro in sospeso richiamabile a mano, un gesto nuovo chiude prima quello di
   * prima: lo stato non può restare a metà, qualunque cosa faccia il dito.
   */
  private inSospeso: (() => void) | null = null;

  constructor(
    private photos: PhotoDto[],
    private readonly store: PhotoStore,
    private actions: ViewerActions = {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'viewer';
    this.root.hidden = true;

    /*
     * Tre foto affiancate e non una sola: la precedente, quella aperta, la successiva.
     *
     * Con un'immagine sola lo scorrimento poteva solo essere uno scambio di `src` a gesto
     * finito — la foto non seguiva il dito e appariva di colpo, che è il difetto che
     * questo pezzo esiste per togliere. Tenendone tre in fila si trascina la fila: le
     * vicine si affacciano dai bordi mentre il dito si muove, e chi guarda vede dove sta
     * andando prima di arrivarci.
     *
     * Tre e non tutte: un viaggio da trecento foto in fila sarebbero trecento immagini
     * nel documento. Alla fine di ogni scorrimento la fila si ricompone attorno alla
     * nuova foto centrale.
     */
    this.track = document.createElement('div');
    this.track.className = 'viewer__track';

    /*
     * Ogni foto sta dentro una lastra che porta anche il proprio sfondo sfocato.
     *
     * Una foto verticale su uno schermo verticale lascia due bande ai lati, e finché erano
     * nere sembravano un pezzo mancante dell'interfaccia. Riempendole con la stessa foto
     * ingrandita e sfocata, quelle bande smettono di essere un buco e diventano un
     * proseguimento della foto — è il trucco che usano le gallerie dei telefoni, e funziona
     * perché il colore che ci finisce è sempre quello giusto: viene dalla foto stessa.
     */
    this.blurs = [];
    this.slots = [0, 1, 2].map(() => {
      const slide = document.createElement('div');
      slide.className = 'viewer__slide';

      const sfondo = document.createElement('div');
      sfondo.className = 'viewer__blur';
      sfondo.setAttribute('aria-hidden', 'true');
      this.blurs.push(sfondo);

      const image = document.createElement('img');
      image.className = 'viewer__image';
      image.alt = '';
      image.draggable = false;

      slide.append(sfondo, image);
      this.track.append(slide);
      return image;
    });

    this.caption = document.createElement('p');
    this.caption.className = 'viewer__caption';

    // Il contatore vive dentro la barra, non in una riga sua: da solo in mezzo al nero
    // sembrava un residuo, e rubava spazio verticale alla foto.
    // La didascalia sta fuori dalla barra: dentro, essendo la barra posizionata, si
    // ancorava a lei e restava in cima invece di andare in fondo.
    this.root.append(this.track, this.buildTopBar(), this.caption, this.buildNav());
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

  /**
   * Cambia l'elenco su cui si scorre.
   *
   * Il visore è uno solo per tutta la pagina, mentre le tappe sono tante: aprire una foto
   * di Phuket significa prima dirgli che adesso si scorre fra quelle di Phuket. Un visore
   * per tappa sarebbe stato più semplice da scrivere e avrebbe lasciato in pagina otto
   * sovrapposti a schermo intero, tutti nascosti, tutti pronti a sbagliare.
   */
  setPhotos(photos: PhotoDto[]): void {
    this.photos = photos;
  }

  /**
   * Dice al visore cosa può fare, dopo che è stato costruito.
   *
   * Serve perché chi cancella ha bisogno di sapere quale tappa è aperta, e quella
   * informazione vive in un pezzo che nasce dopo il visore. La barra viene ricostruita,
   * perché il pulsante "Elimina" esiste solo se c'è qualcuno che sa cancellare.
   */
  setActions(actions: ViewerActions): void {
    this.actions = actions;
    this.root.querySelector('.viewer__bar')?.replaceWith(this.buildTopBar());
  }

  /**
   * Riempie le tre caselle attorno alla foto corrente e rimette la fila al centro.
   *
   * Il riposizionamento avviene senza transizione, ed è quello che rende invisibile la
   * ricomposizione: l'occhio ha appena visto la foto nuova arrivare al centro, e la fila
   * torna al suo posto sotto di lei mentre le vicine vengono sostituite.
   */
  private async show(): Promise<void> {
    const photo = this.photos[this.index];
    if (!photo) return;

    this.caption.textContent = this.describe(photo);
    this.centra(false);

    await Promise.all(
      [-1, 0, 1].map(async (offset, casella) => {
        const slot = this.slots[casella];
        const vicina = this.photos[this.index + offset];
        if (!slot) return;

        const sfondo = this.blurs[casella];

        if (!vicina) {
          // Ai capi dell'elenco una casella resta vuota: tirando oltre si vede il nero,
          // che è il modo in cui un elenco dice "sei arrivato in fondo".
          slot.removeAttribute('src');
          if (sfondo) sfondo.style.backgroundImage = '';
          return;
        }

        try {
          const url = await this.store.url(vicina.key);
          slot.src = url;
          if (sfondo) sfondo.style.backgroundImage = `url("${url}")`;
        } catch {
          slot.removeAttribute('src');
          if (sfondo) sfondo.style.backgroundImage = '';
          if (offset === 0) this.caption.textContent = 'Questa foto non si apre.';
        }
      }),
    );
  }

  /** Chiude subito un assestamento rimasto a metà. Senza effetto se non ce n'è. */
  private finalizza(): void {
    const lavoro = this.inSospeso;
    this.inSospeso = null;
    lavoro?.();
  }

  /** Mette la casella centrale davanti agli occhi. Con o senza animazione. */
  private centra(animato: boolean, durata = 320): void {
    this.track.style.transition = animato ? `transform ${durata}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none';
    this.track.style.transform = 'translateX(-33.3333%)';
  }

  /*
   * Il precaricamento delle vicine non è più un metodo a parte: riempire le tre caselle
   * È il precaricamento. Prima serviva perché l'immagine era una sola e le vicine
   * andavano scaldate a mano; ora sono già nel documento, con la loro sorgente.
   */

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

    // Simboli e non parole: dentro un disco da trentotto pixel "Chiudi" ed "Elimina"
    // uscivano dal bordo. L'etichetta resta, ma per chi legge lo schermo a voce.
    const close = button('✕', 'viewer__close', () => this.close());
    close.setAttribute('aria-label', 'Chiudi');
    bar.append(close);

    if (this.actions.onDelete) {
      const elimina = button('🗑', 'viewer__action viewer__action--danger', async () => {
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
              target.textContent = '🗑';
            }, 4000);
            return;
          }
          await this.actions.onDelete?.(photo);
          this.close();
      });
      elimina.setAttribute('aria-label', 'Elimina');
      bar.append(elimina);
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

  /**
   * Scorrimento col dito, e la foto lo segue.
   *
   * Prima erano due soli eventi, `touchstart` e `touchend`: fra l'inizio e la fine del
   * gesto non succedeva niente e la foto nuova compariva di colpo a dito già alzato. Il
   * movimento c'era, ma solo nella testa di chi lo faceva.
   *
   * Ora la fila si muove insieme al dito, con due resistenze diverse: piena in mezzo
   * all'elenco, ridotta a un terzo ai capi — tirare oltre l'ultima foto deve *sembrare*
   * un elastico, non un guasto.
   */
  private attachSwipe(): void {
    const LARGHEZZA = () => this.root.clientWidth || 1;

    let partenzaX = 0;
    let partenzaY = 0;
    let deciso: 'lato' | 'altro' | null = null;
    let dx = 0;
    const velocita = new Velocita();

    this.track.addEventListener(
      'touchstart',
      (event) => {
        const tocco = event.touches[0];
        if (!tocco) return;
        // Un gesto nuovo chiude quello di prima: senza, i due si sovrappongono e l'indice
        // resta indietro di un passo.
        this.finalizza();

        partenzaX = tocco.clientX;
        partenzaY = tocco.clientY;
        deciso = null;
        dx = 0;
        velocita.inizia(tocco.clientX, event.timeStamp);
      },
      { passive: true },
    );

    this.track.addEventListener(
      'touchmove',
      (event) => {
        const tocco = event.touches[0];
        if (!tocco) return;

        const scostamentoX = tocco.clientX - partenzaX;
        const scostamentoY = tocco.clientY - partenzaY;

        if (deciso === null) {
          if (Math.abs(scostamentoX) < 8 && Math.abs(scostamentoY) < 8) return;
          deciso = Math.abs(scostamentoX) > Math.abs(scostamentoY) ? 'lato' : 'altro';
        }
        if (deciso !== 'lato') return;

        // Il gesto è nostro: senza questo il browser prova a fare le sue cose e la fila
        // si muove a scatti contendendosi il movimento.
        event.preventDefault();
        velocita.aggiorna(tocco.clientX, event.timeStamp);

        const oltreIlBordo =
          (scostamentoX > 0 && this.index === 0) ||
          (scostamentoX < 0 && this.index === this.photos.length - 1);
        dx = oltreIlBordo ? scostamentoX / 3 : scostamentoX;

        this.track.style.transition = 'none';
        this.track.style.transform = `translateX(calc(-33.3333% + ${dx}px))`;
      },
      { passive: false },
    );

    const fine = () => {
      if (deciso !== 'lato') return;
      deciso = null;

      const larghezza = LARGHEZZA();
      const { verso: passo, durata } = concludi(dx, velocita.valore, larghezza, larghezza - Math.abs(dx));
      const prossimo = this.index + passo;

      if (passo === 0 || prossimo < 0 || prossimo >= this.photos.length) {
        this.centra(true, durata);
        return;
      }

      /*
       * L'indice cambia subito, la fila ci arriva animata.
       *
       * Aggiornarlo qui e non a fine animazione è ciò che rende impossibile lo stato a
       * metà: da questo istante il visore sa già quale foto sta guardando, e la
       * ricomposizione è solo una conseguenza che può arrivare quando arriva.
       */
      this.index = prossimo;

      this.track.style.transition = `transform ${durata}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      this.track.style.transform = `translateX(${passo > 0 ? '-66.6666%' : '0%'})`;

      // Un tempo, non un evento: `transitionend` non arriva se la transizione viene
      // sostituita, ed è esattamente quello che fa un secondo gesto.
      const attesa = setTimeout(() => this.finalizza(), durata);
      this.inSospeso = () => {
        clearTimeout(attesa);
        void this.show();
      };
    };

    this.track.addEventListener('touchend', fine);
    this.track.addEventListener('touchcancel', fine);
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
