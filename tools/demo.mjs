/**
 * La GIF del README: un viaggio inventato, girato mentre lo si sfoglia.
 *
 * Costruisce da zero un viaggio fittizio nel database DELLE PROVE — le cinque tappe di
 * `viaggio-demo.mjs`, con le foto scaricate da `foto-vere.mjs` — e poi lo riprende: la
 * mappa che vola da una tappa all'altra lungo la rotta, le foto che si aprono, il visore.
 *
 * La ripresa avviene in una scheda **senza token di scrittura**: è quello che vede chi
 * riceve il link, cioè senza il ☰ e senza il pulsante per caricare. Una GIF con i comandi
 * di amministrazione dentro racconterebbe un sito diverso da quello che si apre toccando
 * un magnete.
 *
 * Uso:
 *   npm run dev:prove       (in un altro terminale: porta 8788, database separato)
 *   node tools/demo.mjs
 *
 * ⚠️ Come `screenshots.mjs`, comincia CANCELLANDO tutti i viaggi che trova: puntato al
 * database di sviluppo invece che a quello delle prove distrugge roba vera.
 */

import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { scaricaFoto } from './foto-vere.mjs';
import { FOTO_PER_TAPPA, TAPPE, VIAGGIO } from './viaggio-demo.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8788';
const MASTER = 'master-di-test';
const LAVORO = new URL('./demo/', import.meta.url).pathname;
const USCITA = new URL('../docs/demo.webp', import.meta.url).pathname;

/*
 * WebP animato, non GIF, e la differenza non è di gusto.
 *
 * Una GIF ha 256 colori in tutto: su fotografie vere significa sparpagliare i colori a
 * scacchiera per simulare le sfumature, e quella scacchiera è anche la cosa più cara da
 * comprimere. Per stare sotto i 5 MB la GIF era scesa a 240 pixel di larghezza e 12
 * fotogrammi al secondo. Il WebP, a colori pieni, sta in 4,3 MB a **390 pixel e 20
 * fotogrammi** — cioè la larghezza vera del telefono ripreso, senza rimpicciolire niente.
 *
 * Misure, sullo stesso filmato di 17 secondi:
 *   GIF 240px 12fps 144 colori ................ 4,8 MB
 *   GIF 240px 12fps tavolozza per fotogramma .. 14 MB   (bella, improponibile)
 *   WebP 390px 20fps qualità 70 ............... 3,8 MB
 *   WebP 390px 20fps qualità 76 ............... 4,3 MB  ← questo
 *
 * ⚠️ GitHub lo anima nel README come farebbe con una GIF. Qualche visualizzatore di
 * Markdown fuori dal browser mostra solo il primo fotogramma: se un giorno desse
 * fastidio, si torna alla GIF cambiando questa funzione, non il resto dello strumento.
 */
const LARGHEZZA = 390;
const FOTOGRAMMI_AL_SECONDO = 20;
const QUALITA = 76;

const TELEFONO = { width: 390, height: 844 };
/** Lo stesso di `map-scene.ts`: serve per chiedere in anticipo le sue mattonelle. */
const STILE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Il dito
 *
 * Playwright muove un puntatore che nel video non si vede: le schede scorrerebbero da
 * sole e la GIF sembrerebbe un'animazione automatica invece di un sito che si tocca.
 *
 * Il pallino non è pilotato dallo script: sta in ascolto degli eventi veri del puntatore,
 * quindi mostra il gesto che è stato fatto davvero e non una sua imitazione. In fase di
 * cattura, così nessuna vista può fermarlo prima che arrivi.
 * ------------------------------------------------------------------ */

async function mostraIlDito(page) {
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const stile = document.createElement('style');
      stile.textContent = `
        #dito {
          position: fixed; left: 0; top: 0; width: 44px; height: 44px;
          margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none;
          z-index: 2147483647; opacity: 0;
          background: radial-gradient(circle, rgb(255 255 255 / 55%) 0%, rgb(255 255 255 / 18%) 60%, transparent 70%);
          border: 1.5px solid rgb(255 255 255 / 65%);
          transition: opacity 180ms ease, transform 90ms linear, scale 140ms ease;
        }
        #dito.giu { scale: 0.78; background: radial-gradient(circle, rgb(255 255 255 / 78%) 0%, rgb(255 255 255 / 28%) 60%, transparent 70%); }
      `;
      const dito = document.createElement('div');
      dito.id = 'dito';
      document.head.append(stile);
      document.body.append(dito);

      addEventListener('pointermove', (e) => {
        dito.style.opacity = '1';
        dito.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }, true);
      addEventListener('pointerdown', () => dito.classList.add('giu'), true);
      addEventListener('pointerup', () => dito.classList.remove('giu'), true);
      // Fuori dallo schermo il pallino sparisce, invece di restare appiccicato a un bordo.
      addEventListener('ricordi:dito-via', () => (dito.style.opacity = '0'));
    });
  });
}

const nascondiIlDito = (page) =>
  page.evaluate(() => dispatchEvent(new Event('ricordi:dito-via')));

/* ------------------------------------------------------------------ *
 * I gesti
 * ------------------------------------------------------------------ */

/**
 * Una strisciata sul carosello, lenta, di un numero esatto di tappe.
 *
 * Lenta perché il carosello ha un lancio a inerzia sotto il rilascio: mollando in
 * velocità la fila prosegue per conto suo e si ferma dove capita, che va benissimo con un
 * pollice vero e malissimo in una ripresa dove ogni tappa deve essere inquadrata. Sotto
 * la soglia di lancio il rilascio è fermo, e alla fine si corregge la deriva portando la
 * fila esattamente sulla scheda.
 */
async function striscia(page, quante) {
  const misura = await page.evaluate(() => {
    const rail = document.querySelector('.deck__rail');
    const carte = [...rail.querySelectorAll('.deck__card')];
    const bordo = rail.getBoundingClientRect();
    const dove = (c) => c.getBoundingClientRect().left - bordo.left + rail.scrollLeft;
    return {
      passo: dove(carte[1]) - dove(carte[0]),
      scorrimento: rail.scrollLeft,
      offsets: carte.map(dove),
      rail: { x: bordo.x, y: bordo.y, w: bordo.width, h: bordo.height },
    };
  });

  const distanza = misura.passo * quante;
  const y = misura.rail.y + misura.rail.h / 2;
  const da = misura.rail.x + misura.rail.w * 0.86;

  await page.mouse.move(da, y);
  await attesa(260);
  await page.mouse.down();

  const passi = 26;
  for (let i = 1; i <= passi; i++) {
    // Accelerazione e frenata: un trascinamento a velocità costante si riconosce come
    // finto, e alla fine il rilascio partirebbe ancora lanciato.
    const t = i / passi;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(da - distanza * eased, y);
    await attesa(14);
  }

  await page.mouse.up();

  // La correzione: la fila si allinea sulla scheda invece di fermarsi a metà.
  const meta = misura.scorrimento + distanza;
  const vicino = misura.offsets.reduce((a, b) => (Math.abs(b - meta) < Math.abs(a - meta) ? b : a));
  await page.evaluate(
    (left) => document.querySelector('.deck__rail').scrollTo({ left, behavior: 'smooth' }),
    vicino,
  );
}

/**
 * Una strisciata col **dito**, non col mouse.
 *
 * Il visore delle foto ascolta `touchstart`/`touchmove`/`touchend` e nient'altro: è
 * l'unica vista del sito che si comanda solo a tocco, e la prima versione di questo
 * strumento ci passava sopra col puntatore ottenendo esattamente niente — la GIF mostrava
 * la stessa foto per quattro secondi, con un pallino che ci scorreva sopra invano e la
 * didascalia ferma su "1 di 6".
 *
 * Playwright non ha un trascinamento a dito (il suo `touchscreen` sa solo toccare),
 * quindi gli eventi si mandano dal protocollo di Chrome. Sono tocchi veri: il visore non
 * ha modo di distinguerli da un pollice, e il pallino li segue perché ogni tocco genera
 * anche i corrispondenti eventi di puntatore.
 */
async function strisciaColDito(cdp, { da, a, y, passi = 20, pausa = 12 }) {
  const punto = (x) => [{ x, y, radiusX: 14, radiusY: 14, force: 1 }];

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punto(da) });
  for (let i = 1; i <= passi; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: punto(da + (a - da) * (i / passi)),
    });
    await attesa(pausa);
  }
  // Il visore decide dalla spinta oltre che dalla distanza: staccare il dito mentre è
  // ancora in corsa è quello che fa scattare la foto successiva invece di rimetterla a posto.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* ------------------------------------------------------------------ *
 * Preparazione: il viaggio inventato
 * ------------------------------------------------------------------ */

async function costruisciIlViaggio(browser, foto) {
  const vecchi = await fetch(`${BASE}/api/trips`, {
    headers: { Authorization: `Bearer ${MASTER}` },
  }).then((r) => r.json());
  for (const t of vecchi) {
    await fetch(`${BASE}/api/trips/${t.slug}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${MASTER}` },
    });
  }
  console.log(`ripuliti ${vecchi.length} viaggi`);

  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERRORE NELLA PAGINA:', e.message));

  // Come in `screenshots.mjs`: la ricerca del luogo risponde da qui. Legare la costruzione
  // della dimostrazione a Nominatim significherebbe vederla fallire per motivi che non
  // hanno niente a che fare con questo sito.
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const cercato = new URL(route.request().url()).searchParams.get('q') ?? '';
    const tappa = TAPPE.find((t) => t.nome.toLowerCase() === cercato.toLowerCase());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        tappa ? [{ lat: tappa.lat, lon: tappa.lon, display_name: tappa.nome }] : [],
      ),
    });
  });

  await page.goto(`${BASE}/m/${MASTER}`);
  await page.evaluate(() => localStorage.removeItem('ricordi:keychain'));
  await page.reload();

  await page.getByRole('button', { name: '+ Nuovo viaggio' }).click();
  await page.getByPlaceholder('Thailandia').fill(VIAGGIO);
  await page.getByRole('button', { name: 'Crea il viaggio' }).click();

  const riga = page.locator('.trip').first();
  await riga.waitFor();
  await page.locator('.address__url').waitFor({ state: 'visible', timeout: 15000 });
  const indirizzo = await page.locator('.address__url').textContent();

  for (const t of TAPPE) {
    await riga.getByRole('button', { name: '+ Tappa' }).click();
    await riga.getByPlaceholder('Cala Gonone').fill(t.nome);
    await riga.getByRole('button', { name: 'Cerca' }).click();
    await riga.locator('.stopform__found').waitFor({ timeout: 15000 });
    await riga.getByRole('button', { name: 'Aggiungi' }).click();
    await riga.locator('.stopchip').filter({ hasText: t.nome }).waitFor({ timeout: 15000 });
    console.log(`tappa: ${t.nome}`);
  }

  // Le foto si caricano dalla pagina del viaggio e non da qui, perché è là che vengono
  // cifrate: la chiave sta nel browser, e il server non la vede mai.
  const u = new URL(indirizzo);
  const viaggio = BASE + u.pathname + u.search + u.hash;

  await page.goto(viaggio);
  await page.locator('.deck__card').first().waitFor({ timeout: 30000 });

  for (let i = 0; i < TAPPE.length; i++) {
    const shelf = page.locator('.shelf');
    if (await shelf.isVisible()) {
      await page.locator('.shelf__back').click();
      await shelf.waitFor({ state: 'hidden' });
    }
    await page.locator('.deck__card').nth(i).click();
    await shelf.waitFor();
    await page.locator('.shelf input[type="file"]').setInputFiles(foto[TAPPE[i].posto]);
    await page
      .locator('.shelf .uploader__status')
      .filter({ hasText: 'foto aggiunte' })
      .waitFor({ timeout: 120000 });
    console.log(`foto caricate: ${TAPPE[i].nome}`);
  }

  await ctx.close();

  // Senza il token nella query: è il link che si condivide, ed è la vista da riprendere.
  return `${BASE}${u.pathname}${u.hash}`;
}

/**
 * Il viaggio percorso una volta a vuoto, prima del ciak.
 *
 * Serve per le mattonelle della mappa, e la prima versione di questo strumento è finita
 * nel muro proprio qui: nei salti lunghi `flyTo` si allarga fino a inquadrare mezzo
 * pianeta, ma le mattonelle di quelle quote non erano mai state chieste prima — quindi
 * per tutto il volo si vedeva il colore di fondo e nient'altro. Un campo grigio uniforme,
 * al posto del momento che spiega il progetto.
 *
 * Percorrere il viaggio una volta le fa chiedere tutte; alla seconda arrivano dalla cache
 * del browser, e il volo mostra gli oceani invece del vuoto. Non cambia il comportamento
 * del sito: cambia solo cosa la rete ha fatto in tempo a consegnare.
 */
/**
 * Le mattonelle della mappa, chieste in anticipo con la camera ferma.
 *
 * Serve per **la parte centrale dei voli**, cioè il momento in cui la camera si allarga e
 * si vedono insieme le due tappe e la rotta che le unisce — che è la cosa da far vedere.
 * Senza, a quelle quote le mattonelle non sono mai state chieste prima e a metà strada
 * resta un campo grigio uniforme: il volo c'è, ma non si capisce sopra cosa passa.
 *
 * ⚠️ **Ha un limite, ed è misurato.** Quando la camera sale molto — tratte da migliaia di
 * chilometri — nemmeno la cache calda basta: MapLibre le mattonelle le chiede (contate
 * durante un volo: 6 a zoom 1, 22 a zoom 2), ma fra l'arrivo e il momento in cui sono
 * interpretate e caricate in scheda passa più tempo di quanto la camera resti lassù.
 * Verificato con tre voli consecutivi sulla stessa tratta: tutti e tre uguali. È una
 * delle ragioni per cui il viaggio della dimostrazione ha tappe vicine.
 */
async function scaldaLeMattonelle(page, stile) {
  const quante = await page.evaluate(async ({ stile, fino }) => {
    const risposta = await fetch(stile).then((r) => r.json());

    const modelli = [];
    for (const sorgente of Object.values(risposta.sources ?? {})) {
      if (sorgente.tiles) modelli.push(...sorgente.tiles);
      else if (sorgente.url) {
        const tilejson = await fetch(sorgente.url).then((r) => r.json()).catch(() => null);
        if (tilejson?.tiles) modelli.push(...tilejson.tiles);
      }
    }

    const richieste = [];
    for (const modello of modelli) {
      for (let z = 0; z <= fino; z++) {
        const lato = 2 ** z;
        for (let x = 0; x < lato; x++) {
          for (let y = 0; y < lato; y++) {
            const url = modello
              .replace('{z}', z)
              .replace('{x}', x)
              .replace('{y}', y)
              .replace('{ratio}', '');
            richieste.push(fetch(url).then((r) => r.arrayBuffer()).catch(() => null));
          }
        }
      }
    }

    await Promise.all(richieste);
    return richieste.length;
  }, { stile, fino: 3 });

  console.log(`mattonelle scaldate: ${quante}`);
}

async function provaGenerale(page) {
  const offsets = await page.evaluate(() => {
    const rail = document.querySelector('.deck__rail');
    const bordo = rail.getBoundingClientRect();
    return [...rail.querySelectorAll('.deck__card')].map(
      (c) => c.getBoundingClientRect().left - bordo.left + rail.scrollLeft,
    );
  });

  const vai = (left) =>
    page.evaluate((x) => document.querySelector('.deck__rail').scrollTo({ left: x }), left);

  for (const left of offsets.slice(1)) {
    await vai(left);
    await attesa(2600);
  }

  await vai(0);
  await attesa(3400);
}

/* ------------------------------------------------------------------ *
 * La ripresa
 * ------------------------------------------------------------------ */

async function riprendi(browser, viaggio) {
  const ctx = await browser.newContext({
    viewport: TELEFONO,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: LAVORO, size: TELEFONO },
  });

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', (e) => console.log('ERRORE NELLA PAGINA:', e.message));
  await mostraIlDito(page);

  await page.goto(viaggio);
  await page.locator('.deck__card').first().waitFor({ timeout: 30000 });
  // La mappa arriva dopo il resto della pagina, ed è metà di quello che c'è da vedere:
  // qui si aspetta che la tela di MapLibre esista davvero, non solo il carosello.
  await page.locator('.map canvas').waitFor({ timeout: 30000 });
  await attesa(2500);

  await scaldaLeMattonelle(page, STILE);
  await provaGenerale(page);

  // Da qui in poi è la scena buona: quello che viene prima è il caricamento, e si taglia.
  const inizio = Date.now();

  await attesa(900);
  await striscia(page, 1); // Tokyo → Hakone
  await attesa(1200);
  await striscia(page, 1); // Hakone → Kyoto
  await attesa(1200);
  /*
   * Due tappe in una strisciata sola, e non per fretta.
   *
   * Passando da Kanazawa senza fermarcisi la mappa fa un volo più lungo, quindi si
   * allarga di più, e la rotta con i due spilli sta tutta nell'inquadratura invece di
   * uscire dai bordi. Ed è anche il gesto che il carosello è fatto per reggere: la camera
   * non accoda tre animazioni, sostituisce quella in corso.
   */
  await striscia(page, 2); // Kyoto → Hiroshima, passando da Kanazawa
  await attesa(2200);

  // Toccando la tappa corrente si aprono le sue foto.
  await page.locator('.deck__card--current').click();
  await page.locator('.shelf').waitFor();
  await attesa(1000);

  // Una scorsa nella griglia, che accende anche l'ombra sotto la barra del foglio.
  await page.locator('.shelf .page').first().evaluate((el) => el.scrollBy({ top: 150, behavior: 'smooth' }));
  await attesa(1000);

  /*
   * Il primo riquadro **interamente in vista**, non il primo dell'elenco.
   *
   * Dopo la scorsa la prima riga è mezza fuori dal bordo alto del foglio, e toccare un
   * riquadro tagliato è un gesto che nessuno farebbe.
   *
   * ⚠️ Questa riga è nata per un altro motivo, e vale la pena ricordarlo: la didascalia
   * del foglio si prendeva i tocchi delle foto che le stavano sotto, quindi il primo
   * riquadro non era toccabile affatto. Quello **era un difetto del sito** ed è stato
   * corretto (vedi `pointer-events` in `.shelf__bar`); qui resta solo la scelta del
   * riquadro giusto da toccare.
   */
  const scoperto = await page.evaluate(() => {
    const alto = document.querySelector('.shelf').getBoundingClientRect().top;
    const riquadri = [...document.querySelectorAll('.shelf .tile')];
    return Math.max(0, riquadri.findIndex((t) => t.getBoundingClientRect().top > alto + 4));
  });

  await page.locator('.shelf .tile').nth(scoperto).click();
  await page.locator('.viewer').waitFor();
  await attesa(1200);

  // Nel visore si scorre da una foto all'altra.
  const box = await page.locator('.viewer').boundingBox();
  const y = box.y + box.height / 2;
  await strisciaColDito(cdp, { da: box.x + box.width * 0.84, a: box.x + box.width * 0.2, y });
  await attesa(1300);

  // Si richiude tutto e si torna alla mappa: la GIF gira in tondo, e ripartire da una
  // mappa dopo una mappa è un salto che non si nota. Finendo su una foto a schermo intero
  // il ricomincio era uno stacco netto.
  await page.getByRole('button', { name: 'Chiudi' }).click();
  await page.locator('.viewer').waitFor({ state: 'hidden' });
  await attesa(600);
  await page.locator('.shelf__back').click();
  await page.locator('.shelf').waitFor({ state: 'hidden' });
  await attesa(800);

  await nascondiIlDito(page);
  await attesa(500);

  const durata = (Date.now() - inizio) / 1000;
  await ctx.close(); // il file video si chiude qui, non prima

  const video = readdirSync(LAVORO)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => path.join(LAVORO, f))
    .pop();

  return { video, taglio: (inizio - partenza) / 1000, durata };
}

/* ------------------------------------------------------------------ *
 * Da video a WebP animato
 * ------------------------------------------------------------------ */

/**
 * ffmpeg per tagliare e ridimensionare, `img2webp` per montare l'animazione.
 *
 * Due strumenti e non uno perché questo ffmpeg è compilato senza libwebp — cosa comune
 * nelle installazioni da Homebrew — e non sa scrivere WebP. `img2webp` arriva col
 * pacchetto `webp`, che di solito c'è già; se manca, `brew install webp`.
 *
 * ⚠️ `-lossy` va detto: senza, `img2webp` lavora **senza perdita** e ignora `-q`. La
 * prima prova è uscita a 34 MB, e sembrava che il formato non servisse a niente.
 */
function inWebp({ video, taglio, durata }) {
  const fotogrammi = path.join(LAVORO, 'fotogrammi');
  mkdirSync(fotogrammi, { recursive: true });

  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-ss', String(taglio), '-t', String(durata), '-i', video,
     '-vf', `fps=${FOTOGRAMMI_AL_SECONDO},scale=${LARGHEZZA}:-1:flags=lanczos`,
     '-vsync', '0', path.join(fotogrammi, 'f_%04d.png')],
    { stdio: 'inherit' },
  );

  const elenco = readdirSync(fotogrammi).sort().map((f) => path.join(fotogrammi, f));

  execFileSync(
    'img2webp',
    ['-loop', '0', '-d', String(Math.round(1000 / FOTOGRAMMI_AL_SECONDO)),
     '-lossy', '-q', String(QUALITA), '-m', '6', ...elenco, '-o', USCITA],
    { stdio: 'inherit' },
  );

  console.log(`${elenco.length} fotogrammi, ${LARGHEZZA} px, ${FOTOGRAMMI_AL_SECONDO} al secondo`);
}

/* ------------------------------------------------------------------ * */

rmSync(LAVORO, { recursive: true, force: true });
mkdirSync(LAVORO, { recursive: true });
mkdirSync(path.dirname(USCITA), { recursive: true });

const foto = await scaricaFoto(
  TAPPE.map((t) => ({
    posto: t.posto,
    cerca: t.cerca,
    quante: FOTO_PER_TAPPA,
    giorno: `${t.giorno}T00:00:00`,
  })),
);

/*
 * Headed, non headless, e non è una svista.
 *
 * Senza finestra vera Chromium disegna la mappa via software: il globo esiste, ma a una
 * manciata di fotogrammi al secondo, e in una GIF il volo diventa una serie di scatti.
 * Con la finestra aperta la scheda grafica fa il suo lavoro e il volo si vede per quello
 * che è.
 */
const browser = await chromium.launch({ headless: false });
// Ricostruire il viaggio costa un paio di minuti di caricamenti: mentre si aggiusta la
// ripresa si riusa quello di prima passandone l'indirizzo in `VIAGGIO`.
const viaggio = process.env.VIAGGIO ?? (await costruisciIlViaggio(browser, foto));
console.log('viaggio:', viaggio);

const partenza = Date.now();
const ripresa = await riprendi(browser, viaggio);
await browser.close();

inWebp(ripresa);
console.log('fatto:', USCITA);
