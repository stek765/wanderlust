/**
 * La rotta fra due tappe, disegnata come la percorrerebbe un aereo.
 *
 * Perché non basta una linea dritta: MapLibre disegna un `LineString` come segmento
 * dritto nello spazio proiettato. Su Mercator quel segmento non è il cammino più breve, e
 * a zoom largo la differenza è vistosa — Tokyo–San Francisco taglierebbe l'oceano in
 * orizzontale invece di curvare verso nord. Sembrerebbe un errore di disegno, non una
 * rotta. Quindi l'arco lo interpoliamo noi, punto per punto, sulla sfera.
 *
 * Nessuna dipendenza da MapLibre qui dentro: è aritmetica pura, e si prova senza browser.
 */

export interface LngLat {
  lon: number;
  lat: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Quanti punti per tratta. 64 è già indistinguibile da una curva vera su uno schermo. */
export const DEFAULT_STEPS = 64;

/** L'angolo al centro della Terra fra due punti, in radianti. */
function angularDistance(a: LngLat, b: LngLat): number {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;

  return (
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2,
        ),
      ),
    )
  );
}

/** La distanza fra due punti in chilometri. Serve a decidere quanto allargare la camera. */
export function distanceKm(a: LngLat, b: LngLat): number {
  return angularDistance(a, b) * 6371;
}

/**
 * Il punto sull'arco fra due tappe, a una frazione del percorso.
 *
 * È la stessa formula che disegna le rotte, isolata: qui serve a far seguire alla camera
 * lo stesso cammino che la linea tratteggiata mostra sulla mappa. Se seguisse una retta
 * fra le coordinate, la mappa scivolerebbe accanto alla propria rotta invece che sopra.
 */
export function pointOnArc(a: LngLat, b: LngLat, f: number): LngLat {
  const d = angularDistance(a, b);

  // Due tappe nello stesso punto: niente da interpolare, e dividere per sin(0) darebbe NaN.
  if (!Number.isFinite(d) || d === 0) return { lon: b.lon, lat: b.lat };

  const lat1 = a.lat * RAD;
  const lon1 = a.lon * RAD;
  const lat2 = b.lat * RAD;
  const lon2 = b.lon * RAD;

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return { lon: Math.atan2(y, x) * DEG, lat: Math.atan2(z, Math.hypot(x, y)) * DEG };
}

/**
 * Interpolazione sferica fra due punti: restituisce `steps + 1` coppie `[lon, lat]`,
 * estremi compresi.
 */
export function greatCircle(a: LngLat, b: LngLat, steps = DEFAULT_STEPS): Array<[number, number]> {
  const points: Array<[number, number]> = [];

  for (let i = 0; i <= steps; i++) {
    const { lon, lat } = pointOnArc(a, b, i / steps);
    points.push([lon, lat]);
  }

  // L'interpolazione degenere restituisce sempre il secondo punto: qui il primo va
  // rimesso a mano, o l'arco comincerebbe dove finisce.
  points[0] = [a.lon, a.lat];

  return unwrap(points);
}

/** Tutte le tratte del viaggio in un'unica linea, pronta da dare a MapLibre. */
export function routeGeoJson(stops: LngLat[], steps = DEFAULT_STEPS) {
  const coordinates: Array<[number, number]> = [];

  for (let i = 1; i < stops.length; i++) {
    const arc = greatCircle(stops[i - 1]!, stops[i]!, steps);
    // Il primo punto di ogni tratta è l'ultimo della precedente: metterlo due volte
    // lascerebbe un punto doppio dove il tratteggio si vede addensare.
    coordinates.push(...(i === 1 ? arc : arc.slice(1)));
  }

  return {
    type: 'Feature' as const,
    properties: {} as Record<string, never>,
    geometry: { type: 'LineString' as const, coordinates: unwrap(coordinates) },
  };
}

/**
 * Srotola le longitudini così che due punti consecutivi non saltino mai di 360 gradi.
 *
 * Senza, una rotta che attraversa l'antimeridiano passa da +179 a -179 e MapLibre la
 * disegna come una riga che torna indietro attraversando tutto il mondo. Uscire dal
 * campo -180…180 è lecito e voluto: la mappa lo gestisce.
 */
function unwrap(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length === 0) return [];

  const out: Array<[number, number]> = [points[0]!];
  let offset = 0;

  for (let i = 1; i < points.length; i++) {
    const delta = points[i]![0] - points[i - 1]![0];
    if (delta > 180) offset -= 360;
    else if (delta < -180) offset += 360;
    out.push([points[i]![0] + offset, points[i]![1]]);
  }

  return out;
}
