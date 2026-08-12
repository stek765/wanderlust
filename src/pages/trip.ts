/**
 * La pagina che si apre toccando il magnete: il viaggio intero, con la mappa protagonista.
 *
 * Tre livelli, e uno solo alla volta chiede attenzione:
 *
 *   1. la mappa a tutto schermo, con le tappe collegate dalla rotta
 *   2. in fondo, il carosello delle tappe: si scorre di lato e la mappa raggiunge quella
 *      su cui ci si centra
 *   3. toccando la tappa corrente si aprono le sue foto, in ordine cronologico
 *
 * Nessuna animazione d'ingresso: si arriva e la mappa è già lì. L'unico movimento è il
 * salto da una tappa all'altra, ed è quello che racconta il viaggio.
 *
 * Il costo di apertura è basso per costruzione, ed è il motivo per cui il vecchio volo di
 * 3,8 secondi non serve più: la prima schermata ha bisogno di una miniatura per tappa,
 * non di una galleria. Le foto vere si scaricano e si decifrano solo aprendo una tappa.
 */

import type { PhotoDto, StopDto, TripDto } from '../../shared/api-types';
import { deletePhoto, fetchTrip } from '../lib/api-client';
import { importKey } from '../lib/crypto';
import { PhotoStore } from '../lib/photo-store';
import { buildShareUrl, cleanedUrl, resolveWriteToken, type TripRoute } from '../lib/session';
import { GalleryView } from '../scenes/gallery-view';
import { MapScene } from '../scenes/map-scene';
import { Menu } from '../scenes/menu';
import { StopDeck } from '../scenes/stop-deck';
import { Viewer } from '../scenes/viewer';

export async function renderTripPage(root: HTMLElement, route: TripRoute): Promise<void> {
  if (!route.keyMaterial) {
    return renderMessage(
      root,
      'Link incompleto',
      'Manca la parte dopo il #, quella che apre le foto. Riprova a toccare il magnete.',
    );
  }

  let key: CryptoKey;
  try {
    key = await importKey(route.keyMaterial);
  } catch {
    return renderMessage(root, 'Link non valido', 'La chiave in questo link non è utilizzabile.');
  }

  let trip: TripDto;
  try {
    trip = await fetchTrip(route.slug);
  } catch {
    return renderMessage(root, 'Viaggio non trovato', 'Questo link non porta da nessuna parte.');
  }

  // Il token arriva dal tag la prima volta, poi vive in localStorage su questo telefono.
  const writeToken = resolveWriteToken(localStorage, route);
  if (route.writeTokenFromUrl) {
    // Via dalla barra degli indirizzi: se l'utente copia l'URL a mano non deve regalare
    // il potere di scrittura. La chiave invece resta, o un ricaricamento non aprirebbe più nulla.
    history.replaceState(null, '', cleanedUrl(location.href));
  }

  const store = new PhotoStore(key);
  root.replaceChildren();

  const mapLayer = document.createElement('div');
  mapLayer.className = 'map';
  root.append(mapLayer);

  const first = trip.stops[0];
  if (!first) {
    root.append(buildTitle(trip, route.keyMaterial));
    return renderMessage(
      root,
      'Viaggio senza tappe',
      'Questo viaggio esiste ma non ha ancora nessun posto dentro.',
    );
  }

  /*
   * L'elenco delle foto vive qui, non dentro le viste.
   *
   * Due pezzi lo guardano — il carosello per il conteggio e la copertina, la galleria per
   * la griglia — e tenerne due copie significa vederle divergere al primo caricamento.
   */
  const photosBySlug = new Map<string, PhotoDto[]>(trip.stops.map((s) => [s.slug, [...s.photos]]));
  const stopBySlug = new Map<string, StopDto>(trip.stops.map((s) => [s.slug, s]));

  const viewer = new Viewer([], store);

  const shelf = new GalleryView({
    store,
    writeToken,
    key,
    onOpenPhoto: (photos, index) => {
      viewer.setPhotos(photos);
      void viewer.open(index);
    },
    onPhotosChanged: (slug, photos) => {
      photosBySlug.set(slug, photos);
      const stop = stopBySlug.get(slug);
      if (stop) deck.refresh({ ...stop, photos });
    },
  });

  /*
   * La mappa arriva dopo, e può non arrivare mai.
   *
   * Sta in una variabile invece che in una costante perché la pagina si costruisce e si
   * usa mentre MapLibre è ancora in viaggio: fino ad allora ogni richiesta alla mappa
   * cade nel vuoto, e va bene così. `attiva` è la memoria di dove siamo nel frattempo,
   * ed è quello che la mappa legge appena è pronta — il dito è più veloce di 284 KB.
   */
  let scene: MapScene | null = null;
  let attiva = first.slug;
  let chiusa = false;

  const deck = new StopDeck({
    stops: trip.stops,
    store,
    // Il carosello dice solo dove siamo centrati; come arrivarci lo decide la mappa.
    onFocus: (slug) => {
      attiva = slug;
      scene?.goTo(slug);
    },
    onOpen: (slug) => {
      const stop = stopBySlug.get(slug);
      if (stop) shelf.open(stop, photosBySlug.get(slug) ?? []);
    },
  });

  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.append(buildTitle(trip, route.keyMaterial), deck.element);

  root.append(stage, shelf.element);

  // Sui nostri browser il ☰ c'è sempre; su quello di chi riceve un link non compare.
  Menu.mount(root);

  // Il cestino nel visore deve togliere la foto dalla tappa aperta, non da un'altra.
  if (writeToken) {
    viewer.setActions({
      onDelete: async (photo) => {
        const slug = shelf.currentSlug();
        if (!slug) return;
        await deletePhoto(slug, writeToken, photo.id);
        shelf.forget(photo);
      },
    });
  }

  // Registrato prima di far partire la mappa: se la pagina si chiude mentre MapLibre è
  // ancora in viaggio, quello che arriva dopo deve trovare la porta già chiusa.
  window.addEventListener(
    'pagehide',
    () => {
      chiusa = true;
      store.revokeAll();
      scene?.destroy();
    },
    { once: true },
  );

  // La prima tappa è scelta subito, senza aspettare niente e senza animazione.
  //
  // Prima questa riga stava dopo l'attesa della mappa, e su rete lenta il carosello
  // restava fino a cinque secondi senza nessuna tappa evidenziata e con la data a `—`:
  // la pagina sembrava caricata e rotta insieme. La mappa è la messa in scena, le foto
  // sono il contenuto, e il contenuto non aspetta la messa in scena — nemmeno quando la
  // messa in scena sta soltanto tardando.
  deck.select(first.slug, 'instant');

  // Se il browser non regge la mappa si prosegue senza: le tappe e le foto non dipendono
  // da lei.
  void MapScene.create({
    container: mapLayer,
    stops: trip.stops.map((s) => ({ slug: s.slug, name: s.name, lat: s.lat, lon: s.lon })),
    // Dove siamo adesso, non dove si era partiti: qui coincidono, ma è `attiva` la
    // risposta giusta alla domanda "quale tappa deve mostrare la mappa".
    focus: attiva,
  }).then(async (created) => {
    if (!created) return;
    if (chiusa) return created.destroy();

    scene = created;
    await created.ready();
    if (chiusa) return created.destroy();

    // Nel frattempo il dito può aver già portato il carosello altrove: la mappa raggiunge
    // dove siamo adesso, non dov'eravamo quando è partita.
    created.goTo(attiva);
  });
}

/**
 * Il nome del viaggio in alto, e il pulsante per condividerlo.
 *
 * Piccolo di proposito: la mappa è la scena, il nome è una didascalia. Prima era un
 * titolo alto settanta pixel su un sipario a schermo intero, e quel sipario non c'è più.
 */
function buildTitle(trip: TripDto, keyMaterial: string): HTMLElement {
  const head = document.createElement('header');
  head.className = 'trip-title';

  const name = document.createElement('h1');
  name.textContent = trip.name;

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'share';
  share.textContent = 'Condividi';
  share.addEventListener('click', () => void shareLink(trip, keyMaterial, share));

  head.append(name, share);
  return head;
}

/**
 * Condivide il link SENZA il token di scrittura: chi lo riceve guarda, non tocca.
 * È la regola di sicurezza principale del progetto, e sta in questa riga.
 */
async function shareLink(
  trip: TripDto,
  keyMaterial: string,
  button: HTMLButtonElement,
): Promise<void> {
  const url = buildShareUrl(location.origin, trip.slug, keyMaterial);

  if (navigator.share) {
    await navigator.share({ title: trip.name, url }).catch(() => undefined);
    return;
  }

  await navigator.clipboard.writeText(url).catch(() => undefined);
  const original = button.textContent;
  button.textContent = 'Copiato';
  setTimeout(() => (button.textContent = original), 2000);
}

function renderMessage(root: HTMLElement, title: string, detail: string): void {
  const box = document.createElement('div');
  box.className = 'message';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = detail;
  box.append(heading, paragraph);
  root.append(box);
}
