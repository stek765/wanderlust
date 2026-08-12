/**
 * I moduli della pagina master: quello che si apre dentro una scheda quando si chiede
 * qualcosa, e resta chiuso il resto del tempo.
 *
 * Sono quattro e hanno tutti la stessa regola: **nascono chiusi**. Cinque campi vuoti
 * sempre aperti sotto ogni viaggio rendevano l'indice illeggibile — e l'indice è una
 * pagina dove comandano le foto, non i comandi.
 *
 * Stanno insieme e separati dall'indice perché sono la sua parte transitoria: l'indice
 * elenca e dispone, questi chiedono e restituiscono. Ognuno riceve cosa fare come
 * funzione e non sa niente di token, chiavi o rete — tranne il selettore di copertina,
 * che le foto se le va a prendere da sé.
 */

import { fetchTrip } from '../lib/api-client';
import { geocode } from '../lib/geocode';
import { decryptToUrl } from './encrypted-thumb';
import { button, field } from './widgets';

/** L'indirizzo del tag appena creato, e il modo per copiarlo. */
export function buildResult() {
  const element = document.createElement('div');
  element.className = 'address';
  element.hidden = true;

  const titolo = document.createElement('p');
  titolo.className = 'address__title';

  const url = document.createElement('code');
  url.className = 'address__url';

  // Senza questo pulsante l'indirizzo va selezionato a mano da un blocco di 120 caratteri
  // senza spazi, su un telefono. È il gesto più importante della pagina.
  const copy = button('Copia indirizzo', 'primary', async () => {
    await navigator.clipboard.writeText(url.textContent ?? '').catch(() => undefined);
    copy.textContent = 'Copiato';
    copy.classList.add('btn--done');
    setTimeout(() => {
      copy.textContent = 'Copia indirizzo';
      copy.classList.remove('btn--done');
    }, 2000);
  });

  element.append(titolo, url, copy);

  return {
    element,
    show(tripName: string, tagUrl: string) {
      element.hidden = false;
      titolo.textContent = `"${tripName}" · scrivi questo indirizzo sul tag NFC`;
      url.textContent = tagUrl;
      copy.textContent = 'Copia';
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  };
}

/** La scheda "nuovo viaggio": una lastra vuota che si apre in un campo. */
export function buildNewTrip(onSubmit: (name: string) => Promise<void>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'newtrip';

  const apri = button('+ Nuovo viaggio', 'ghost', () => {
    form.hidden = false;
    apri.hidden = true;
    name.input.focus();
  });
  apri.classList.add('newtrip__open');

  const form = document.createElement('form');
  form.className = 'newtrip__form';
  form.hidden = true;

  const name = field('Nome del viaggio', 'text', 'Thailandia');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = 'Crea il viaggio';

  const error = document.createElement('p');
  error.className = 'errore';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    if (!name.input.value.trim()) return void (error.textContent = 'Serve un nome.');

    submit.disabled = true;
    try {
      await onSubmit(name.input.value.trim());
      form.reset();
      form.hidden = true;
      apri.hidden = false;
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Creazione fallita.';
    } finally {
      submit.disabled = false;
    }
  });

  form.append(name.wrapper, submit, error);
  wrap.append(apri, form);
  return wrap;
}

/**
 * Il selettore di copertina: tutte le foto del viaggio, e si tocca quella che lo racconta.
 *
 * Le foto arrivano dalla rotta pubblica del viaggio e vengono decifrate qui, come le
 * copertine. Si caricano solo alla prima apertura: un viaggio da duecento foto non deve
 * costare niente finché nessuno chiede di sceglierne una.
 */
export function buildCoverPicker(
  tripSlug: string,
  keyMaterial: string,
  onPick: (photoId: string) => Promise<void>,
) {
  const element = document.createElement('div');
  element.className = 'picker';
  element.hidden = true;

  const title = document.createElement('p');
  title.className = 'picker__title';
  title.textContent = 'Scegli la copertina';

  const rail = document.createElement('div');
  rail.className = 'picker__rail';

  element.append(title, rail);

  let caricato = false;

  const carica = async () => {
    if (caricato) return;
    caricato = true;

    try {
      const trip = await fetchTrip(tripSlug);
      const foto = trip.stops.flatMap((stop) => stop.photos);

      rail.replaceChildren(
        ...foto.map((photo, i) => {
          const scelta = document.createElement('button');
          scelta.type = 'button';
          scelta.className = 'picker__shot';
          scelta.style.setProperty('--ritardo', `${Math.min(i, 12) * 35}ms`);
          scelta.setAttribute('aria-label', `Usa questa foto come copertina`);
          scelta.addEventListener('click', () => void onPick(photo.id));

          void decryptToUrl(photo.thumbKey, keyMaterial).then((url) => {
            if (!url) return;
            scelta.style.backgroundImage = `url("${url}")`;
            scelta.classList.add('picker__shot--loaded');
          });

          return scelta;
        }),
      );

      if (foto.length === 0) {
        const vuoto = document.createElement('p');
        vuoto.className = 'picker__empty';
        vuoto.textContent = 'Nessuna foto in questo viaggio, per ora.';
        rail.replaceChildren(vuoto);
      }
    } catch {
      caricato = false;
      rail.replaceChildren();
    }
  };

  return {
    element,
    close() {
      element.hidden = true;
    },
    async toggle() {
      element.hidden = !element.hidden;
      if (!element.hidden) await carica();
    },
  };
}

/**
 * Il modulo di una tappa: un campo solo.
 *
 * Il nome della tappa e il nome del luogo erano due domande per la stessa cosa, e la
 * prima non serviva a nessuno: una tappa si chiama come il posto dov'è. Ora si cerca il
 * luogo, e da quello arrivano insieme il nome e le coordinate. Se la ricerca non trova
 * niente compaiono i due campi numerici, che restano l'unica via d'uscita.
 */
export function buildStopForm(
  onSubmit: (name: string, lat: number, lon: number) => Promise<void>,
): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'stopform';

  const search = field('Luogo', 'text', 'Cala Gonone');

  const trova = document.createElement('button');
  trova.type = 'button';
  trova.className = 'btn btn--ghost';
  trova.textContent = 'Cerca';

  const esito = document.createElement('p');
  esito.className = 'stopform__found';

  const coord = document.createElement('div');
  coord.className = 'stopform__coord';
  coord.hidden = true;

  const lat = field('Latitudine', 'number', '40.28');
  const lon = field('Longitudine', 'number', '9.62');
  coord.append(lat.wrapper, lon.wrapper);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = 'Aggiungi';

  const error = document.createElement('p');
  error.className = 'errore';

  let trovato: string | null = null;

  trova.addEventListener('click', async () => {
    error.textContent = '';
    trova.disabled = true;
    trova.textContent = 'Cerco…';

    try {
      const found = await geocode(search.input.value);
      if (found) {
        trovato = found.nome;
        lat.input.value = String(found.lat);
        lon.input.value = String(found.lon);
        esito.textContent = found.etichetta;
        coord.hidden = true;
      } else {
        trovato = null;
        esito.textContent = 'Non l\'ho trovato: scrivi le coordinate a mano.';
        coord.hidden = false;
      }
    } finally {
      trova.disabled = false;
      trova.textContent = 'Cerca';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const nome = (trovato ?? search.input.value).trim();
    const latitude = Number(lat.input.value);
    const longitude = Number(lon.input.value);

    if (!nome) return void (error.textContent = 'Serve un luogo.');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      coord.hidden = false;
      return void (error.textContent = 'Cerca il luogo, o scrivi le coordinate.');
    }

    submit.disabled = true;
    try {
      await onSubmit(nome, latitude, longitude);
      form.reset();
      form.hidden = true;
      esito.textContent = '';
      trovato = null;
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Creazione fallita.';
    } finally {
      submit.disabled = false;
    }
  });

  const riga = document.createElement('div');
  riga.className = 'stopform__row';
  riga.append(search.wrapper, trova);

  form.append(riga, esito, coord, submit, error);
  return form;
}
