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
  setStopOrder,
  setTripCover,
} from '../lib/api-client';
import { exportKey, generateKey } from '../lib/crypto';
import {
  addToKeychain,
  exportKeychain,
  importKeychain,
  loadKeychain,
  needsExport,
  type KeychainEntry,
} from '../lib/keychain';
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

  /*
   * L'altra metà dell'esportazione.
   *
   * Il portachiavi vive nel localStorage di un browser solo: un viaggio creato dal telefono
   * sul computer resta illeggibile finché la sua chiave non arriva qui. Senza questo
   * pulsante il file esportato non si poteva ricaricare da nessuna parte.
   */
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;
  importInput.addEventListener('change', () => void importaFile());

  const importButton = button('Importa', 'ghost', () => importInput.click());
  importButton.classList.add('btn--tiny');

  const esitoImport = document.createElement('span');
  esitoImport.className = 'panel__import-esito';

  const importaFile = async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;

    try {
      const esito = importKeychain(localStorage, await file.text());
      const pezzi: string[] = [];
      if (esito.aggiunte > 0) pezzi.push(`${plurale(esito.aggiunte, 'chiave aggiunta', 'chiavi aggiunte')}`);
      if (esito.giaPresenti > 0) pezzi.push(`${esito.giaPresenti} già presenti`);
      if (esito.conflitti.length > 0) {
        // Un conflitto non è un dettaglio: significa che una delle due chiavi non apre
        // quelle foto, e non tocca a noi indovinare quale.
        pezzi.push(`⚠ chiave diversa per ${esito.conflitti.join(', ')}: non sovrascritta`);
      }
      esitoImport.textContent = pezzi.join(' · ');
      await refreshAll();
    } catch (cause) {
      esitoImport.textContent = cause instanceof Error ? cause.message : 'Importazione fallita.';
    }
  };

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
      importButton,
      importInput,
      esitoImport,
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
  if (secret && trip.coverKey) {
    // La versione grande, non la miniatura: questa scheda è la cosa più grossa della
    // pagina, e con i 300px della miniatura si vedevano i pixel. Lo stesso URL serve
    // anche allo sfondo sfocato, che è a schermo intero.
    void paintCover(row, cover, trip.coverKey, secret.key, setBackdrop);
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
      item.dataset.slug = stop.slug;

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
    attachRiordino(stops, async (slugs) => {
      await setStopOrder(masterToken, trip.slug, slugs);
      await refresh();
    });
  }

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

    /*
     * Il modo di entrare in modifica: un pulsante, non una pressione lunga.
     *
     * La pressione lunga era un gesto che nessuno scopre da solo e che si scontrava con
     * tutto — selettore di testo, menu contestuale, scorrimento — al punto che in questo
     * elenco era più facile entrarci per sbaglio che di proposito. Qui si vede, dice cosa
     * fa, e si esce dallo stesso punto da cui si è entrati.
     */
    const modifica = button('Modifica', 'ghost', () => {
      const attiva = stops.classList.toggle('stops--modifica');
      modifica.textContent = attiva ? 'Fatto' : 'Modifica';
      modifica.classList.toggle('btn--done', attiva);
    });

    const remove = button('Elimina', 'danger', async () => {
      // Qui il dialogo di sistema va bene: è l'unica azione del sito che distrugge foto
      // senza possibilità di tornare indietro.
      if (!confirm(`Eliminare "${trip.name}" con tutte le sue foto? Non si torna indietro.`)) return;
      await deleteTrip(masterToken, trip.slug);
      await refresh();
    });

    const azioni = document.createElement('div');
    azioni.className = 'trip__actions';
    azioni.append(add, cover2, tag, modifica, remove);

    row.append(azioni, picker.element, form);
  } else {
    /*
     * Il messaggio dice cosa fare, non solo cosa manca.
     *
     * Prima era "Le chiavi non sono su questo browser: si guarda, non si aggiunge" — vero,
     * e inutile: chi lo leggeva restava senza sapere come uscirne, e nemmeno se se ne
     * potesse uscire. Il fatto che si risolva con un file esportato dall'altro dispositivo
     * non è deducibile da nessuna parte della pagina.
     */
    const missing = document.createElement('p');
    missing.className = 'trip__missing';
    missing.textContent =
      'Questo viaggio è nato su un altro dispositivo, e la sua chiave è rimasta lì: senza, le sue foto non si aprono. ' +
      'Esporta il portachiavi da quel dispositivo e caricalo qui con "Importa", in cima alla pagina.';
    row.append(missing);
  }

  return row;
}

/**
 * La modalità modifica delle tappe: si entra da un pulsante, non tenendo premuto.
 *
 * La pressione lunga è stata tolta di proposito. Su un telefono è un gesto che nessuno
 * scopre da solo e che si scontra con tutto il resto — il selettore di testo, il menu
 * contestuale, lo scorrimento della pagina — e in questo elenco era più facile entrarci
 * per sbaglio che di proposito. Un pulsante che dice "Modifica" non ha nessuno di questi
 * problemi e si vede.
 *
 * Cosa si fa in modifica: si eliminano le tappe, e si trascinano per riordinarle. Il
 * riordino serve perché l'ordine automatico è la data della foto più vecchia, e le tappe
 * **senza foto non hanno una data** — finiscono in fondo per ordine di creazione, che
 * quasi mai è il posto giusto. È la via d'uscita per quel caso.
 *
 * ⚠️ Il riordino riguarda **tutte** le tappe del viaggio insieme: spostarne una scrive una
 * posizione a ognuna. Mescolare tappe messe a mano e tappe ordinate per data darebbe un
 * ordine che nessuno saprebbe più spiegare guardandolo.
 */
function attachRiordino(lista: HTMLElement, onOrdine: (slugs: string[]) => Promise<void>): void {
  let trascinata: HTMLElement | null = null;
  let partenzaY = 0;
  let scostamento = 0;

  const inModifica = () => lista.classList.contains('stops--modifica');

  lista.addEventListener('pointerdown', (event) => {
    const chip = (event.target as HTMLElement).closest('.stopchip') as HTMLElement | null;
    if (!chip || !inModifica()) return;
    // La crocetta è dentro la scheda: prenderla per trascinare significa non poterla premere.
    if ((event.target as HTMLElement).closest('.stopchip__remove')) return;

    partenzaY = event.clientY;
    scostamento = 0;
    trascinata = chip;
    chip.classList.add('stopchip--presa');
    chip.setPointerCapture(event.pointerId);
  });

  lista.addEventListener('pointermove', (event) => {
    if (!trascinata) return;
    event.preventDefault();

    scostamento = event.clientY - partenzaY;
    trascinata.style.transform = `translateY(${scostamento}px) scale(1.04)`;

    /*
     * Si scambia con la tappa sotto il dito, non si calcola una posizione.
     *
     * `elementFromPoint` dice esattamente cosa c'è sotto, comprese le righe successive di
     * un elenco che va a capo: con una matematica sulle coordinate si sbaglia appena
     * l'elenco smette di essere una colonna sola.
     */
    trascinata.style.pointerEvents = 'none';
    const sotto = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest(
      '.stopchip',
    ) as HTMLElement | null;
    trascinata.style.pointerEvents = '';

    if (!sotto || sotto === trascinata || !lista.contains(sotto)) return;

    const dopo = sotto.compareDocumentPosition(trascinata) & Node.DOCUMENT_POSITION_PRECEDING;
    lista.insertBefore(trascinata, dopo ? sotto.nextSibling : sotto);

    // La posizione di partenza è cambiata insieme al DOM: si riparte da qui, o al prossimo
    // movimento la tappa schizzerebbe via del doppio.
    partenzaY = event.clientY;
    trascinata.style.transform = 'scale(1.04)';
  });

  const molla = () => {
    if (!trascinata) return;

    trascinata.classList.remove('stopchip--presa');
    trascinata.style.transform = '';
    trascinata = null;

    const slugs = [...lista.querySelectorAll<HTMLElement>('.stopchip')]
      .map((chip) => chip.dataset.slug)
      .filter((slug): slug is string => Boolean(slug));

    void onOrdine(slugs);
  };

  lista.addEventListener('pointerup', molla);
  lista.addEventListener('pointercancel', molla);
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
