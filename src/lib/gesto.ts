/**
 * Come finisce un gesto quando il dito si stacca.
 *
 * È il pezzo che mancava a tutti gli scorrimenti di questo sito, e si sentiva. Il dito non
 * accompagna mai il movimento fino in fondo: trascina un po' e a un certo punto molla,
 * spesso con una spinta. Trattare quel rilascio come "sei arrivato fin qui, adesso ci
 * penso io per 300 millisecondi" produce esattamente la sensazione che l'ha fatta bocciare
 * — un movimento che si stacca dalla mano e diventa un'animazione.
 *
 * Le due cose che servono, e che qui stanno insieme:
 *
 *   1. **una spinta vale una distanza.** Un colpetto veloce e corto è una richiesta tanto
 *      quanto un trascinamento lento e lungo. Guardare solo quanto si è arrivati lontano
 *      significa ignorare metà di quello che la mano ha detto.
 *   2. **la durata la detta la velocità.** Se il dito viaggiava a un pixel al millisecondo
 *      e mancano cento pixel, l'animazione deve durare cento millisecondi: continua il
 *      movimento invece di ricominciarne uno suo.
 */

/**
 * Misura la velocità di un dito, in pixel al millisecondo.
 *
 * Media pesata e non ultima lettura: i telefoni consegnano gli eventi a raffica e con
 * intervalli irregolari, e una singola coppia di campioni dà numeri che ballano di un
 * fattore dieci. Con una media il valore resta credibile senza inseguire il rumore.
 */
export class Velocita {
  private ultimo = 0;
  private quando = 0;
  private media = 0;

  inizia(posizione: number, tempo: number): void {
    this.ultimo = posizione;
    this.quando = tempo;
    this.media = 0;
  }

  aggiorna(posizione: number, tempo: number): void {
    const dt = tempo - this.quando;
    // Sotto il millisecondo il rapporto esplode: quel campione non dice niente di utile.
    if (dt <= 0) return;

    const istante = (posizione - this.ultimo) / dt;
    this.media = this.media * 0.7 + istante * 0.3;
    this.ultimo = posizione;
    this.quando = tempo;
  }

  /** Pixel al millisecondo. Positiva se il dito andava verso valori crescenti. */
  get valore(): number {
    return this.media;
  }
}

/** Oltre questa spinta il gesto è una richiesta, quale che sia la distanza percorsa. */
const SPINTA = 0.35;

export interface Conclusione {
  /** -1 indietro, 0 torna dov'era, 1 avanti. */
  verso: -1 | 0 | 1;
  /** Quanto deve durare l'animazione che chiude il gesto, in millisecondi. */
  durata: number;
}

/**
 * Decide come finisce un gesto orizzontale o verticale a una via.
 *
 * `distanza` è di quanto ci si è spostati, `restante` quanto manca per arrivare a
 * destinazione se si conferma: da quest'ultima e dalla velocità esce la durata.
 */
export function concludi(distanza: number, velocita: number, misura: number, restante: number): Conclusione {
  const spinta = Math.abs(velocita) >= SPINTA;
  // Un quarto della misura di riferimento: sotto, senza spinta, è un ripensamento.
  const abbastanzaLontano = Math.abs(distanza) > misura * 0.25;

  // La spinta comanda sulla distanza: si può tirare indietro e mollare in avanti, e il
  // verso giusto è quello dell'ultimo movimento della mano, non quello del bilancio.
  const verso = spinta ? (velocita < 0 ? 1 : -1) : abbastanzaLontano ? (distanza < 0 ? 1 : -1) : 0;

  return { verso: verso as -1 | 0 | 1, durata: durata(restante, velocita) };
}

/**
 * Il tempo che serve a coprire lo spazio rimasto alla velocità che aveva il dito.
 *
 * Con estremi: sotto i 200 ms il movimento è così rapido da leggersi come uno scatto,
 * sopra i 560 ms si perde il legame con il gesto e diventa un'animazione qualunque.
 */
export function durata(restante: number, velocita: number): number {
  const v = Math.abs(velocita);
  if (v < 0.05) return 420;
  // Gli estremi sono generosi di proposito: con un tetto a 420 ms anche i gesti lenti
  // finivano di corsa, e lo scorrimento fra le foto risultava frettoloso pur seguendo il
  // dito. Sotto i 200 ms l'occhio non fa in tempo a leggere il movimento.
  return Math.min(560, Math.max(200, Math.abs(restante) / v));
}
