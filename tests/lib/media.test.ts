import { describe, expect, it } from 'vitest';
import { FULL_MAX_EDGE, THUMB_MAX_EDGE, computeTargetSize } from '../../src/lib/media';

describe('ridimensionamento', () => {
  it('riduce una foto orizzontale al lato lungo richiesto', () => {
    // 4032x3024 è la foto standard di un iPhone.
    expect(computeTargetSize(4032, 3024, FULL_MAX_EDGE)).toEqual({ width: 1600, height: 1200 });
  });

  it('riduce una foto verticale usando l\'altezza come lato lungo', () => {
    expect(computeTargetSize(3024, 4032, FULL_MAX_EDGE)).toEqual({ width: 1200, height: 1600 });
  });

  it('non ingrandisce le immagini già piccole', () => {
    expect(computeTargetSize(800, 600, FULL_MAX_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it('lascia intatta un\'immagine esattamente al limite', () => {
    expect(computeTargetSize(1600, 900, FULL_MAX_EDGE)).toEqual({ width: 1600, height: 900 });
  });

  it('mantiene le proporzioni entro un pixel di arrotondamento', () => {
    const source = { width: 4032, height: 3024 };
    const result = computeTargetSize(source.width, source.height, THUMB_MAX_EDGE);

    const sourceRatio = source.width / source.height;
    const resultRatio = result.width / result.height;

    expect(Math.abs(sourceRatio - resultRatio)).toBeLessThan(0.01);
  });

  it('non produce mai un lato a zero, nemmeno su panoramiche estreme', () => {
    // Una panoramica 10000x200 ridotta a 300 darebbe un'altezza di 6 pixel:
    // l'arrotondamento non deve poterla portare a zero, che romperebbe il canvas.
    const result = computeTargetSize(10000, 200, THUMB_MAX_EDGE);

    expect(result.width).toBe(300);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('la miniatura è molto più piccola della versione grande', () => {
    const full = computeTargetSize(4032, 3024, FULL_MAX_EDGE);
    const thumb = computeTargetSize(4032, 3024, THUMB_MAX_EDGE);

    const fullPixels = full.width * full.height;
    const thumbPixels = thumb.width * thumb.height;

    // Un ordine di grandezza almeno. Non serve più a far aprire in fretta il mosaico —
    // quello ora scarica la versione grande — ma a tenere leggeri i cerchietti della
    // pagina master, che sono decine su una schermata sola.
    expect(thumbPixels * 10).toBeLessThan(fullPixels);
  });
});
