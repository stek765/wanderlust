/**
 * L'indice dei viaggi, e il posto da cui nascono.
 *
 * Fa tre cose, e la terza è la più importante:
 *   1. elenca i viaggi con le loro copertine, e ci fa entrare
 *   2. crea viaggi e tappe, generando la chiave di cifratura QUI, nel browser
 *   3. ricorda chiavi e token, e insiste perché vengano esportati
 *
 * La chiave non viene mai inviata al server. Il server non sa nemmeno che esiste — e per
 * questo un viaggio creato su un altro browser si può elencare ma non ampliare: senza la
 * sua chiave, l'URL di una tappa nuova non si potrebbe nemmeno scrivere.
 *
 * Regola di composizione, imparata rifacendo questa pagina quattro volte: **comandano le
 * foto**. Niente riquadri con bordi, niente moduli aperti, niente pulsanti colorati che
 * gridano — lo spazio e le immagini fanno la gerarchia, i comandi stanno in disparte
 * finché non servono. Ogni volta che qui è ricomparsa una cornice, la pagina è tornata
 * illeggibile.
 *
 * Questa pagina è CHIARA, ed è l'unica del sito. Il resto è scuro perché lì comandano le
 * foto sullo schermo; qui si amministra, si legge e si copia un indirizzo, e su fondo
 * chiaro si fa tutto meglio. Dietro, sfocata, c'è la copertina del viaggio più recente:
 * l'unica immagine di sfondo del progetto.
 *
 * Qui dentro sta solo l'indice: elencare, disporre, e tenere il conto delle chiavi. I
 * moduli che si aprono dentro le schede stanno in `master-forms`, le miniature cifrate in
 * `encrypted-thumb`, pulsanti e campi in `widgets`.
 */

import type { TripSummaryDto } from '../../shared/api-types';
import {
  createStop,
  createTrip,
  deleteStop,
  deleteTrip,
  fetchTrips,
  setTripCover,
} from '../lib/api-client';
import { exportKey, generateKey } from '../lib/crypto';
import { addToKeychain, exportKeychain, loadKeychain, needsExport, type KeychainEntry } from '../lib/keychain';
import { buildTagUrl } from '../lib/session';
import { paintCover, paintThumb } from './encrypted-thumb';
import { buildCoverPicker, buildNewTrip, buildResult, buildStopForm } from './master-forms';
import { button } from './widgets';

const LAST_EXPORT_KEY = 'ricordi:keychain:exported-at';

export function buildMenuPanel(masterToken: string): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';

  // Lo sfondo: la copertina del primo viaggio, ingrandita e sfocata. Non è decorazione a
  // caso — è la stessa foto che si vede nella prima scheda, quindi la pagina sa di cosa
  // sta parlando prima ancora di leggerla.
  const backdrop = document.createElement('div');
  backdrop.className = 'panel__backdrop';

  const title = document.createElement('h1');
  title.textContent = 'Viaggi';

  const count = document.createElement('p');
  count.className = 'panel__count';

  const head = document.createElement('header');
  head.className = 'panel__head';
  head.append(title, count);

  // L'avviso sulle chiavi è una riga, non un riquadro: conta, ma non è il contenuto.
  const keys = document.createElement('p');
  keys.className = 'panel__keys';

  const exportButton = button('Esporta', 'ghost', () => {
    downloadKeychain(loadKeychain(localStorage));
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
    refreshKeys();
  });
  exportButton.classList.add('btn--tiny');

  const list = document.createElement('ul');
  list.className = 'panel__trips';

  const result = buildResult();
  const nuovo = document.createElement('li');
  nuovo.className = 'panel__new';

  const refreshKeys = () => {
    const entries = loadKeychain(localStorage);
    const lastExport = Number(localStorage.getItem(LAST_EXPORT_KEY)) || null;
    const pending = needsExport(entries, lastExport);

    keys.replaceChildren(
      document.createTextNode(
        pending
          ? 'Ci sono chiavi non ancora esportate. Se perdi questo browser, quelle foto non si riaprono più. '
          : entries.length > 0
            ? 'Chiavi al sicuro. '
            : 'Nessuna chiave ancora. ',
      ),
      exportButton,
    );
    keys.classList.toggle('panel__keys--urgent', pending);
  };

  const refreshList = async () => {
    const trips = await fetchTrips(masterToken).catch(() => [] as TripSummaryDto[]);
    const keychain = loadKeychain(localStorage);

    const tappe = trips.reduce((n, t) => n + t.stops.length, 0);
    const foto = trips.reduce((n, t) => n + t.stops.reduce((m, s) => m + s.photoCount, 0), 0);
    count.textContent = trips.length
      ? `${plurale(trips.length, 'viaggio', 'viaggi')} · ${plurale(tappe, 'tappa', 'tappe')} · ${plurale(foto, 'foto', 'foto')}`
      : 'Ancora niente';

    const setBackdrop = (url: string) => {
      backdrop.style.backgroundImage = `url("${url}")`;
      backdrop.classList.add('panel__backdrop--loaded');
    };

    list.replaceChildren(
      ...trips.map((trip, i) =>
        tripCard(trip, keychain, masterToken, refreshAll, result.show, i, i === 0 ? setBackdrop : null),
      ),
      nuovo,
    );
  };

  const refreshAll = async () => {
    refreshKeys();
    await refreshList();
  };

  nuovo.append(
    buildNewTrip(async (name) => {
      // La chiave nasce e resta nel browser. Il server riceve solo il nome.
      const key = await generateKey();
      const keyMaterial = await exportKey(key);
      const { slug, writeToken } = await createTrip(masterToken, { name });

      addToKeychain(localStorage, { slug, name, key: keyMaterial, writeToken, createdAt: Date.now() });
      // L'indirizzo da scrivere sul tag appartiene al viaggio: nasce qui, una volta sola.
      result.show(name, buildTagUrl(location.origin, slug, writeToken, keyMaterial));
      await refreshAll();
    }),
  );

  panel.append(backdrop, head, keys, result.element, list);
  void refreshAll();

  return panel;
}

function tripCard(
  trip: TripSummaryDto,
  keychain: KeychainEntry[],
  masterToken: string,
  refresh: () => Promise<void>,
  showUrl: (tripName: string, tagUrl: string) => void,
  index: number,
  setBackdrop: ((url: string) => void) | null,
): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'trip';
  row.dataset.slug = trip.slug;
  // Le schede entrano una dopo l'altra invece che tutte insieme: è la differenza fra una
  // pagina che compare e una che si apre.
  row.style.setProperty('--ritardo', `${Math.min(index, 6) * 70}ms`);

  const secret = keychain.find((entry) => entry.slug === trip.slug);

  const cover = document.createElement('div');
  cover.className = 'trip__cover';
  if (secret && trip.coverThumbKey) {
    void paintCover(row, cover, trip.coverThumbKey, secret.key, setBackdrop);
  }

  const name = document.createElement('span');
  name.className = 'trip__name';
  name.textContent = trip.name;

  const conteggio = document.createElement('span');
  conteggio.className = 'trip__count';
  conteggio.textContent = plurale(
    trip.stops.reduce((n, s) => n + s.photoCount, 0),
    'foto',
    'foto',
  );

  const label = document.createElement('div');
  label.className = 'trip__label';
  label.append(name, conteggio);
  cover.append(label);

  if (secret) {
    // Tutta la copertina è la porta d'ingresso: è la cosa più grande della scheda, ed è
    // quello che si ha voglia di toccare.
    const apri = document.createElement('a');
    apri.className = 'trip__open';
    apri.href = buildTagUrl('', trip.slug, secret.writeToken, secret.key);
    apri.setAttribute('aria-label', `Apri ${trip.name}`);
    cover.append(apri);
  }

  // Le tappe come anteprime: una miniatura, il nome sotto, e una crocetta per toglierla.
  const stops = document.createElement('ul');
  stops.className = 'stops';
  stops.replaceChildren(
    ...trip.stops.map((stop, indice) => {
      const item = document.createElement('li');
      item.className = 'stopchip';

      const thumb = document.createElement('span');
      thumb.className = 'stopchip__thumb';
      if (secret && stop.coverThumbKey) void paintThumb(thumb, stop.coverThumbKey, secret.key);

      const testo = document.createElement('span');
      testo.className = 'stopchip__name';
      testo.textContent = stop.name;

      item.append(thumb, testo);

      if (secret) {
        const via = document.createElement('button');
        via.type = 'button';
        via.className = 'stopchip__remove';
        via.setAttribute('aria-label', `Elimina ${stop.name}`);
        via.textContent = '×';
        via.addEventListener('click', async () => {
          if (!confirm(`Eliminare "${stop.name}" e le sue ${stop.photoCount} foto?`)) return;
          await deleteStop(masterToken, stop.slug);
          await refresh();
        });
        item.append(via);
      }

      item.style.setProperty('--ritardo', `${indice * 40}ms`);

      return item;
    }),
  );

  row.append(cover, stops);

  if (secret) {
    const form = buildStopForm(async (nome, lat, lon) => {
      // Una tappa nuova non produce nessun magnete: il magnete è del viaggio.
      await createStop(masterToken, trip.slug, { name: nome, lat, lon });
      await refresh();
    });
    form.hidden = true;

    const picker = buildCoverPicker(trip.slug, secret.key, async (photoId) => {
      await setTripCover(masterToken, trip.slug, photoId);
      await refresh();
    });

    const add = button('+ Tappa', 'ghost', () => {
      picker.close();
      form.hidden = !form.hidden;
      add.textContent = form.hidden ? '+ Tappa' : 'Annulla';
      if (!form.hidden) form.querySelector('input')?.focus();
    });

    const cover2 = button('Copertina', 'ghost', () => {
      form.hidden = true;
      add.textContent = '+ Tappa';
      void picker.toggle();
    });

    const tag = button('Indirizzo del tag', 'ghost', () =>
      showUrl(trip.name, buildTagUrl(location.origin, trip.slug, secret.writeToken, secret.key)),
    );

    const remove = button('Elimina', 'danger', async () => {
      // Qui il dialogo di sistema va bene: è l'unica azione del sito che distrugge foto
      // senza possibilità di tornare indietro.
      if (!confirm(`Eliminare "${trip.name}" con tutte le sue foto? Non si torna indietro.`)) return;
      await deleteTrip(masterToken, trip.slug);
      await refresh();
    });

    const azioni = document.createElement('div');
    azioni.className = 'trip__actions';
    azioni.append(add, cover2, tag, remove);

    row.append(azioni, picker.element, form);
  } else {
    const missing = document.createElement('p');
    missing.className = 'trip__missing';
    missing.textContent = 'Le chiavi non sono su questo browser: si guarda, non si aggiunge.';
    row.append(missing);
  }

  return row;
}

function downloadKeychain(entries: KeychainEntry[]): void {
  const url = URL.createObjectURL(exportKeychain(entries));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ricordi-chiavi-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function plurale(n: number, uno: string, molti: string): string {
  return `${n} ${n === 1 ? uno : molti}`;
}
