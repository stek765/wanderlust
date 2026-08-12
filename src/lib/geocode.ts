/**
 * Da un nome scritto a mano a delle coordinate.
 *
 * Nominatim di OpenStreetMap: gratuito, senza chiave API, e per un uso come questo — una
 * ricerca ogni volta che nasce una tappa — abbondantemente dentro le loro condizioni.
 *
 * Sta in `lib` e non fra le scene perché non tocca il DOM: è una domanda a un servizio e
 * una risposta, e l'unico pezzo della pagina master che si possa provare senza un browser.
 */

export interface Luogo {
  lat: number;
  lon: number;
  /** Il nome da dare alla tappa. */
  nome: string;
  /** L'indirizzo completo, da mostrare a chi ha cercato perché confermi che è quello giusto. */
  etichetta: string;
}

/**
 * Cerca un luogo. Torna null sia se non lo trova sia se il servizio non risponde, e la
 * differenza non serve a nessuno: in entrambi i casi l'unica via d'uscita è scrivere le
 * coordinate a mano, che resta sempre possibile.
 */
export async function geocode(query: string): Promise<Luogo | null> {
  if (!query.trim()) return null;

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;

    const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const first = results[0];
    if (!first) return null;

    // Il nome della tappa è il primo pezzo di quello che Nominatim restituisce: "Cala
    // Gonone" da "Cala Gonone, Dorgali, Nuoro, Sardegna, Italia".
    const nome = first.display_name.split(',')[0]?.trim() || query.trim();

    return { lat: Number(first.lat), lon: Number(first.lon), nome, etichetta: first.display_name };
  } catch {
    return null;
  }
}
