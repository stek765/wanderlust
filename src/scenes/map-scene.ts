/**
 * Il globo che vola sul posto.
 *
 * Questi 2,5 secondi non sono decorazione, e chi tocca questo file deve saperlo prima di
 * "ottimizzarli". Le foto sono cifrate: prima di comparire vanno scaricate e decifrate, e
 * quel lavoro costa. Il volo dura esattamente quanto serve a farlo in sottofondo.
 *
 * Togliere l'animazione non renderebbe la pagina più veloce: farebbe comparire uno
 * spinner al posto di un globo che scende su Bangkok.
 */

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';

/** Durata del volo. È anche il budget entro cui le miniature devono essere pronte. */
export const FLIGHT_MS = 2500;

/**
 * Lo stile della mappa. Tutti gratuiti e senza chiave API.
 *
 * "Dark Matter" di CARTO: terre quasi nere, acqua grigio scuro, niente strade, solo le
 * etichette delle città. È lo stesso registro del video di riferimento, ed è l'unico che
 * non combatte con le foto — una mappa colorata sotto una copertina a schermo intero fa
 * a botte con lei.
 *
 * Alternative già pronte, basta sostituire la costante:
 *   https://basemaps.cartocdn.com/gl/positron-gl-style/style.json      chiaro e minimale
 *   https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json       colorato ma sobrio
 *   https://tiles.openfreemap.org/styles/liberty                       OSM classico
 */
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const START_ZOOM = 1.2;
const ARRIVAL_ZOOM = 12.5;

/** Oltre questo, si rinuncia alle mappe e si mostrano comunque le foto. */
const STYLE_TIMEOUT_MS = 5000;

export interface MapSceneOptions {
  container: HTMLElement;
  lat: number;
  lon: number;
}

export class MapScene {
  private readonly map: MapLibreMap;
  private marker?: maplibregl.Marker;

  /**
   * Costruisce la scena, o restituisce null se questo browser non ce la fa.
   *
   * Senza WebGL — dispositivo vecchio, accelerazione disattivata, WebView strana —
   * MapLibre non parte. Quando succede la pagina deve mostrare le foto lo stesso: la
   * mappa è la messa in scena, le foto sono il contenuto, e il contenuto non può
   * dipendere dalla messa in scena.
   */
  static create(options: MapSceneOptions): MapScene | null {
    try {
      return new MapScene(options);
    } catch {
      return null;
    }
  }

  private constructor(private readonly options: MapSceneOptions) {
    this.map = new maplibregl.Map({
      container: options.container,
      style: STYLE_URL,
      center: [options.lon, options.lat],
      zoom: START_ZOOM,
      attributionControl: { compact: true },
      // La scena si guarda, non si esplora: ogni gesto qui ruberebbe attenzione alle foto.
      interactive: false,
    });
  }

  /**
   * Risolve quando lo stile è caricato e si può iniziare a volare.
   *
   * Non aspetta all'infinito: se le mappe non arrivano — rete lenta, OpenFreeMap giù,
   * WebGL assente — dopo qualche secondo si prosegue comunque. Meglio le foto senza
   * volo che una pagina bianca.
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
  }

  /**
   * Scende sul punto e ci pianta il pin. Risolve a volo finito.
   *
   * `essential: true` è quello che tiene in piedi l'effetto per chi ha attivato la
   * riduzione del movimento a livello di sistema: senza, MapLibre salterebbe al punto
   * di arrivo e la copertina comparirebbe prima di essere pronta.
   */
  async flyToPlace(): Promise<void> {
    const { lat, lon } = this.options;

    this.map.flyTo({
      center: [lon, lat],
      zoom: ARRIVAL_ZOOM,
      duration: FLIGHT_MS,
      // Parte deciso e si posa piano, come una discesa vera.
      curve: 1.6,
      essential: true,
    });

    await new Promise<void>((resolve) => {
      const done = () => {
        this.map.off('moveend', done);
        resolve();
      };
      this.map.on('moveend', done);
      // Se moveend non arrivasse (scheda in background, animazione interrotta) la scena
      // non deve restare appesa: il tempo del volo è comunque scaduto.
      setTimeout(done, FLIGHT_MS + 400);
    });

    this.dropPin();
  }

  private dropPin(): void {
    const element = document.createElement('div');
    element.className = 'pin';
    this.marker = new maplibregl.Marker({ element })
      .setLngLat([this.options.lon, this.options.lat])
      .addTo(this.map);
  }

  destroy(): void {
    this.marker?.remove();
    this.map.remove();
  }
}
