/**
 * Mostrare una miniatura cifrata fuori dalla pagina di un viaggio.
 *
 * Dentro il viaggio questo lavoro lo fa `PhotoStore`, che tiene una chiave sola e una
 * cache. Qui no: la pagina master elenca **tutti** i viaggi, ognuno con la sua chiave, e
 * non ne ha nessuna in mano finché non guarda il portachiavi. Quindi ogni miniatura porta
 * con sé la chiave del proprio viaggio, e si decifra per conto suo.
 *
 * Tutto fallisce in silenzio, ed è voluto: un viaggio creato su un altro browser non ha
 * la sua chiave su questo, e non l'avrà mai. La sua scheda resta leggibile, senza foto.
 */

import { fetchEncrypted } from '../lib/api-client';
import { decryptBlob, importKey } from '../lib/crypto';
import { averageColor, toTint } from '../lib/tinta';

/** La copertina di un viaggio nell'indice, con il colore che ne tinge la scheda. */
export async function paintCover(
  card: HTMLElement,
  host: HTMLElement,
  thumbKey: string,
  keyMaterial: string,
  setBackdrop: ((url: string) => void) | null,
): Promise<void> {
  const url = await decryptToUrl(thumbKey, keyMaterial);
  if (!url) return;

  host.style.backgroundImage = `url("${url}")`;
  host.classList.add('trip__cover--loaded');
  setBackdrop?.(url);

  // Lo stesso colore che tinge le tappe dentro il viaggio, qui diventa l'alone della sua
  // scheda: l'indice e il viaggio parlano la stessa lingua.
  const colore = await averageColor(url);
  if (colore) card.style.setProperty('--alone', toTint(colore, 0.35));
}

/** La miniatura di una tappa, nella fila sotto il nome del viaggio. */
export async function paintThumb(host: HTMLElement, thumbKey: string, keyMaterial: string): Promise<void> {
  const url = await decryptToUrl(thumbKey, keyMaterial);
  if (!url) return;

  host.style.backgroundImage = `url("${url}")`;
  host.classList.add('stopchip__thumb--loaded');
}

/** Scarica, decifra, e restituisce un URL che un CSS può usare. Null se qualcosa non torna. */
export async function decryptToUrl(thumbKey: string, keyMaterial: string): Promise<string | null> {
  try {
    const key = await importKey(keyMaterial);
    const plain = await decryptBlob(key, await fetchEncrypted(thumbKey));
    return URL.createObjectURL(new Blob([plain], { type: 'image/webp' }));
  } catch {
    return null;
  }
}
