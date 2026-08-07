/**
 * Verifica dei token. Non c'è login: tutto il controllo passa da due segreti.
 *
 * - token di scrittura: uno per posto, sta nell'URL del tag NFC dopo `?w=`
 * - token master: uno solo, segreto del Worker, serve per creare posti nuovi
 *
 * Il database conserva soltanto gli hash. Se qualcuno legge il DB non ottiene niente di
 * riutilizzabile.
 */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Confronto a tempo costante fra due stringhe esadecimali.
 *
 * Un `===` normale si ferma al primo carattere diverso, e il tempo di risposta racconta
 * quanti caratteri erano giusti: con abbastanza tentativi un token si ricostruisce un
 * carattere alla volta. Qui si scorrono sempre tutti i caratteri.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Estrae il token da `Authorization: Bearer <token>`. null se manca o è malformato. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return null;
  return value;
}

/** Vero se il token presentato corrisponde all'hash atteso. */
export async function tokenMatches(presented: string | null, expectedHash: string): Promise<boolean> {
  if (!presented) return false;
  return timingSafeEqual(await sha256Hex(presented), expectedHash);
}
