/**
 * La pagina che si apre toccando il magnete.
 *
 * La sequenza è tutta qui, ed è pensata perché il tempo di decifratura non si veda mai:
 *
 *   1. si chiedono i metadati del posto (leggeri, nessuna immagine)
 *   2. parte il volo sul globo
 *   3. mentre la camera scende, le miniature vengono scaricate e decifrate
 *   4. il volo finisce, il pin si apre, la copertina è già pronta
 *
 * Il punto 3 è il motivo per cui il punto 2 esiste. Non invertirli.
 */

import type { PhotoDto, PlaceDto } from '../../shared/api-types';
import { deletePhoto, fetchPlace, setCover } from '../lib/api-client';
import { importKey } from '../lib/crypto';
import { PhotoStore } from '../lib/photo-store';
import { buildShareUrl, cleanedUrl, resolveWriteToken, type PlaceRoute } from '../lib/session';
import { Gallery } from '../scenes/gallery';
import { MapScene } from '../scenes/map-scene';
import { UploadPanel } from '../scenes/upload-panel';
import { Viewer } from '../scenes/viewer';

/** Quante miniature preparare durante il volo. Oltre, si caricano scorrendo. */
const PRELOAD_COUNT = 12;

export async function renderPlacePage(root: HTMLElement, route: PlaceRoute): Promise<void> {
  if (!route.keyMaterial) {
    return renderMessage(root, 'Link incompleto', 'Manca la parte dopo il #, quella che apre le foto. Riprova a toccare il magnete.');
  }

  let key: CryptoKey;
  try {
    key = await importKey(route.keyMaterial);
  } catch {
    return renderMessage(root, 'Link non valido', 'La chiave in questo link non è utilizzabile.');
  }

  let place: PlaceDto;
  try {
    place = await fetchPlace(route.slug);
  } catch {
    return renderMessage(root, 'Posto non trovato', 'Questo link non porta da nessuna parte.');
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
  const content = document.createElement('main');
  content.className = 'content';
  root.append(mapLayer, content);

  // Se il browser non regge la mappa si prosegue senza: le foto non dipendono da lei.
  const scene = MapScene.create({ container: mapLayer, lat: place.lat, lon: place.lon });
  await scene?.ready();

  // Volo e decifratura partono insieme: è l'intero trucco della pagina.
  const cover = coverOf(place);
  const preloadKeys = [
    ...(cover ? [cover.thumbKey, cover.key] : []),
    ...place.photos.slice(0, PRELOAD_COUNT).map((p) => p.thumbKey),
  ];

  await Promise.all([scene?.flyToPlace(), store.preload(preloadKeys)]);

  await renderContent({ content, place, store, writeToken, slug: route.slug, key, keyMaterial: route.keyMaterial });
}

interface ContentOptions {
  content: HTMLElement;
  place: PlaceDto;
  store: PhotoStore;
  writeToken: string | null;
  slug: string;
  key: CryptoKey;
  keyMaterial: string;
}

async function renderContent(options: ContentOptions): Promise<void> {
  const { content, place, store, writeToken } = options;
  let photos = [...place.photos];

  content.replaceChildren();
  content.classList.add('content--revealed');

  content.append(await buildHero(place, photos, store));
  content.append(buildHeader(place, photos, options.slug, options.keyMaterial));

  const galleryHost = document.createElement('section');
  galleryHost.className = 'gallery';
  content.append(galleryHost);

  const viewer = new Viewer(photos, store, writeToken ? {
    onSetCover: async (photo) => {
      await setCover(options.slug, writeToken, photo.id);
    },
    onDelete: async (photo) => {
      await deletePhoto(options.slug, writeToken, photo.id);
      photos = photos.filter((p) => p.id !== photo.id);
      redrawGallery();
    },
  } : {});

  let gallery: Gallery | null = null;
  const redrawGallery = () => {
    gallery?.destroy();
    galleryHost.replaceChildren();
    if (photos.length === 0) {
      galleryHost.append(emptyState(Boolean(writeToken)));
      return;
    }
    gallery = new Gallery({
      container: galleryHost,
      photos,
      store,
      onOpen: (index) => void viewer.open(index),
    });
  };
  redrawGallery();

  // Il "+" solo per chi ha toccato il magnete.
  if (writeToken) {
    new UploadPanel({
      container: content,
      slug: options.slug,
      writeToken,
      key: options.key,
      onFinished: (added) => {
        photos = [...photos, ...added].sort((a, b) => a.sortIndex - b.sortIndex);
        redrawGallery();
      },
    });
  }

  window.addEventListener('pagehide', () => store.revokeAll(), { once: true });
}

async function buildHero(place: PlaceDto, photos: PhotoDto[], store: PhotoStore): Promise<HTMLElement> {
  const hero = document.createElement('section');
  hero.className = 'hero';

  const cover = coverOf({ ...place, photos });
  if (cover) {
    try {
      const image = document.createElement('img');
      image.src = await store.url(cover.key);
      image.alt = '';
      image.className = 'hero__image';
      hero.append(image);
    } catch {
      hero.classList.add('hero--empty');
    }
  } else {
    hero.classList.add('hero--empty');
  }

  return hero;
}

function buildHeader(place: PlaceDto, photos: PhotoDto[], slug: string, keyMaterial: string): HTMLElement {
  const header = document.createElement('header');
  header.className = 'place-header';

  const title = document.createElement('h1');
  title.textContent = place.name;

  const subtitle = document.createElement('p');
  subtitle.className = 'place-header__meta';
  subtitle.textContent = describeSpan(photos);

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'share';
  share.textContent = 'Condividi';
  share.addEventListener('click', () => void shareLink(place.name, slug, keyMaterial, share));

  header.append(title, subtitle, share);
  return header;
}

/**
 * Condivide il link SENZA il token di scrittura: chi lo riceve guarda, non tocca.
 * È la regola di sicurezza principale del progetto, e sta in questa riga.
 */
async function shareLink(name: string, slug: string, keyMaterial: string, button: HTMLButtonElement): Promise<void> {
  const url = buildShareUrl(location.origin, slug, keyMaterial);

  if (navigator.share) {
    await navigator.share({ title: name, url }).catch(() => undefined);
    return;
  }

  await navigator.clipboard.writeText(url).catch(() => undefined);
  const original = button.textContent;
  button.textContent = 'Link copiato';
  setTimeout(() => (button.textContent = original), 2000);
}

function describeSpan(photos: PhotoDto[]): string {
  const dates = photos.map((p) => p.takenAt).filter((d): d is number => typeof d === 'number');
  const count = `${photos.length} ${photos.length === 1 ? 'foto' : 'foto'}`;
  if (dates.length === 0) return count;

  const format = (ms: number) =>
    new Date(ms).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  const first = format(Math.min(...dates));
  const last = format(Math.max(...dates));

  return first === last ? `${first} · ${count}` : `${first} – ${last} · ${count}`;
}

function coverOf(place: PlaceDto): PhotoDto | undefined {
  return place.photos.find((p) => p.id === place.coverPhotoId) ?? place.photos[0];
}

function emptyState(canUpload: boolean): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = canUpload
    ? 'Ancora nessuna foto. Tocca "+ Aggiungi foto" per cominciare.'
    : 'Qui non c\'è ancora niente.';
  return empty;
}

function renderMessage(root: HTMLElement, title: string, detail: string): void {
  root.replaceChildren();
  const box = document.createElement('div');
  box.className = 'message';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = detail;
  box.append(heading, paragraph);
  root.append(box);
}
