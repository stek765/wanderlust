/**
 * Come si legge un URL di questo sito, e come se ne fabbrica uno da condividere.
 *
 * L'URL scritto sul tag NFC ha tre parti, e ognuna sta dove sta per un motivo preciso:
 *
 *   https://sito/p/<slug>?w=<token>#<chiave>
 *                  ^^^^^^  ^^^^^^^^  ^^^^^^^
 *                  |       |         mai inviata al server: è il frammento, e la
 *                  |       |         specifica HTTP vieta al browser di spedirlo
 *                  |       arriva al server, che deve verificarlo per accettare
 *                  |       le scritture
 *                  arriva al server, identifica il posto
 *
 * Da qui discende la regola più importante del progetto: condividere significa togliere
 * il `?w=` e lasciare il `#`. Chi riceve il link guarda, chi tocca il magnete carica.
 */

const WRITE_TOKEN_PREFIX = 'ricordi:w:';

export interface PlaceRoute {
  kind: 'place';
  slug: string;
  /** La chiave in base64url, così com'era nel frammento. null se l'URL è monco. */
  keyMaterial: string | null;
  /** Presente solo se l'URL arrivava dal tag NFC. */
  writeTokenFromUrl: string | null;
}

export interface MasterRoute {
  kind: 'master';
  masterToken: string;
}

export interface UnknownRoute {
  kind: 'unknown';
}

export type Route = PlaceRoute | MasterRoute | UnknownRoute;

/** Riconosce che pagina è stata aperta. */
export function parseRoute(href: string): Route {
  const url = new URL(href);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'p' && segments[1]) {
    return {
      kind: 'place',
      slug: segments[1],
      keyMaterial: url.hash ? url.hash.slice(1) : null,
      writeTokenFromUrl: url.searchParams.get('w'),
    };
  }

  if (segments[0] === 'm' && segments[1]) {
    return { kind: 'master', masterToken: segments[1] };
  }

  return { kind: 'unknown' };
}

/**
 * Il link da dare agli altri: stesso posto, stessa chiave, senza potere di scrittura.
 */
export function buildShareUrl(origin: string, slug: string, keyMaterial: string): string {
  return `${origin}/p/${slug}#${keyMaterial}`;
}

/** L'URL completo da scrivere sul tag NFC. Prodotto una volta, alla creazione del posto. */
export function buildTagUrl(origin: string, slug: string, writeToken: string, keyMaterial: string): string {
  return `${origin}/p/${slug}?w=${encodeURIComponent(writeToken)}#${keyMaterial}`;
}

/**
 * L'URL ripulito da mostrare nella barra degli indirizzi dopo aver messo via il token.
 * La chiave resta: senza, un ricaricamento della pagina non saprebbe più decifrare.
 */
export function cleanedUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('w');
  return url.pathname + url.search + url.hash;
}

/**
 * Il token di scrittura vive in localStorage, per posto.
 *
 * Serve perché il tag lo porta una volta sola: dopo il primo tocco l'utente potrebbe
 * arrivare da un preferito o da un link condiviso, e il "+" deve restare al suo posto su
 * quel telefono.
 */
export function rememberWriteToken(storage: Storage, slug: string, token: string): void {
  storage.setItem(WRITE_TOKEN_PREFIX + slug, token);
}

export function recallWriteToken(storage: Storage, slug: string): string | null {
  return storage.getItem(WRITE_TOKEN_PREFIX + slug);
}

export function forgetWriteToken(storage: Storage, slug: string): void {
  storage.removeItem(WRITE_TOKEN_PREFIX + slug);
}

/**
 * Il token buono per questo posto: quello appena arrivato dal tag, altrimenti quello già
 * memorizzato. Quando arriva dal tag viene anche salvato.
 */
export function resolveWriteToken(storage: Storage, route: PlaceRoute): string | null {
  if (route.writeTokenFromUrl) {
    rememberWriteToken(storage, route.slug, route.writeTokenFromUrl);
    return route.writeTokenFromUrl;
  }
  return recallWriteToken(storage, route.slug);
}
