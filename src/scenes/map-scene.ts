/**
 * La mappa del viaggio: le tappe, la rotta che le collega, e il salto da una all'altra.
 *
 * Nessuna animazione d'ingresso: si arriva e la mappa è già sulla prima tappa. Il volo di
 * discesa dal globo che c'era prima serviva a coprire il tempo di decifratura delle foto,
 * ma le foto non stanno più sulla prima schermata — servono solo le miniature delle
 * copertine, poche e piccole. Coprire un'attesa che non c'è è solo un'attesa in più.
 *
 * **La camera ha un movimento suo.** Il carosello dice solo su quale tappa si è centrati,
 * appena ci si centra; la mappa ci va con la propria animazione, che non ha niente a che
 * fare con la velocità del dito.
 *
 * Un tentativo in cui seguiva lo scorrimento fotogramma per fotogramma è stato buttato
 * dopo una prova su telefono: la mappa strattonava a ogni micro-movimento del pollice, e
 * ogni imprecisione della mano finiva dritta sullo schermo. Il movimento va tolto di mano
 * all'utente, non consegnato.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { distanceKm, routeGeoJson } from '../lib/geo';

/**
 * MapLibre non viene importato in cima, e non è un dettaglio di stile.
 *
 * Pesa 284 KB compressi, più di tutto il resto del sito messo insieme. Come import
 * statico il browser lo scarica e lo interpreta PRIMA che esista il primo nodo del DOM,
 * quindi il carosello delle tappe — che è il contenuto — aspettava la messa in scena.
 * Misurato su 4G scarso: 1,2 secondi di sola attesa prima di poter disegnare qualcosa.
 *
 * Il tipo resta un `import type`, che sparisce in compilazione e non tira dentro niente.
 */
async function caricaMapLibre() {
  const { default: maplibregl } = await import('maplibre-gl');
  return maplibregl;
}

/*
 * Il tipo si ricava dalla funzione qui sopra invece di scriverlo a mano.
 *
 * MapLibre è un pacchetto UMD e nelle sue dichiarazioni un export default non esiste: al
 * runtime c'è, e TypeScript lo concede solo dentro un'espressione di import. Scritto come
 * `(typeof import('maplibre-gl'))['default']` non compila.
 */
type MapLibre = Awaited<ReturnType<typeof caricaMapLibre>>;

/**
 * Oltre questa distanza lo spostamento diventa un volo: la camera si allarga a metà
 * strada e si richiude arrivando, che è il modo in cui una mappa racconta una distanza.
 * Sotto, un semplice scorrimento — allargarsi per pochi chilometri dà solo il mal di mare.
 */
const VOLO_OLTRE_KM = 60;

/**
 * Quanto dura lo spostamento della camera.
 *
 * Erano 520 e 900, e la mappa scattava da una tappa all'altra: mentre il dito scorre
 * ancora, lei era già arrivata. Il carosello si muove con la mano, la mappa deve
 * accompagnarlo — non precederlo. Quasi il doppio, e il movimento diventa una cosa da
 * guardare invece di uno spostamento da subire.
 */
const DURATA_VICINO_MS = 900;
const DURATA_LONTANO_MS = 1600;

/**
 * Lo stile della mappa. Tutti gratuiti e senza chiave API.
 *
 * "Dark Matter" di CARTO: terre quasi nere, acqua grigio scuro, niente strade, solo le
 * etichette delle città. È lo stesso registro del video di riferimento, ed è l'unico che
 * non combatte con le foto — una mappa colorata sotto una fascia a tutta larghezza fa
 * a botte con loro.
 *
 * Alternative già pronte, basta sostituire la costante:
 *   https://basemaps.cartocdn.com/gl/positron-gl-style/style.json      chiaro e minimale
 *   https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json       colorato ma sobrio
 *   https://tiles.openfreemap.org/styles/liberty                       OSM classico
 */
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Lo zoom su una tappa. Non livello strada: là si atterra dentro una minestra di nomi di
 * frazioni, con le altre tappe fuori inquadratura e la rotta che esce dal bordo come una
 * riga a caso. Qui si vede il posto insieme al pezzo di costa o di valle che lo rende
 * riconoscibile.
 */
const STOP_ZOOM = 10.4;

/**
 * Quanto spazio in fondo è occupato dal carosello, in frazione di schermo.
 *
 * Senza, la mappa centra la tappa a metà schermo e il pin finisce dietro le schede.
 * Questo valore la fa centrare nella parte visibile.
 */
const DECK_SHARE = 0.34;

/** Oltre questo, si rinuncia alle mappe e si mostrano comunque le foto. */
const STYLE_TIMEOUT_MS = 5000;

const ROUTE_SOURCE = 'rotta';
const ROUTE_GLOW_LAYER = 'rotta-alone';
const ROUTE_LAYER = 'rotta-tratteggiata';
const NAMES_SOURCE = 'tappe';
const NAMES_LAYER = 'tappe-nomi';

/**
 * Le etichette dello stile che vengono spente.
 *
 * Sono i nomi dei piccoli centri: paesi, frazioni, quartieri, città. Allo zoom a cui si
 * guarda una tappa, la mappa ne stampa una decina attorno al punto, e il pin ne copriva
 * sempre uno — quello del posto dove sei, cioè l'unico che conta.
 *
 * Spegnendoli, l'unico nome fine sulla mappa diventa quello delle tappe del viaggio, che
 * scriviamo noi e possiamo staccare dal pin. Restano accesi stati, nazioni e continenti,
 * che servono a orientarsi quando la camera si allarga fra due tappe lontane.
 */
const ETICHETTE_DA_SPEGNERE = [
  'place_hamlet',
  'place_suburbs',
  'place_villages',
  'place_town',
  'place_city_r6',
  'place_city_r5',
  'place_city_dot_r7',
  'place_city_dot_r4',
  'place_city_dot_r2',
  'place_city_dot_z7',
  'place_capital_dot_z7',
];

/** Il font va chiesto fra quelli di cui CARTO serve i glifi, o le etichette restano vuote. */
const FONT = ['Open Sans Bold', 'Noto Sans Regular'];

/**
 * Il ritocco di colore su Dark Matter.
 *
 * Il riferimento è il video: terra chiara, mare nero, contrasto alto. Non è una scelta
 * estetica fra tante — è l'unica scala in cui un profilo di costa si legge con un colpo
 * d'occhio, e su questa pagina la mappa deve dire "dove" in mezzo secondo.
 *
 * Ci sono voluti tre tentativi. Mare blu e boschi verdi: sembrava un videogioco e rubava
 * il colore alle foto. Tutto nero: nessuna costa, nessuna isola. Terra grigio scuro su
 * mare più scuro: meglio, ma ancora due grigi che si somigliano. Qui la distanza è
 * massima, e non c'è più nessuna tinta — nemmeno il verde dei boschi, che a qualsiasi
 * opacità lasciava macchie olivastre in punti a caso.
 *
 * Le uniche cose colorate sulla mappa restano la rotta e i pin. Tutto il resto è una
 * scala di grigi, e le foto restano l'unica cosa viva della pagina.
 */
const TERRA = '#c9ced3';
const ACQUA = '#06090c';
const ACQUA_FONDA = '#04070a';
const FIUME = '#7d868f';
const VERDE = '#c0c6cb';
const CITTA = '#bfc5cb';
const EDIFICI = '#adb4bb';
const STRADE = '#9aa2aa';
/**
 * Il colore della rotta: bianco, che non è un colore.
 *
 * Prima era un azzurro medio ed era l'unica cosa colorata sulla mappa insieme al pin — su
 * una pagina la cui regola è "comandano le foto", una riga colorata che attraversa lo
 * schermo ruba esattamente l'attenzione che dovrebbero avere loro. Poi è stata grigio
 * d'ardesia, e si leggeva, ma spariva dentro le strade della mappa, che sono grigie anche
 * loro. Il bianco su un'ombra scura è l'unica combinazione che resta riconoscibile sia
 * sulla terra chiara sia sul mare quasi nero.
 */
const ROTTA = '#ffffff';
const TESTO = 'rgba(30, 36, 43, 0.88)';
const ALONE_TESTO = 'rgba(201, 206, 211, 0.9)';

export interface MapStop {

  slug: string;
  name: string;
  lat: number;
  lon: number;
}

export interface MapSceneOptions {
  container: HTMLElement;
  /** Tutte le tappe del viaggio, in ordine cronologico: è l'ordine in cui si disegna la rotta. */
  stops: MapStop[];
  /** Lo slug della tappa toccata: quella su cui atterra il volo d'arrivo. */
  focus: string;
}

export class MapScene {
  private readonly map: MapLibreMap;
  private readonly markers = new Map<string, HTMLElement>();
  private active: string | null = null;

  /**
   * Costruisce la scena, o restituisce null se questo browser non ce la fa.
   *
   * Senza WebGL — dispositivo vecchio, accelerazione disattivata, WebView strana —
   * MapLibre non parte. Quando succede la pagina deve mostrare le foto lo stesso: la
   * mappa è la messa in scena, le foto sono il contenuto, e il contenuto non può
   * dipendere dalla messa in scena.
   *
   * Asincrona perché la libreria si scarica qui, non all'apertura della pagina. Il null
   * copre anche il caso nuovo: il file non arriva affatto, perché la rete è caduta fra
   * l'apertura della pagina e questo momento.
   */
  static async create(options: MapSceneOptions): Promise<MapScene | null> {
    try {
      return new MapScene(options, await caricaMapLibre());
    } catch {
      return null;
    }
  }

  private constructor(
    private readonly options: MapSceneOptions,
    private readonly gl: MapLibre,
  ) {
    const start = this.stop(options.focus) ?? options.stops[0];
    if (!start) throw new Error('un viaggio senza tappe non ha niente da mostrare');

    this.map = new gl.Map({
      container: options.container,
      style: STYLE_URL,
      // Già sulla prima tappa: non c'è nessun ingresso da mettere in scena.
      center: [start.lon, start.lat],
      zoom: STOP_ZOOM,
      bearing: 0,
      pitch: 0,
      // Spostata in alto a destra: in basso finirebbe sopra l'invito a scorrere.
      // Toglierla non è un'opzione, la licenza di CARTO e OSM la richiede.
      attributionControl: false,
      // La scena si guarda, non si esplora: ogni gesto qui ruberebbe attenzione alle foto.
      interactive: false,
    });

    // In basso a destra e non in alto: là sopra era la cosa più luminosa dello schermo,
    // una pillola chiara più vistosa del nome del posto. Resta obbligatoria per licenza,
    // ma il suo posto è l'angolo.
    this.map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-right');
  }

  /**
   * Risolve quando lo stile è caricato, la rotta è disegnata e si può iniziare a volare.
   *
   * Non aspetta all'infinito: se le mappe non arrivano — rete lenta, CARTO giù, WebGL
   * assente — dopo qualche secondo si prosegue comunque. Meglio le foto senza volo che
   * una pagina bianca.
   */
  async ready(): Promise<void> {
    if (!this.map.loaded()) {
      await Promise.race([
        new Promise<void>((resolve) => this.map.once('load', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, STYLE_TIMEOUT_MS)),
      ]);
    }

    try {
      // Il globo invece della mappa piatta: alla partenza si deve vedere che è la Terra.
      // Va impostato a stile caricato, non nelle opzioni del costruttore.
      this.map.setProjection({ type: 'globe' });
    } catch {
      // Proiezione non supportata: resta la mappa piatta, che va benissimo.
    }

    this.paintWorld();
    this.drawRoute();
    this.drawNames();
    this.dropPins();

    // Anche la posizione di partenza tiene conto del carosello: senza, la prima tappa
    // nasce esattamente dietro le schede.
    this.map.jumpTo({ padding: this.deckPadding() });
  }

  /**
   * Dà un colore all'acqua e alla terra, e un'atmosfera al globo.
   *
   * Ogni ritocco è isolato: uno stile che un giorno non avesse più un certo livello non
   * deve portarsi dietro tutti gli altri.
   */
  private paintWorld(): void {
    for (const layer of this.map.getStyle()?.layers ?? []) {
      const id = layer.id;
      const gruppo = (layer as { 'source-layer'?: string })['source-layer'];

      // Ogni ritocco è isolato: uno stile che un giorno non avesse più un certo livello,
      // o lo avesse di un altro tipo, non deve portarsi dietro tutti gli altri.
      const dipingi = (property: string, value: unknown) => {
        try {
          this.map.setPaintProperty(id, property, value);
        } catch {
          // Proprietà non applicabile a questo livello.
        }
      };

      if (id === 'background') dipingi('background-color', TERRA);
      else if (id === 'water_shadow') dipingi('fill-color', ACQUA_FONDA);
      else if (gruppo === 'water') dipingi('fill-color', ACQUA);
      else if (gruppo === 'waterway') dipingi('line-color', FIUME);
      else if (gruppo === 'park' || gruppo === 'landcover') {
        // Stesso grigio della terra, appena più scuro: i boschi si intuiscono come
        // rilievo, non come colore. Con una tinta verde, a qualunque opacità, restavano
        // macchie olivastre sparse in punti che non vogliono dire niente.
        dipingi('fill-color', VERDE);
        dipingi('fill-opacity', 0.7);
      } else if (gruppo === 'landuse') dipingi('fill-color', CITTA);
      else if (gruppo === 'building') {
        dipingi('fill-color', EDIFICI);
        dipingi('fill-opacity', 0.6);
      } else if (gruppo === 'transportation') {
        // Su terra chiara le strade vanno scurite, non spente: schiarite sparirebbero.
        dipingi('line-color', STRADE);
        dipingi('line-opacity', 0.45);
      } else if (gruppo === 'boundary') {
        dipingi('line-color', STRADE);
        dipingi('line-opacity', 0.35);
      } else if (ETICHETTE_DA_SPEGNERE.includes(id)) {
        try {
          this.map.setLayoutProperty(id, 'visibility', 'none');
        } catch {
          // Livello assente in questa versione dello stile: niente da spegnere.
        }
      } else if (layer.type === 'symbol') {
        // Testo scuro con alone chiaro: è il verso giusto su una mappa chiara, e senza
        // l'alone i nomi sul mare nero sparirebbero.
        dipingi('text-color', TESTO);
        dipingi('text-halo-color', ALONE_TESTO);
        dipingi('text-halo-width', 1.3);
      }
    }

    try {
      // Il velo di atmosfera sul bordo del globo. Durante la discesa è la cosa che
      // trasforma un cerchio scuro in un pianeta.
      this.map.setSky({
        'sky-color': '#05080b',
        'horizon-color': '#7f8b95',
        'fog-color': '#05080b',
        'horizon-fog-blend': 0.55,
        'fog-ground-blend': 0.8,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 6, 0.4, 11, 0.12],
      });
    } catch {
      // Cielo non supportato: resta lo sfondo piatto.
    }
  }

  /**
   * I nomi delle tappe, scritti da noi e non dallo stile.
   *
   * Sotto il pin e non sopra il punto: la mappa ancora le proprie etichette esattamente
   * alla coordinata, quindi il pin finiva sempre a coprire il nome del posto in cui ti
   * trovi. Qui il nome sta staccato, con un alone che lo tiene leggibile sia sulla terra
   * chiara sia sul mare nero.
   *
   * Un livello di MapLibre e non un'etichetta HTML attaccata al marcatore, perché così i
   * nomi si nascondono da soli quando si sovrappongono — cosa che succede sempre quando la
   * camera si allarga e due tappe finiscono a pochi pixel l'una dall'altra.
   */
  private drawNames(): void {
    try {
      this.map.addSource(NAMES_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: this.options.stops.map((stop) => ({
            type: 'Feature' as const,
            properties: { nome: stop.name },
            geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
          })),
        },
      });

      this.map.addLayer({
        id: NAMES_LAYER,
        type: 'symbol',
        source: NAMES_SOURCE,
        layout: {
          'text-field': ['get', 'nome'],
          'text-font': FONT,
          'text-size': 13.5,
          'text-anchor': 'top',
          // Sotto il pin, con un dito di respiro: appiccicato, il cerchio bianco e le
          // lettere si toccano e tornano a leggersi come una macchia sola.
          'text-offset': [0, 1.35],
          'text-padding': 6,
          'text-max-width': 9,
        },
        paint: {
          'text-color': '#0c1116',
          'text-halo-color': 'rgba(238, 242, 246, 0.95)',
          'text-halo-width': 1.8,
          'text-halo-blur': 0.2,
        },
      });
    } catch {
      // Stile mai arrivato: niente nomi. Le tappe restano comunque nel carosello.
    }
  }

  /**
   * La rotta che collega le tappe.
   *
   * **Non è più azzurra e non è più tratteggiata.** L'azzurro era un colore in più su una
   * pagina che ne ha già uno solo, e su una mappa in scala di grigi tirava l'occhio più
   * delle foto; il tratteggio la faceva sembrare un'indicazione stradale invece di una
   * traccia. Ora è una linea continua e sottile in grigio d'ardesia — un tratto di matita
   * sulla mappa, non un percorso da seguire.
   *
   * Due strati restano necessari, e per una ragione che si vede solo provando: la terra è
   * chiara e il mare è quasi nero, quindi **nessun colore singolo si legge su entrambi**.
   * La linea scura sopra tiene sulla terra, l'alone chiaro sotto la stacca dal mare.
   */
  private drawRoute(): void {
    if (this.options.stops.length < 2) return;

    try {
      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: routeGeoJson(this.options.stops.map((s) => ({ lon: s.lon, lat: s.lat }))),
      });

      this.map.addLayer({
        id: ROUTE_GLOW_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        /*
         * L'alone è SCURO e la linea sopra è bianca: i due strati sono invertiti rispetto
         * a prima, ed è quello che permette a una rotta bianca di esistere su una mappa
         * che ha la terra chiara. Senza l'ombra sotto, sulla costa la linea sparirebbe.
         */
        paint: { 'line-color': '#0a0e12', 'line-opacity': 0.45, 'line-width': 5, 'line-blur': 1.5 },
      });

      this.map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // Bianca, appoggiata sulla propria ombra: risalta su tutto senza essere un
          // colore. Il grigio d'ardesia di prima si leggeva, ma spariva dentro le strade
          // della mappa, che sono grigie anche loro.
          'line-color': ROTTA,
          'line-opacity': 0.92,
          'line-width': 1.8,
        },
      });
    } catch {
      // Stile mai arrivato: niente rotta. Le tappe e le foto restano al loro posto.
    }
  }

  /**
   * Porta la camera sulla tappa, con un movimento suo.
   *
   * Interrompibile per costruzione: chiamarla mentre un movimento è in corso lo sostituisce,
   * e MapLibre riparte dalla posizione corrente invece che da capo. È questo che permette
   * di attraversare tre tappe con una strisciata sola senza vedere tre animazioni in fila
   * — cosa che una coda di richieste, provata prima, faceva puntualmente.
   */
  goTo(slug: string): void {
    const meta = this.stop(slug);
    if (!meta) return;

    const da = this.active ? this.stop(this.active) : null;
    const km = da ? distanceKm(da, meta) : 0;
    this.setActive(slug);

    const comune = {
      center: [meta.lon, meta.lat] as [number, number],
      zoom: STOP_ZOOM,
      padding: this.deckPadding(),
    };

    if (km > VOLO_OLTRE_KM) {
      // `flyTo` allarga e richiude lo zoom da solo lungo il cammino: senza, fra due
      // continenti il mondo sfilerebbe sotto a velocità assurda.
      this.map.flyTo({ ...comune, duration: DURATA_LONTANO_MS, curve: 1.42 });
      return;
    }

    this.map.easeTo({ ...comune, duration: DURATA_VICINO_MS });
  }

  /** Lo spazio in fondo occupato dal carosello, così il pin resta nella parte visibile. */
  private deckPadding() {
    return { top: 0, left: 0, right: 0, bottom: Math.round(this.map.getContainer().clientHeight * DECK_SHARE) };
  }

  private dropPins(): void {
    for (const stop of this.options.stops) {
      const element = document.createElement('div');
      element.className = 'pin';
      element.dataset.slug = stop.slug;

      /*
       * Nessuno scostamento: il pin sta esattamente sulla coordinata.
       *
       * Per un po' era alzato di dodici pixel, per non coprire il nome che la mappa
       * disegna sulla stessa coordinata. Ma la rotta parte dal punto vero, quindi il pin
       * spostato le restava staccato di dodici pixel — e una linea che non tocca il suo
       * capo si vede subito, molto più di un nome mezzo coperto.
       */
      new this.gl.Marker({ element }).setLngLat([stop.lon, stop.lat]).addTo(this.map);
      this.markers.set(stop.slug, element);
    }
  }

  private setActive(slug: string): void {
    if (this.active === slug) return;

    if (this.active) this.markers.get(this.active)?.classList.remove('pin--active');
    this.markers.get(slug)?.classList.add('pin--active');
    this.active = slug;
  }

  private stop(slug: string): MapStop | undefined {
    return this.options.stops.find((s) => s.slug === slug);
  }

  destroy(): void {
    this.markers.clear();
    this.map.remove();
  }
}
