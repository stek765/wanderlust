import { describe, expect, it } from 'vitest';
import { looksLikeHeic } from '../../src/lib/media';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('riconoscimento HEIC', () => {
  it('riconosce il tipo dichiarato dal browser', () => {
    expect(looksLikeHeic(file('IMG_0001.HEIC', 'image/heic'))).toBe(true);
    expect(looksLikeHeic(file('IMG_0001.heif', 'image/heif'))).toBe(true);
  });

  it('riconosce dall\'estensione quando il browser non dichiara il tipo', () => {
    // Caso reale e frequente: su .heic parecchi browser riportano tipo vuoto.
    expect(looksLikeHeic(file('IMG_0002.HEIC', ''))).toBe(true);
    expect(looksLikeHeic(file('vacanza.heif', ''))).toBe(true);
  });

  it('lascia in pace i formati che il browser sa già leggere', () => {
    expect(looksLikeHeic(file('foto.jpg', 'image/jpeg'))).toBe(false);
    expect(looksLikeHeic(file('foto.png', 'image/png'))).toBe(false);
    expect(looksLikeHeic(file('foto.webp', 'image/webp'))).toBe(false);
  });

  it('non si fa ingannare da un nome che contiene "heic"', () => {
    // Una foto scattata a Heicheng non è un HEIC.
    expect(looksLikeHeic(file('heicheng-2024.jpg', 'image/jpeg'))).toBe(false);
  });

  it('senza tipo e senza estensione utile non tenta la conversione', () => {
    expect(looksLikeHeic(file('senza-estensione', ''))).toBe(false);
  });
});
