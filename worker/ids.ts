/**
 * Identificatori casuali.
 *
 * Slug, token e chiavi R2 devono essere non indovinabili: sono l'unica cosa che separa
 * un estraneo dai ricordi. Vengono tutti da crypto.getRandomValues, mai da contatori,
 * timestamp o hash di dati prevedibili.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Stringa casuale in base36. 12 caratteri ≈ 62 bit: non enumerabile. */
export function randomId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) {
    // Il modulo introduce una distorsione trascurabile (256 % 36 = 4 valori favoriti
    // su 256) e qui non conta: serve imprevedibilità, non uniformità perfetta.
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** Token segreto a 256 bit, in base64url. Usato per scrittura e accesso master. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
