/**
 * Cifratura delle foto, interamente nel browser.
 *
 * Regola che questo modulo esiste per far rispettare: una foto in chiaro non deve mai
 * attraversare la rete. Quello che parte da qui è già ciphertext, e la chiave per
 * riaprirlo non lascia mai il dispositivo — viaggia nel frammento dell'URL, che per
 * specifica HTTP il browser non invia al server.
 *
 * AES-GCM via WebCrypto, nessuna libreria esterna: la crittografia la fa il browser.
 */

const ALGORITHM = 'AES-GCM';
const KEY_BITS = 256;
const IV_BYTES = 12; // dimensione raccomandata per GCM

/** Genera la chiave di un posto nuovo. Esportabile, perché va messa nell'URL del tag. */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, true, ['encrypt', 'decrypt']);
}

/** La chiave in forma testuale, pronta da mettere dopo il `#`. */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return base64UrlEncode(new Uint8Array(raw));
}

/** Rilegge una chiave dall'URL. Lancia se la stringa non è una chiave valida. */
export async function importKey(encoded: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(encoded);
  if (raw.byteLength !== KEY_BITS / 8) {
    throw new Error('chiave di lunghezza sbagliata');
  }
  return crypto.subtle.importKey('raw', raw, { name: ALGORITHM, length: KEY_BITS }, true, ['encrypt', 'decrypt']);
}

/**
 * Cifra un blob. Il risultato è `[IV 12 byte][ciphertext]`.
 *
 * L'IV sta davanti al ciphertext invece che nel database perché è un dettaglio del file,
 * non un dato dell'applicazione: tenerli insieme rende impossibile perderne uno dei due.
 * Non è segreto, ma deve essere diverso a ogni cifratura — riusare un IV con la stessa
 * chiave, in GCM, è il modo classico di far crollare tutto.
 */
export async function encryptBlob(key: CryptoKey, data: ArrayBuffer): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, data);
  return new Blob([iv, ciphertext], { type: 'application/octet-stream' });
}

/**
 * Decifra un blob prodotto da encryptBlob.
 *
 * Se la chiave è sbagliata o i byte sono stati alterati, GCM se ne accorge e lancia:
 * non esiste il caso "decifrato male ma senza errore".
 */
export async function decryptBlob(key: CryptoKey, payload: ArrayBuffer): Promise<ArrayBuffer> {
  if (payload.byteLength <= IV_BYTES) {
    throw new Error('blob troppo corto per contenere un IV');
  }
  const bytes = new Uint8Array(payload);
  const iv = bytes.subarray(0, IV_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES);
  return crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
