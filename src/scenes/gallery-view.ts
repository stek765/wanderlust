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
import { concludi, durata, Velocita } from '../lib/gesto';
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
  /** La fila delle pagine: dentro ce ne sono sempre tre, la precedente, questa, la dopo. */
  private readonly track: HTMLElement;
  private readonly pageHosts: HTMLElement[];
  private readonly galleries: Array<Gallery | null> = [null, null, null];
  /** A che pagina di questa tappa siamo. Zero a ogni apertura. */
  private pagina = 0;
  private readonly uploaderHost: HTMLElement;
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

    // La maniglia dice che il foglio si trascina, prima ancora che qualcuno ci provi.
    const grip = document.createElement('span');
    grip.className = 'shelf__grip';
    grip.setAttribute('aria-hidden', 'true');
    bar.append(grip);

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

    /*
     * Le foto di una tappa non sono un rotolo infinito ma delle pagine.
     *
     * Con cento foto in un'unica colonna, tutto quello che sta in fondo — a cominciare dal
     * pulsante per aggiungerne — diventa irraggiungibile, e non si ha mai idea di quanto
     * manchi. Divise in pagine da una manciata l'una, si scorre giù dentro la pagina e si
     * scorre di lato per la prossima: due gesti che dicono due cose diverse.
     *
     * Tre pagine nel documento e non tutte, per lo stesso motivo del visore: servono le
     * vicine per farle affacciare dai bordi mentre il dito si muove, non tutte.
     */
    this.track = document.createElement('div');
    this.track.className = 'shelf__pages';

    this.pageHosts = [0, 1, 2].map(() => {
      const page = document.createElement('div');
      page.className = 'page';
      // Appena si comincia a scorrere, la didascalia si toglie di mezzo: ha già detto
      // quello che doveva, e da lì in poi è solo roba appoggiata sopra le foto.
      page.addEventListener(
        'scroll',
        () => this.element.classList.toggle('shelf--scorso', page.scrollTop > 24),
        { passive: true },
      );

      const gallery = document.createElement('div');
      gallery.className = 'gallery';
      page.append(gallery);

      this.track.append(page);
      return gallery;
    });

    // Il "+" galleggia in un angolo invece di stare in fondo alle foto: in fondo a cento
    // foto non lo trova nessuno, ed era il difetto che ha fatto nascere le pagine.
    this.uploaderHost = document.createElement('div');
    this.uploaderHost.className = 'shelf__uploader';

    this.element.append(bar, this.track, this.uploaderHost);
    this.attachDragToClose(bar);
    this.attachSheetDrag();
    this.attachPageSwipe();
  }

  /** La pagina che si sta guardando: è quella di mezzo, sempre. */
  private get paginaCorrente(): HTMLElement {
    return this.pageHosts[1]?.parentElement as HTMLElement;
  }

  /**
   * Trascinare giù le foto chiude il foglio, ma solo se si è già in cima.
   *
   * Prima il gesto viveva solo sulla barra, che da quando è una didascalia trasparente è
   * alta un dito: chi provava a chiudere tirando giù le foto non otteneva niente, o
   * peggio otteneva mezzo scorrimento che sembrava un difetto. Ed era un difetto.
   *
   * La regola che tiene insieme le due cose: **finché c'è da scorrere, si scorre; quando
   * non c'è più, si chiude.** È come si comporta ogni pannello che sale da sotto, e non
   * richiede a nessuno di sapere dove va messo il dito.
   *
   * Si usano gli eventi touch e non quelli pointer perché serve `preventDefault()` su un
   * ascoltatore non passivo: è l'unico modo di dire al browser "questo scorrimento me lo
   * prendo io". Con i pointer il browser decide per primo e ci manda un `pointercancel`
   * a cose fatte.
   */
  private attachSheetDrag(): void {
    let partenzaY = 0;
    let inCima = false;
    let trascina = false;
    let spostamento = 0;
    const velocita = new Velocita();

    this.element.addEventListener(
      'touchstart',
      (event) => {
        const tocco = event.touches[0];
        if (!tocco) return;
        partenzaY = tocco.clientY;
        // A scorrere è la pagina, non il foglio: è lì che va chiesto se siamo in cima.
        inCima = this.paginaCorrente.scrollTop <= 0;
        trascina = false;
        spostamento = 0;
        velocita.inizia(tocco.clientY, event.timeStamp);
      },
      { passive: true },
    );

    this.element.addEventListener(
      'touchmove',
      (event) => {
        const tocco = event.touches[0];
        if (!tocco || !inCima) return;

        const dy = tocco.clientY - partenzaY;
        // Verso l'alto non si chiude niente: quello è scorrimento normale.
        if (dy <= 0 && !trascina) return;

        if (!trascina) {
          if (dy < 8) return;
          trascina = true;
        }

        // Da qui il gesto è nostro: senza questo, il browser continuerebbe a provare a
        // scorrere e il foglio seguirebbe il dito a scatti, contendendosi il movimento.
        event.preventDefault();
        velocita.aggiorna(tocco.clientY, event.timeStamp);
        spostamento = dy;
        this.element.style.transition = 'none';
        this.element.style.transform = `translateY(${spostamento}px)`;
      },
      { passive: false },
    );

    const fine = () => {
      if (!trascina) return;
      trascina = false;

      /*
       * Una spinta verso il basso chiude, anche se il foglio si è mosso di poco.
       *
       * Con la sola distanza, un colpetto secco e corto — che è come si chiude un pannello
       * quando si ha fretta — non bastava, e il foglio tornava su. La mano aveva detto
       * "via", e l'interfaccia rispondeva "non abbastanza".
       */
      const altezza = this.element.clientHeight || 1;
      const spinta = velocita.valore > 0.35;
      const chiude = spinta || spostamento > 90;

      this.settle(chiude, durata(chiude ? altezza - spostamento : spostamento, velocita.valore));
      spostamento = 0;
    };

    this.element.addEventListener('touchend', fine);
    this.element.addEventListener('touchcancel', fine);
  }

  /**
   * Conclude un trascinamento: o torna al suo posto, o scende fino a sparire.
   *
   * In tutti e due i casi con una transizione dichiarata. Prima qui si azzeravano
   * `transition` e `transform` insieme, e senza transizione il foglio tornava a posto in
   * un fotogramma solo — cioè saltava.
   */
  private settle(chiude: boolean, tempo = chiude ? 260 : 380): void {
    this.element.style.transition = `transform ${tempo}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    if (!chiude) {
      this.element.style.transform = '';
      return;
    }

    this.element.style.transform = 'translateY(100%)';
    this.element.addEventListener(
      'transitionend',
      () => {
        this.element.style.transition = '';
        this.element.style.transform = '';
        this.close();
      },
      { once: true },
    );
  }

  private attachDragToClose(bar: HTMLElement): void {
    let partenza: number | null = null;
    let spostamento = 0;
    let trascina = false;

    const muovi = (event: PointerEvent) => {
      if (partenza === null) return;
      spostamento = Math.max(0, event.clientY - partenza);

      /*
       * La cattura del puntatore scatta QUI e non al `pointerdown`.
       *
       * Catturando subito, il `pointerup` finisce sulla barra invece che sul pulsante di
       * chiusura che sta dentro, il `click` non viene mai emesso, e quel pulsante smette
       * di funzionare. È la stessa trappola già documentata in `stop-deck.ts`, ed è
       * costata mezz'ora anche la seconda volta.
       */
      if (!trascina) {
        if (spostamento < 6) return;
        trascina = true;
        bar.setPointerCapture(event.pointerId);
      }

      // Il foglio segue il dito solo verso il basso: tirarlo su non lo allunga.
      this.element.style.transition = 'none';
      this.element.style.transform = `translateY(${spostamento}px)`;
    };

    const molla = () => {
      if (partenza === null) return;
      partenza = null;

      /*
       * Il rilascio è animato, in tutti e due i casi.
       *
       * Prima qui si azzeravano `transition` e `transform` insieme: senza una transizione
       * dichiarata il foglio tornava al suo posto in un fotogramma, cioè saltava. E
       * chiudendo spariva di colpo, perché `hidden` arrivava mentre il dito era ancora
       * a metà strada. Due scatti nello stesso gesto.
       *
       * Novanta pixel è la soglia: sotto è un tentennamento, non una richiesta.
       */
      const chiude = trascina && spostamento > 90;
      trascina = false;
      spostamento = 0;
      this.settle(chiude);
    };

    bar.addEventListener('pointerdown', (event) => {
      partenza = event.clientY;
      spostamento = 0;
      trascina = false;
    });
    bar.addEventListener('pointermove', muovi);
    bar.addEventListener('pointerup', molla);
    bar.addEventListener('pointercancel', molla);
  }

  /** Mostra le foto di questa tappa. L'elenco arriva da fuori: qui non si interroga niente. */
  open(stop: StopDto, photos: PhotoDto[]): void {
    this.stop = stop;
    this.photos = photos;
    this.pagina = 0;

    this.title.textContent = stop.name;

    this.buildUploader();

    /*
     * La pagina che si vedrà è pronta PRIMA che il foglio cominci a salire.
     *
     * Il foglio si riusa fra una tappa e l'altra, e prima saliva ancora pieno delle foto
     * di quella precedente: a metà strada arrivava la ricostruzione, si svuotava di colpo
     * e si riempiva di nuovo. Tre stati in mezzo secondo, ed è il lampeggio che si vedeva
     * aprendo una tappa — non un ricaricamento, ma roba vecchia buttata via davanti agli
     * occhi.
     *
     * Costruire solo quella centrale costa un terzo del lavoro: le due vicine servono a
     * chi scorre di lato, e nessuno lo fa mentre il foglio sta ancora salendo.
     */
    this.costruisci(1, 0);
    this.costruisci(0, -1);
    this.costruisci(2, -1);
    this.centraPagine(false);
    this.aggiornaDidascalia();

    /*
     * La tinta arriva dopo, non durante.
     *
     * Ricavarla significa disegnare una foto su un canvas e leggerne i pixel: lavoro sul
     * thread principale, fatto esattamente nell'istante in cui il foglio sta salendo. È
     * decorazione — il colore dell'alone — e non c'è motivo che una decorazione faccia
     * scattare l'unica animazione che si vede a ogni apertura.
     */
    setTimeout(() => void this.applyTint(), 420);

    document.body.classList.add('is-locked');
    // Ogni apertura riparte dall'alto: si entra da un tocco, non da dove si era rimasti.
    this.paginaCorrente.scrollTop = 0;
    this.sali();
  }

  /**
   * La salita del foglio, e il riempimento dopo.
   *
   * L'ordine è tutto. Costruire il mosaico prima significa chiedere al browser di
   * impaginare tre pagine di riquadri nell'istante esatto in cui deve cominciare a
   * muovere il foglio: il primo fotogramma dell'animazione arriva in ritardo e il resto
   * insegue. Il foglio sale vuoto — cioè istantaneo, non c'è niente da calcolare — e le
   * foto entrano quando il movimento è finito, dentro riquadri che nel frattempo
   * respirano.
   *
   * Nessuna `animation` con i fotogrammi chiave: solo `transform` e una transizione,
   * gli stessi che usa il trascinamento. Un meccanismo solo, così non possono contendersi
   * la stessa proprietà — che è esattamente quello che era successo.
   */
  private sali(): void {
    this.element.hidden = false;
    this.element.style.transition = 'none';
    this.element.style.transform = 'translateY(100%)';

    // Costringe il browser a fare i conti adesso: senza, applica partenza e arrivo nello
    // stesso fotogramma e la transizione non parte proprio.
    void this.element.offsetHeight;

    requestAnimationFrame(() => {
      this.element.style.transition = 'transform 440ms cubic-bezier(0.22, 1, 0.36, 1)';
      this.element.style.transform = 'translateY(0)';
    });

    // Le due pagine vicine arrivano a salita conclusa: servono a chi scorre di lato, e
    // nessuno lo fa mentre il foglio si sta ancora muovendo.
    setTimeout(() => {
      this.costruisci(0, this.pagina - 1);
      this.costruisci(2, this.pagina + 1);
    }, 470);
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

  /** Quante foto stanno in una pagina. Poche: una pagina deve finire, o non è una pagina. */
  private static readonly PER_PAGINA = 12;

  private get pagine(): number {
    return Math.max(1, Math.ceil(this.photos.length / GalleryView.PER_PAGINA));
  }

  /**
   * Disegna le tre pagine attorno a quella corrente e rimette la fila al centro.
   *
   * Le caselle ai capi restano vuote quando non c'è un prima o un dopo: tirando oltre si
   * vede il nero, che è il modo in cui un elenco dice "sei arrivato in fondo".
   */
  private redraw(): void {
    this.centraPagine(false);
    [-1, 0, 1].forEach((offset, casella) => this.costruisci(casella, this.pagina + offset));
    this.aggiornaDidascalia();
  }

  /** Riempie una casella con una pagina, buttando via quello che c'era. */
  private costruisci(casella: number, numero: number): void {
    const host = this.pageHosts[casella];
    if (!host) return;

    this.galleries[casella]?.destroy();
    this.galleries[casella] = null;
    host.replaceChildren();

    if (numero < 0 || numero >= this.pagine) return;

    const inizio = numero * GalleryView.PER_PAGINA;
    const foto = this.photos.slice(inizio, inizio + GalleryView.PER_PAGINA);

    if (foto.length === 0) {
      if (numero === this.pagina) host.append(emptyState(Boolean(this.options.writeToken)));
      return;
    }

    this.galleries[casella] = new Gallery({
      container: host,
      photos: foto,
      store: this.options.store,
      // L'indice va riportato all'elenco intero della tappa: il visore sfoglia tutte le
      // foto del posto, non solo quelle della pagina che si stava guardando.
      onOpen: (index) => this.options.onOpenPhoto(this.photos, inizio + index),
    });
  }

  /**
   * Cambia pagina riciclando quelle che ci sono già, invece di rifarle tutte.
   *
   * Ricostruendole, ogni scorrimento buttava via anche la pagina che si stava guardando e
   * quella da cui si veniva, e le rifaceva da zero: immagini nuove, che partono trasparenti
   * e sfumano dentro. Le foto erano già decifrate e in memoria — quindi non si ricaricava
   * niente davvero — ma sullo schermo lampeggiavano come se lo si stesse facendo. Non era
   * un problema di cache: era il documento rifatto sotto agli occhi.
   *
   * Qui le pagine scorrono di una casella e solo quella che entra da fuori viene
   * costruita. Le immagini delle altre due sono **gli stessi nodi di prima**, spostati: non
   * hanno niente da ricaricare e niente da sfumare.
   */
  private ruota(passo: 1 | -1): void {
    const [a, b, c] = this.pageHosts;
    if (!a || !b || !c) return;

    if (passo === 1) {
      this.galleries[0]?.destroy();
      a.replaceChildren(...b.childNodes);
      b.replaceChildren(...c.childNodes);
      this.galleries[0] = this.galleries[1] ?? null;
      this.galleries[1] = this.galleries[2] ?? null;
      this.galleries[2] = null;
      this.costruisci(2, this.pagina + 1);
    } else {
      this.galleries[2]?.destroy();
      c.replaceChildren(...b.childNodes);
      b.replaceChildren(...a.childNodes);
      this.galleries[2] = this.galleries[1] ?? null;
      this.galleries[1] = this.galleries[0] ?? null;
      this.galleries[0] = null;
      this.costruisci(0, this.pagina - 1);
    }

    this.centraPagine(false);
    this.aggiornaDidascalia();
  }

  /** Nome della tappa e date di quello che si ha davanti, non dell'intera tappa. */
  private aggiornaDidascalia(): void {
    const inizio = this.pagina * GalleryView.PER_PAGINA;
    const foto = this.photos.slice(inizio, inizio + GalleryView.PER_PAGINA);

    this.meta.textContent =
      this.pagine > 1
        ? `${describeSpan(foto)} · ${this.pagina + 1}/${this.pagine}`
        : describeSpan(this.photos);
  }

  private centraPagine(animato: boolean, durata = 320): void {
    this.track.style.transition = animato ? `transform ${durata}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none';
    this.track.style.transform = 'translateX(-33.3333%)';
  }

  /**
   * Lo scorrimento laterale cambia pagina, quello verticale scorre dentro la pagina.
   *
   * La direzione si decide alla prima che diventa riconoscibile e poi non si discute più:
   * un gesto che a metà strada cambia idea su cosa sta facendo è il modo più veloce di far
   * sembrare rotta un'interfaccia.
   */
  private attachPageSwipe(): void {
    const LARGHEZZA = () => this.element.clientWidth || 1;

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

        const sx = tocco.clientX - partenzaX;
        const sy = tocco.clientY - partenzaY;

        if (deciso === null) {
          if (Math.abs(sx) < 10 && Math.abs(sy) < 10) return;
          deciso = Math.abs(sx) > Math.abs(sy) * 1.2 ? 'lato' : 'altro';
        }
        if (deciso !== 'lato') return;

        event.preventDefault();
        velocita.aggiorna(tocco.clientX, event.timeStamp);

        const oltre = (sx > 0 && this.pagina === 0) || (sx < 0 && this.pagina >= this.pagine - 1);
        dx = oltre ? sx / 3 : sx;

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
      const prossima = this.pagina + passo;

      if (passo === 0 || prossima < 0 || prossima >= this.pagine) {
        this.centraPagine(true, durata);
        return;
      }

      this.track.style.transition = `transform ${durata}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      this.track.style.transform = `translateX(${passo > 0 ? '-66.6666%' : '0%'})`;

      this.track.addEventListener(
        'transitionend',
        () => {
          this.pagina = prossima;
          this.ruota(passo);
          // Una pagina nuova si guarda dall'alto: continuare da dove si era rimasti nella
          // precedente non vuol dire niente.
          this.paginaCorrente.scrollTop = 0;
        },
        { once: true },
      );
    };

    this.track.addEventListener('touchend', fine);
    this.track.addEventListener('touchcancel', fine);
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
      onPhotoAdded: (photo, versioni) => {
        // Le abbiamo già in chiaro tutte e due: darle al magazzino evita di riscaricare da
        // R2 e ridecifrare qualcosa che è appena partito da questo telefono. La grande
        // serve al mosaico, la piccola alla scheda della tappa.
        this.options.store.adopt(photo.thumbKey, versioni.thumb);
        this.options.store.adopt(photo.key, versioni.full);

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
    // Caricando foto la tappa può guadagnare pagine: se si era sull'ultima, si resta
    // sull'ultima invece di ritrovarsi su una pagina che non esiste più.
    this.pagina = Math.min(this.pagina, this.pagine - 1);
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
