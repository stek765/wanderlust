/**
 * Il colore di una tappa, preso dalle sue stesse foto.
 *
 * È il modo per riempire la pagina di colore senza inventarne nessuno: il mare di
 * Sardegna tinge di ciano, un tramonto di arancio, un bosco di verde. Nessuna palette da
 * scegliere, nessuna decisione arbitraria — il colore ce l'hanno già le foto.
 *
 * Due passaggi, e solo il secondo è sbagliabile. Il primo legge un pixel; il secondo
 * decide quanto di quel colore far vedere, ed è quello che separa "la pagina ha un'anima"
 * da "la pagina è sporca".
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Il colore medio di un'immagine, ridotta a un pixel solo.
 *
 * Un pixel e non un istogramma: la media è più stabile del colore "più frequente", che su
 * una foto di mare restituisce il grigio del cielo invece del turchese dell'acqua. E
 * costa un disegno su canvas invece di un giro su ogni pixel.
 *
 * Restituisce null e non lancia: una tappa senza colore mostra il fondo normale, che va
 * benissimo. Questa è decorazione, non contenuto.
 */
export async function averageColor(url: string): Promise<Rgb | null> {
  try {
    const response = await fetch(url);
    const bitmap = await createImageBitmap(await response.blob());

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(bitmap, 0, 0, 1, 1);
    bitmap.close();

    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  } catch {
    return null;
  }
}

/**
 * La tinta di fondo: lo stesso colore, ma appena accennato.
 *
 * Il colore medio di una foto è quasi sempre slavato — un grigio con una punta di
 * qualcosa. Usato tale e quale sporca lo sfondo senza dire niente. Qui viene prima
 * saturato (si tiene solo la direzione del colore, non la sua stanchezza) e poi tenuto
 * bassissimo in opacità: si deve percepire senza potersi nominare.
 */
export function toTint(color: Rgb, alpha = 0.16): string {
  const { r, g, b } = saturate(color);
  return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)`;
}

/** Lo stesso colore portato a piena luce, per una riga o un bordo su fondo scuro. */
export function toGlow(color: Rgb): string {
  const { r, g, b } = lighten(saturate(color));
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Spinge il colore lontano dal grigio senza cambiarne la tinta.
 *
 * Il canale più alto resta dov'è, il più basso viene abbassato: la distanza fra i canali
 * è la saturazione, e allargarla è quello che trasforma un beige triste nell'arancio che
 * c'era davvero nella foto.
 */
function saturate({ r, g, b }: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  // Immagine grigia sul serio (bianco e nero, notte): non c'è nessuna tinta da tirare
  // fuori, e forzarla inventerebbe un colore che nella foto non c'è.
  if (max - min < 8) return { r: max, g: max, b: max };

  const spinta = (v: number) => clamp(Math.round(min + (v - min) * 2.2));
  return { r: spinta(r), g: spinta(g), b: spinta(b) };
}

/** Alza tutti i canali mantenendo i rapporti: serve su fondo nero, dove i colori scuri
    non si vedono affatto. */
function lighten({ r, g, b }: Rgb): Rgb {
  const max = Math.max(r, g, b, 1);
  const fattore = Math.min(255 / max, 2.4);
  return { r: clamp(r * fattore), g: clamp(g * fattore), b: clamp(b * fattore) };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
