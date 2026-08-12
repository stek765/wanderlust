import { describe, expect, it } from 'vitest';
import { toGlow, toTint } from '../../src/lib/tinta';

/** Estrae i tre canali da "rgb(12 34 56 / 16%)" o "rgb(12 34 56)". */
function canali(css: string): number[] {
  const numeri = css.match(/\d+/g)!.slice(0, 3).map(Number);
  return numeri;
}

describe('tinta di fondo', () => {
  it('resta nel campo dei colori validi anche partendo dagli estremi', () => {
    for (const colore of [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { r: 3, g: 250, b: 17 },
    ]) {
      for (const canale of canali(toTint(colore))) {
        expect(canale).toBeGreaterThanOrEqual(0);
        expect(canale).toBeLessThanOrEqual(255);
      }
    }
  });

  it('porta l\'opacità nella stringa, perché è una tinta e non un fondo', () => {
    expect(toTint({ r: 10, g: 120, b: 200 }, 0.16)).toContain('16%');
  });

  it('allarga la distanza fra i canali: un colore slavato torna a essere un colore', () => {
    const slavato = { r: 90, g: 110, b: 140 };
    const [r, g, b] = canali(toTint(slavato));

    const distanzaPrima = 140 - 90;
    const distanzaDopo = Math.max(r!, g!, b!) - Math.min(r!, g!, b!);

    expect(distanzaDopo).toBeGreaterThan(distanzaPrima);
  });

  it('non tiene la tinta di una foto in bianco e nero: non ce n\'è una', () => {
    const [r, g, b] = canali(toTint({ r: 120, g: 122, b: 124 }));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('non ribalta la tinta: se domina il blu, dopo domina ancora il blu', () => {
    const [r, g, b] = canali(toTint({ r: 40, g: 90, b: 190 }));
    expect(b).toBeGreaterThan(g!);
    expect(g).toBeGreaterThan(r!);
  });
});

describe('colore a piena luce', () => {
  it('schiarisce un colore scuro fino a renderlo visibile su fondo nero', () => {
    const scuro = { r: 12, g: 40, b: 70 };
    const massimoDopo = Math.max(...canali(toGlow(scuro)));

    expect(massimoDopo).toBeGreaterThan(70);
  });

  it('non sfonda oltre il bianco', () => {
    for (const canale of canali(toGlow({ r: 250, g: 252, b: 255 }))) {
      expect(canale).toBeLessThanOrEqual(255);
    }
  });

  it('il nero assoluto non diventa bianco per divisione per zero', () => {
    for (const canale of canali(toGlow({ r: 0, g: 0, b: 0 }))) {
      expect(Number.isFinite(canale)).toBe(true);
      expect(canale).toBe(0);
    }
  });
});
