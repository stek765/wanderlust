/**
 * Il viaggio inventato della dimostrazione.
 *
 * Sta in un file suo perché lo leggono in due: `demo.mjs`, che lo costruisce e lo
 * riprende, e `foto-vere.mjs`, che scarica le foto delle sue tappe. Tenuto dentro uno dei
 * due, l'altro dovrebbe importare uno script che parte da solo.
 *
 * ⭐ **Le tappe sono a poche centinaia di chilometri l'una dall'altra, ed è una scelta.**
 * Sopra i 60 km la mappa vola invece di scorrere, quindi il movimento c'è; ma è alle
 * distanze corte che, mentre la camera si allarga a metà strada, **la rotta e i due spilli
 * stanno insieme nell'inquadratura** — che è la cosa da far vedere. Una versione
 * precedente girava il mondo con tratte da diciottomila chilometri: là la camera saliva
 * così in alto che per mezzo secondo si vedeva solo un campo grigio senza niente dentro.
 *
 * Le date decidono l'ordine delle tappe — è la data della foto più vecchia di ciascuna —
 * quindi l'ordine di questo elenco e l'ordine delle date devono coincidere, o la
 * dimostrazione mostra un viaggio al contrario.
 *
 * `cerca` sono le chiavi con cui si cercano le foto del posto: tre per tappa, perché una
 * sola dà sei varianti della stessa inquadratura e in una griglia si nota subito. Le prime
 * due sono precise, la terza è il nome nudo del posto e fa da riserva: su Openverse una
 * ricerca di tre parole può tornare con dieci risultati in tutto, e dopo i filtri restarne
 * uno — è già successo con Hakone.
 */

export const VIAGGIO = 'Giappone 2027';

export const TAPPE = [
  {
    posto: 'tokyo',
    nome: 'Tokyo',
    lat: '35.6762',
    lon: '139.6503',
    giorno: '2027-04-03',
    cerca: ['Shibuya crossing', 'Sensoji', 'Tokyo'],
  },
  {
    posto: 'hakone',
    nome: 'Hakone',
    lat: '35.2324',
    lon: '139.1069',
    giorno: '2027-04-07',
    cerca: ['Lake Ashi Hakone', 'Hakone', 'Mount Fuji'],
  },
  {
    posto: 'kyoto',
    nome: 'Kyoto',
    lat: '35.0116',
    lon: '135.7681',
    giorno: '2027-04-11',
    cerca: ['Fushimi Inari', 'Arashiyama bamboo', 'Kyoto'],
  },
  {
    posto: 'kanazawa',
    nome: 'Kanazawa',
    lat: '36.5613',
    lon: '136.6562',
    giorno: '2027-04-15',
    cerca: ['Kenrokuen garden', 'Kanazawa castle', 'Kanazawa'],
  },
  {
    posto: 'hiroshima',
    nome: 'Hiroshima',
    lat: '34.3853',
    lon: '132.4553',
    giorno: '2027-04-19',
    cerca: ['Itsukushima torii', 'Miyajima', 'Hiroshima'],
  },
];

export const FOTO_PER_TAPPA = 6;
