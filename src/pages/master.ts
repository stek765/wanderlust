/**
 * La pagina da cui nascono i posti. Un solo indirizzo segreto, da tenere in 1Password.
 *
 * Fa tre cose, e la terza è la più importante:
 *   1. crea il posto (nome + coordinate)
 *   2. genera la chiave di cifratura QUI, nel browser, e la mette solo nell'URL del tag
 *   3. ricorda chiavi e token, e insiste perché vengano esportati
 *
 * La chiave non viene mai inviata al server. Il server non sa nemmeno che esiste.
 */

import { createPlace } from '../lib/api-client';
import { exportKey, generateKey } from '../lib/crypto';
import { addToKeychain, exportKeychain, loadKeychain, needsExport, type KeychainEntry } from '../lib/keychain';
import { buildTagUrl } from '../lib/session';

const LAST_EXPORT_KEY = 'ricordi:keychain:exported-at';

export function renderMasterPage(root: HTMLElement, masterToken: string): void {
  root.replaceChildren();

  const page = document.createElement('div');
  page.className = 'master';

  const title = document.createElement('h1');
  title.textContent = 'Posti';

  const warning = document.createElement('p');
  warning.className = 'master__warning';

  const form = buildForm(async (name, lat, lon) => {
    const result = await createOne(masterToken, name, lat, lon);
    renderResult(page, result);
    refresh();
    return result;
  });

  const list = document.createElement('ul');
  list.className = 'master__list';

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'master__export';
  exportButton.textContent = 'Esporta le chiavi';
  exportButton.addEventListener('click', () => {
    downloadKeychain(loadKeychain(localStorage));
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
    refresh();
  });

  const refresh = () => {
    const entries = loadKeychain(localStorage);
    const lastExport = Number(localStorage.getItem(LAST_EXPORT_KEY)) || null;

    list.replaceChildren(...entries.map(entryRow));

    const pending = needsExport(entries, lastExport);
    warning.textContent = pending
      ? 'Ci sono chiavi non ancora esportate. Se questo telefono si perde, quelle foto non si riaprono più.'
      : entries.length > 0
        ? 'Tutte le chiavi sono state esportate almeno una volta.'
        : '';
    warning.classList.toggle('master__warning--urgent', pending);
  };

  page.append(title, warning, form, exportButton, list);
  root.append(page);
  refresh();
}

interface CreatedPlace extends KeychainEntry {
  tagUrl: string;
}

async function createOne(masterToken: string, name: string, lat: number, lon: number): Promise<CreatedPlace> {
  // La chiave nasce e resta nel browser. Il server riceve solo nome e coordinate.
  const key = await generateKey();
  const keyMaterial = await exportKey(key);

  const { slug, writeToken } = await createPlace(masterToken, { name, lat, lon });

  const entry: KeychainEntry = { slug, name, key: keyMaterial, writeToken, createdAt: Date.now() };
  addToKeychain(localStorage, entry);

  return { ...entry, tagUrl: buildTagUrl(location.origin, slug, writeToken, keyMaterial) };
}

function buildForm(onSubmit: (name: string, lat: number, lon: number) => Promise<unknown>): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'master__form';

  const name = field('Nome del posto', 'text', 'Bangkok');
  const search = field('Cerca la città', 'text', 'Bangkok, Thailandia');
  const lat = field('Latitudine', 'number', '13.7563');
  const lon = field('Longitudine', 'number', '100.5018');

  const findButton = document.createElement('button');
  findButton.type = 'button';
  findButton.textContent = 'Trova coordinate';
  findButton.className = 'master__find';
  findButton.addEventListener('click', async () => {
    findButton.disabled = true;
    findButton.textContent = 'Cerco…';
    try {
      const found = await geocode(search.input.value);
      if (found) {
        lat.input.value = String(found.lat);
        lon.input.value = String(found.lon);
        if (!name.input.value) name.input.value = search.input.value.split(',')[0] ?? '';
      } else {
        findButton.textContent = 'Non trovata — metti le coordinate a mano';
        return;
      }
    } finally {
      findButton.disabled = false;
      if (findButton.textContent === 'Cerco…') findButton.textContent = 'Trova coordinate';
    }
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'master__create';
  submit.textContent = 'Crea il posto';

  const error = document.createElement('p');
  error.className = 'master__error';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const latitude = Number(lat.input.value);
    const longitude = Number(lon.input.value);

    if (!name.input.value.trim()) return void (error.textContent = 'Serve un nome.');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return void (error.textContent = 'Coordinate mancanti: cerca la città o scrivile a mano.');
    }

    submit.disabled = true;
    try {
      await onSubmit(name.input.value.trim(), latitude, longitude);
      form.reset();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Creazione fallita.';
    } finally {
      submit.disabled = false;
    }
  });

  form.append(name.wrapper, search.wrapper, findButton, lat.wrapper, lon.wrapper, submit, error);
  return form;
}

/**
 * Coordinate da nome, con Nominatim di OpenStreetMap: gratuito e senza chiave.
 * Se non risponde non è un dramma — le coordinate si possono sempre scrivere a mano.
 */
async function geocode(query: string): Promise<{ lat: number; lon: number } | null> {
  if (!query.trim()) return null;

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;

    const results = (await response.json()) as Array<{ lat: string; lon: string }>;
    const first = results[0];
    return first ? { lat: Number(first.lat), lon: Number(first.lon) } : null;
  } catch {
    return null;
  }
}

function renderResult(page: HTMLElement, place: CreatedPlace): void {
  const box = document.createElement('div');
  box.className = 'master__result';

  const heading = document.createElement('h2');
  heading.textContent = `"${place.name}" creato`;

  const instructions = document.createElement('p');
  instructions.textContent = 'Scrivi questo indirizzo sul tag NFC con NFC Tools. Poi esporta le chiavi.';

  const url = document.createElement('code');
  url.className = 'master__url';
  url.textContent = place.tagUrl;

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copia indirizzo';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(place.tagUrl).catch(() => undefined);
    copy.textContent = 'Copiato';
    setTimeout(() => (copy.textContent = 'Copia indirizzo'), 2000);
  });

  box.append(heading, instructions, url, copy);
  page.querySelector('.master__result')?.remove();
  page.querySelector('.master__form')?.after(box);
}

function entryRow(entry: KeychainEntry): HTMLLIElement {
  const row = document.createElement('li');
  const link = document.createElement('a');
  link.href = `/p/${entry.slug}#${entry.key}`;
  link.textContent = entry.name;

  const date = document.createElement('span');
  date.className = 'master__date';
  date.textContent = new Date(entry.createdAt).toLocaleDateString('it-IT');

  row.append(link, date);
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

function field(label: string, type: string, placeholder: string) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';

  const text = document.createElement('span');
  text.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  if (type === 'number') input.step = 'any';

  wrapper.append(text, input);
  return { wrapper, input };
}
