/**
 * Come si legge un URL di questo sito, e come se ne fabbrica uno da condividere.
 *
 * Sul tag NFC c'è l'indirizzo di un VIAGGIO, non di un singolo posto: si tocca il
 * magnete e si apre la mappa con tutte le tappe, non una sola. Le tre parti stanno dove
 * stanno per un motivo preciso:
 *
 *   https://sito/v/<viaggio>?w=<token>#<chiave>
 *                  ^^^^^^^^^  ^^^^^^^^  ^^^^^^^
 *                  |          |         mai inviata al server: è il frammento, e la
 *                  |          |         specifica HTTP vieta al browser di spedirlo
 *                  |          arriva al server, che deve verificarlo per accettare
 *                  |          le scritture
 *                  arriva al server, identifica il viaggio
 *
 * Da qui discende la regola più importante del progetto: condividere significa togliere
 * il `?w=` e lasciare il `#`. Chi riceve il link guarda, chi tocca il magnete carica.
 */

const WRITE_TOKEN_PREFIX = 'ricordi:w:';
const MASTER_TOKEN_KEY = 'ricordi:master';

export interface TripRoute {
  kind: 'trip';
  /** Lo slug del viaggio: è l'unica cosa che sta sul magnete. */
  slug: string;
  /** La chiave del viaggio in base64url, così com'era nel frammento. null se l'URL è monco. */
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

export type Route = TripRoute | MasterRoute | UnknownRoute;

/** Riconosce che pagina è stata aperta. */
export function parseRoute(href: string): Route {
  const url = new URL(href);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'v' && segments[1]) {
    return {
      kind: 'trip',
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

/** Il link da dare agli altri: stesso viaggio, stessa chiave, senza potere di scrittura. */
export function buildShareUrl(origin: string, tripSlug: string, keyMaterial: string): string {
  return `${origin}/v/${tripSlug}#${keyMaterial}`;
}

/** L'URL completo da scrivere sul tag NFC. Prodotto una volta, alla creazione del viaggio. */
export function buildTagUrl(
  origin: string,
  tripSlug: string,
  writeToken: string,
  keyMaterial: string,
): string {
  return `${origin}/v/${tripSlug}?w=${encodeURIComponent(writeToken)}#${keyMaterial}`;
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
 * Il token di scrittura vive in localStorage, per viaggio.
 *
 * Serve perché il tag lo porta una volta sola: dopo il primo tocco l'utente potrebbe
 * arrivare da un preferito o da un link condiviso, e il "+" deve restare al suo posto su
 * quel telefono.
 */
export function rememberWriteToken(storage: Storage, tripSlug: string, token: string): void {
  storage.setItem(WRITE_TOKEN_PREFIX + tripSlug, token);
}

export function recallWriteToken(storage: Storage, tripSlug: string): string | null {
  return storage.getItem(WRITE_TOKEN_PREFIX + tripSlug);
}

export function forgetWriteToken(storage: Storage, tripSlug: string): void {
  storage.removeItem(WRITE_TOKEN_PREFIX + tripSlug);
}

/**
 * Il token buono per questo viaggio: quello appena arrivato dal tag, altrimenti quello
 * già memorizzato. Quando arriva dal tag viene anche salvato.
 */
export function resolveWriteToken(storage: Storage, route: TripRoute): string | null {
  if (route.writeTokenFromUrl) {
    rememberWriteToken(storage, route.slug, route.writeTokenFromUrl);
    return route.writeTokenFromUrl;
  }
  return recallWriteToken(storage, route.slug);
}

/**
 * Il token master, ricordato dopo una visita a `/m/<token>`.
 *
 * Non è un controllo di sicurezza in più: il Worker rifiuta comunque chi non lo presenta.
 * Serve solo perché il ☰ compaia sui nostri browser senza dover ridigitare l'indirizzo
 * segreto ogni volta, e non compaia su quello di chi riceve un link condiviso, dove non
 * avrebbe niente dentro.
 */
export function rememberMasterToken(storage: Storage, token: string): void {
  storage.setItem(MASTER_TOKEN_KEY, token);
}

export function recallMasterToken(storage: Storage): string | null {
  return storage.getItem(MASTER_TOKEN_KEY);
}
