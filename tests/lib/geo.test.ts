import { describe, expect, it } from 'vitest';
import { greatCircle, routeGeoJson } from '../../src/lib/geo';

const BANGKOK = { lon: 100.5018, lat: 13.7563 };
const CHIANG_MAI = { lon: 98.9853, lat: 18.7883 };
const TOKYO = { lon: 139.6917, lat: 35.6895 };
const SAN_FRANCISCO = { lon: -122.4194, lat: 37.7749 };

describe('greatCircle', () => {
  it('parte e finisce esattamente sui due estremi', () => {
    const arco = greatCircle(BANGKOK, CHIANG_MAI, 16);

    expect(arco[0]![0]).toBeCloseTo(BANGKOK.lon, 6);
    expect(arco[0]![1]).toBeCloseTo(BANGKOK.lat, 6);
    expect(arco.at(-1)![0]).toBeCloseTo(CHIANG_MAI.lon, 6);
    expect(arco.at(-1)![1]).toBeCloseTo(CHIANG_MAI.lat, 6);
  });

  it('produce steps + 1 punti', () => {
    expect(greatCircle(BANGKOK, CHIANG_MAI, 16)).toHaveLength(17);
    expect(greatCircle(BANGKOK, CHIANG_MAI, 64)).toHaveLength(65);
  });

  it('non produce mai NaN', () => {
    for (const punto of greatCircle(TOKYO, SAN_FRANCISCO, 32)) {
      expect(Number.isFinite(punto[0])).toBe(true);
      expect(Number.isFinite(punto[1])).toBe(true);
    }
  });

  it('due punti coincidenti non fanno esplodere niente', () => {
    const arco = greatCircle(BANGKOK, BANGKOK, 16);
    expect(arco.length).toBeGreaterThanOrEqual(2);
    for (const punto of arco) {
      expect(Number.isFinite(punto[0])).toBe(true);
    }
  });

  it('curva: il punto di mezzo non sta sulla congiungente in coordinate piatte', () => {
    const arco = greatCircle(TOKYO, SAN_FRANCISCO, 32);
    const mezzo = arco[16]!;
    const latPiatta = (TOKYO.lat + SAN_FRANCISCO.lat) / 2;

    // L'arco passa molto più a nord della media aritmetica: è la curva che si vede.
    expect(mezzo[1]).toBeGreaterThan(latPiatta + 3);
  });

  it('attraversa l\'antimeridiano senza girare intorno al mondo', () => {
    const arco = greatCircle(TOKYO, SAN_FRANCISCO, 32);

    for (let i = 1; i < arco.length; i++) {
      // Nessun salto: due punti consecutivi restano vicini anche in longitudine.
      expect(Math.abs(arco[i]![0] - arco[i - 1]![0])).toBeLessThan(180);
    }
  });
});

describe('routeGeoJson', () => {
  it('concatena le tratte senza ripetere i punti in comune', () => {
    const rotta = routeGeoJson([BANGKOK, CHIANG_MAI, TOKYO], 8);
    // 9 punti per la prima tratta, 8 per ognuna delle successive (il primo è già lì).
    expect(rotta.geometry.coordinates).toHaveLength(17);
  });

  it('è un Feature LineString pronto per MapLibre', () => {
    const rotta = routeGeoJson([BANGKOK, CHIANG_MAI], 8);
    expect(rotta.type).toBe('Feature');
    expect(rotta.geometry.type).toBe('LineString');
  });

  it('con meno di due tappe non disegna niente', () => {
    expect(routeGeoJson([BANGKOK]).geometry.coordinates).toEqual([]);
    expect(routeGeoJson([]).geometry.coordinates).toEqual([]);
  });

  it('non salta mai in longitudine, nemmeno fra una tratta e l\'altra', () => {
    const rotta = routeGeoJson([TOKYO, SAN_FRANCISCO, BANGKOK], 16);
    const punti = rotta.geometry.coordinates;

    for (let i = 1; i < punti.length; i++) {
      expect(Math.abs(punti[i]![0] - punti[i - 1]![0])).toBeLessThan(180);
    }
  });
});
