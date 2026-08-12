/**
 * Le tappe del viaggio, in fila in fondo alla mappa: copertina e nome, con la data a
 * sinistra della fila.
 *
 * È la navigazione del viaggio, e l'unica. Si scorrono di lato e la mappa raggiunge la
 * tappa su cui ci si centra; toccandone una si aprono le sue foto.
 *
 * La fila resta dove la lasci. Per un po' si riallineava da sola sulla tappa più vicina
 * appena il dito si staccava, ed era una piccola prepotenza: la scheda scivolava via da
 * sotto il pollice senza che nessuno l'avesse chiesto. Lo `scroll-snap` del browser fa la
 * stessa cosa, ed è il motivo per cui non c'è.
 *
 * Scorrere è il gesto principale, toccare è la conferma: per questo un tocco apre sempre,
 * senza dover prima scegliere. Il vecchio "primo tocco sceglie, secondo apre" costringeva
 * a due gesti per una cosa sola, e con la fila che scorreva sotto le dita il secondo
 * finiva regolarmente su una scheda diversa.
 *
 * Perché di lato e non in verticale: un viaggio ha poche tappe e tante foto. Sull'asse
 * verticale, insieme alle foto, arrivare alla terza tappa richiederebbe di scorrere per
 * minuti; su un asse suo si passa da una all'altra con un gesto.
 */

import type { StopDto } from '../../shared/api-types';
import type { PhotoStore } from '../lib/photo-store';
import { shortDate } from './gallery-view';

export interface StopDeckOptions {
  stops: StopDto[];
  store: PhotoStore;
  /**
   * La tappa su cui ci si è centrati. Chiamata appena si supera il punto di mezzo fra
   * due schede, anche mentre il dito è ancora giù: la mappa deve accorgersene subito.
   */
  onFocus: (slug: string) => void;
  /** Una scheda è stata toccata: si aprono le sue foto. */
  onOpen: (slug: string) => void;
}

export class StopDeck {
  readonly element: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly cards = new Map<string, HTMLElement>();
  private readonly dayLine: HTMLElement;
  private readonly yearLine: HTMLElement;
  private readonly byslug = new Map<string, StopDto>();
  private readonly order: string[] = [];
  private current: string | null = null;
  private scheduled = false;
  private dragged = false;
  private lancio: number | null = null;

  constructor(private readonly options: StopDeckOptions) {
    this.element = document.createElement('nav');
    this.element.className = 'deck';
    this.element.setAttribute('aria-label', 'Tappe del viaggio');

    /*
     * La colonna della data, a sinistra della fila.
     *
     * Un calendario disegnato, non un carattere: il rombo di prima era un glifo del font,
     * quindi cambiava forma e peso da un dispositivo all'altro, e non c'entrava niente col
     * tempo. Un'icona vettoriale sta ferma e dice cosa significa la riga che ha sotto.
     */
    const when = document.createElement('div');
    when.className = 'deck__when';

    const mark = document.createElement('span');
    mark.className = 'deck__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/>' +
      '<path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

    this.dayLine = document.createElement('span');
    this.dayLine.className = 'deck__day';

    this.yearLine = document.createElement('span');
    this.yearLine.className = 'deck__year';

    when.append(mark, this.dayLine, this.yearLine);

    this.rail = document.createElement('div');
    this.rail.className = 'deck__rail';

    for (const stop of options.stops) {
      this.byslug.set(stop.slug, stop);
      this.order.push(stop.slug);
      const card = this.buildCard(stop);
      this.cards.set(stop.slug, card);
      this.rail.append(card);
    }

    this.element.append(when, this.rail);
    this.rail.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.attachDrag();
  }

  /**
   * Trascinamento col puntatore.
   *
   * Su un telefono la fila si scorre da sola, perché un dito su un contenitore che
   * straborda è già uno scorrimento. Col mouse no: trascinare non scorre niente, e su un
   * portatile il carosello sembrava rotto. Qui il trascinamento diventa scorrimento.
   */
  private attachDrag(): void {
    let startX = 0;
    let startScroll = 0;
    let pointer: number | null = null;
    let ultimoX = 0;
    let ultimoTempo = 0;
    let velocita = 0;

    this.rail.addEventListener('pointerdown', (event) => {
      // Solo mouse e penna: il dito lo gestisce già il browser, e intercettarlo
      // toglierebbe l'inerzia, che è metà della sensazione.
      if (event.pointerType === 'touch') return;
      // Un tocco durante il lancio lo ferma: chi rimette il dito vuole comandare lui.
      if (this.lancio) cancelAnimationFrame(this.lancio);

      pointer = event.pointerId;
      startX = event.clientX;
      startScroll = this.rail.scrollLeft;
      ultimoX = event.clientX;
      ultimoTempo = event.timeStamp;
      velocita = 0;
      this.dragged = false;
    });

    this.rail.addEventListener('pointermove', (event) => {
      if (pointer !== event.pointerId) return;

      const spostamento = event.clientX - startX;
      // Sotto i sei pixel è un tocco storto, non un trascinamento.
      if (!this.dragged && Math.abs(spostamento) <= 6) return;

      /*
       * La cattura del puntatore scatta QUI e non al `pointerdown`, ed è una differenza
       * che si paga cara: catturando subito, il `click` successivo viene ridiretto sulla
       * fila invece che sulla scheda, e nessuna galleria si apre più. Catturare solo
       * quando il gesto è già diventato un trascinamento lascia intatti i tocchi.
       */
      if (!this.dragged) {
        this.dragged = true;
        this.rail.setPointerCapture(event.pointerId);
      }

      // Velocità istantanea, in pixel al millisecondo: serve al lancio quando si molla.
      const dt = event.timeStamp - ultimoTempo;
      if (dt > 0) {
        const istante = (ultimoX - event.clientX) / dt;
        // Media pesata: una sola lettura è rumorosa e fa partire lanci a caso.
        velocita = velocita * 0.7 + istante * 0.3;
        ultimoX = event.clientX;
        ultimoTempo = event.timeStamp;
      }

      this.rail.scrollLeft = startScroll - spostamento;
    });

    const fine = (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      pointer = null;
      if (this.rail.hasPointerCapture(event.pointerId)) {
        this.rail.releasePointerCapture(event.pointerId);
      }
      if (this.dragged) this.lancia(velocita);
      // Il flag sopravvive al `click` che arriva subito dopo, e muore al gesto seguente.
      setTimeout(() => (this.dragged = false), 0);
    };

    this.rail.addEventListener('pointerup', fine);
    this.rail.addEventListener('pointercancel', fine);
  }

  /** Porta la tappa in vista e la rende corrente. `instant` per la partenza. */
  select(slug: string, behavior: ScrollBehavior = 'smooth'): void {
    const card = this.cards.get(slug);
    if (!card) return;


    this.glideTo(card, behavior);
    this.markCurrent(slug);
    // Con `instant` non arriva nessun evento di scorrimento: la mappa va avvisata a mano,
    // o alla partenza resterebbe dov'era.
    if (behavior === 'instant') requestAnimationFrame(() => this.report());
  }

  /**
   * Il lancio dopo un trascinamento col puntatore.
   *
   * Col dito ci pensa il browser: un tocco su un contenitore che straborda ha già la sua
   * inerzia, ed è metà della sensazione. Col mouse non esiste niente del genere — la fila
   * si inchioda dove molli, e su un portatile il carosello sembra di legno. Qui la spinta
   * si smorza da sola fino a fermarsi, e la mappa la segue come ogni altro scorrimento.
   */
  private lancia(velocita: number): void {
    // Sotto questa spinta è un rilascio fermo, non un lancio: proseguire darebbe una
    // derivazione lenta che sembra un difetto.
    if (Math.abs(velocita) < 0.25) return;

    let v = Math.max(-4, Math.min(4, velocita));
    const passo = () => {
      v *= 0.93;
      if (Math.abs(v) < 0.02) return;

      const prima = this.rail.scrollLeft;
      this.rail.scrollLeft = prima + v * 16;
      // Arrivati a un capo non ha senso continuare a spingere contro il bordo.
      if (this.rail.scrollLeft === prima) return;

      this.lancio = requestAnimationFrame(passo);
    };

    if (this.lancio) cancelAnimationFrame(this.lancio);
    this.lancio = requestAnimationFrame(passo);
  }

  /** Porta la fila su una scheda. La mappa la segue da sé, come per ogni altro scorrimento. */
  private glideTo(card: HTMLElement, behavior: ScrollBehavior): void {
    this.rail.scrollTo({ left: this.railOffset(card), behavior });
  }

  /** Riallinea data e conteggio dopo un caricamento o una cancellazione. */
  refresh(stop: StopDto): void {
    this.byslug.set(stop.slug, stop);

    const card = this.cards.get(stop.slug);
    const meta = card?.querySelector('.deck__meta');
    if (meta) meta.textContent = `${stop.photos.length} foto`;

    void this.paintCover(card?.querySelector('.deck__cover') ?? null, stop);
    if (this.current === stop.slug) this.showDate(stop);
  }

  private buildCard(stop: StopDto): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'deck__card';
    card.dataset.slug = stop.slug;

    const cover = document.createElement('span');
    cover.className = 'deck__cover';

    const label = document.createElement('span');
    label.className = 'deck__label';

    const name = document.createElement('span');
    name.className = 'deck__name';
    name.textContent = stop.name;

    const meta = document.createElement('span');
    meta.className = 'deck__meta';
    meta.textContent = `${stop.photos.length} foto`;

    label.append(name, meta);
    card.append(cover, label);

    card.addEventListener('click', () => {
      // Un trascinamento che finisce sopra una scheda non è un tocco: senza questo, ogni
      // strisciata aprirebbe la galleria della scheda sotto il dito.
      if (this.dragged) return;
      this.options.onOpen(stop.slug);
    });

    void this.paintCover(cover, stop);
    return card;
  }

  private async paintCover(cover: Element | null, stop: StopDto): Promise<void> {
    const prima = stop.photos[0];
    if (!cover || !(cover instanceof HTMLElement) || !prima) return;

    try {
      const url = await this.options.store.url(prima.thumbKey);
      cover.style.backgroundImage = `url("${url}")`;
      cover.classList.add('deck__cover--loaded');
    } catch {
      // Copertina assente: resta il fondo della scheda, che ha già il suo colore.
    }
  }

  /**
   * A ogni fotogramma utile dice dove siamo, in continuo, e la mappa ci si mette.
   *
   * Le posizioni si rileggono invece di essere memorizzate: le schede cambiano larghezza
   * quando cambia lo schermo, e una misura vecchia manderebbe la mappa altrove.
   */
  private onScroll(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    requestAnimationFrame(() => {
      this.scheduled = false;
      this.report();
    });
  }

  /**
   * Su quale tappa siamo centrati, letto dalla posizione della fila.
   *
   * Arrotondato, quindi cambia esattamente al punto di mezzo fra due schede: è il momento
   * in cui l'occhio dice "adesso sto guardando quella", e la mappa parte da lì.
   */
  private report(): void {
    const vicina = this.order[Math.round(this.progress())];
    if (vicina) this.markCurrent(vicina);
  }

  /**
   * La posizione continua nella fila: 0 sulla prima tappa, 1.5 a metà fra la seconda e la
   * terza. Il passo è la distanza fra due schede, misurata e non assunta — dipende dal CSS.
   */
  private progress(): number {
    const prima = this.cards.get(this.order[0] ?? '');
    const seconda = this.cards.get(this.order[1] ?? '');
    if (!prima) return 0;

    const passo = seconda ? this.railOffset(seconda) - this.railOffset(prima) : 1;
    if (passo <= 0) return 0;

    const grezza = (this.rail.scrollLeft - this.railOffset(prima)) / passo;
    return Math.max(0, Math.min(this.order.length - 1, grezza));
  }

  private markCurrent(slug: string): void {
    if (this.current === slug) return;

    if (this.current) this.cards.get(this.current)?.classList.remove('deck__card--current');
    this.cards.get(slug)?.classList.add('deck__card--current');
    this.current = slug;

    const stop = this.byslug.get(slug);
    if (stop) this.showDate(stop);

    this.options.onFocus(slug);
  }

  /**
   * Dove sta una scheda dentro lo scorrimento della fila.
   *
   * `offsetLeft` da solo non basta e ha sbagliato davvero: è misurato dal primo antenato
   * posizionato, che qui è lo strato della scena, quindi includeva anche la colonna della
   * data a sinistra. Ogni posizionamento arrivava lungo di quella larghezza, e la tappa
   * scelta restava tagliata a metà fuori dal bordo.
   */
  private railOffset(card: HTMLElement): number {
    return card.getBoundingClientRect().left - this.rail.getBoundingClientRect().left + this.rail.scrollLeft;
  }

  private showDate(stop: StopDto): void {
    const quando = shortDate(stop.photos);
    this.dayLine.textContent = quando?.giorno ?? '—';
    this.yearLine.textContent = quando?.anno ?? '';
  }
}
