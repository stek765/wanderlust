/**
 * Il giro completo in un browser vero: crea un viaggio con due tappe, carica foto, le
 * rilegge, e scorre da una tappa all'altra.
 *
 * Esiste perché tutto il resto dei test gira a pezzi separati, e i pezzi qui si toccano
 * in modi che nessun test unitario può verificare: canvas che ridimensiona davvero,
 * WebCrypto che cifra davvero, il blob che parte e torna, la chiave che sopravvive nel
 * frammento dell'URL e apre tutte le tappe del viaggio.
 *
 * Quello che questo test NON copre, e va provato a mano su un iPhone: il tocco del tag
 * NFC, Safari, e la fluidità del volo (serve WebGL e una GPU vera).
 */

import { expect, test, type Page } from '@playwright/test';

const MASTER_URL = '/m/master-di-test';

/** PNG 4x4 valido, minimo indispensabile perché createImageBitmap lo accetti. */
const PNG_4x4 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P8z8Dwn4EIwESMolGFoworsQIAZbEDCUxU2VkAAAAASUVORK5CYII=',
  'base64',
);

const COORDINATE: Record<string, { lat: string; lon: string }> = {
  Bangkok: { lat: '13.7563', lon: '100.5018' },
  Phuket: { lat: '7.8804', lon: '98.3923' },
  Sardegna: { lat: '40.5833', lon: '9.7' },
};

/**
 * La ricerca del luogo risponde da qui, non da Nominatim.
 *
 * Una tappa si aggiunge cercando il posto: da lì arrivano insieme il nome e le coordinate,
 * e i due campi numerici restano nascosti finché la ricerca non fallisce. Chiamare il
 * servizio vero legherebbe la suite alla rete e alla cortesia di OpenStreetMap, e la
 * farebbe fallire per motivi che non hanno niente a che vedere con questo sito.
 *
 * Con `trovato: false` risponde "nessun risultato", che è come si prova il ripiego a mano.
 */
async function fingiLaRicerca(page: Page, trovato = true): Promise<void> {
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const cercato = new URL(route.request().url()).searchParams.get('q') ?? '';
    const punto = COORDINATE[cercato];

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        trovato && punto ? [{ lat: punto.lat, lon: punto.lon, display_name: `${cercato}, Italia` }] : [],
      ),
    });
  });
}

/** Crea un viaggio con le sue tappe e restituisce l'URL da scrivere sul tag. */
async function creaViaggio(page: Page, viaggio: string, tappe: string[]): Promise<string> {
  await fingiLaRicerca(page);
  await page.goto(MASTER_URL);
  // L'elenco arriva dal server: la scheda "nuovo viaggio" viene rimessa in fondo a ogni
  // aggiornamento, e cliccarla mentre l'elenco si sta ricostruendo la fa mancare.
  await page.locator('.panel__trips').waitFor();

  // La scheda "nuovo viaggio" nasce chiusa: prima si apre, poi si scrive.
  await page.getByRole('button', { name: '+ Nuovo viaggio' }).click();
  await page.getByPlaceholder('Thailandia').fill(viaggio);
  await page.getByRole('button', { name: 'Crea il viaggio' }).click();

  // L'indirizzo del tag appartiene al VIAGGIO e compare appena creato: le tappe che
  // vengono dopo non producono magneti nuovi.
  const url = page.locator('.address__url');
  await expect(url).toBeVisible();
  await expect(url).toContainText('#');
  const tagUrl = (await url.textContent()) ?? '';
  if (!tagUrl) throw new Error('il pannello non ha prodotto un URL');

  const riga = page.locator('.trip').first();
  await expect(riga).toBeVisible();

  for (const nome of tappe) {
    // Il modulo della tappa nasce chiuso: cinque campi vuoti sempre aperti sotto ogni
    // viaggio rendevano illeggibile l'elenco delle tappe.
    // Un campo solo: si cerca il luogo, e da lì arrivano nome e coordinate insieme.
    await riga.getByRole('button', { name: '+ Tappa' }).click();
    await riga.getByPlaceholder('Cala Gonone').fill(nome);
    await riga.getByRole('button', { name: 'Cerca' }).click();
    await expect(riga.locator('.stopform__found')).toContainText(nome);

    await riga.getByRole('button', { name: 'Aggiungi' }).click();
    await expect(riga.locator('.stopchip').filter({ hasText: nome })).toBeVisible();
  }

  return tagUrl;
}

function percorso(tagUrl: string): string {
  const url = new URL(tagUrl);
  return url.pathname + url.search + url.hash;
}

/**
 * Apre le foto di una tappa con un tocco solo, anche se non è quella corrente.
 *
 * Il vecchio "primo tocco sceglie, secondo apre" costringeva a due gesti per una cosa
 * sola, e con la fila che scorre sotto le dita il secondo finiva regolarmente su una
 * scheda diversa.
 */
async function apriTappa(page: Page, indice: number): Promise<void> {
  await page.locator('.deck__card').nth(indice).click();
  await expect(page.locator('.shelf')).toBeVisible();
}

/** Una strisciata vera sulla fila delle tappe, col puntatore. */
async function strisciaIlCarosello(page: Page, pixel: number): Promise<void> {
  const rail = (await page.locator('.deck__rail').boundingBox())!;
  const y = rail.y + rail.height / 2;
  const da = rail.x + rail.width * 0.8;

  await page.mouse.move(da, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(da - (pixel * i) / 10, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function caricaUnaFoto(page: Page, indiceTappa = 0): Promise<void> {
  await apriTappa(page, indiceTappa);
  const shelf = page.locator('.shelf');
  await shelf.locator('input[type="file"]').setInputFiles({
    name: 'ricordo.png',
    mimeType: 'image/png',
    buffer: PNG_4x4,
  });
  await expect(shelf.locator('.uploader__status')).toContainText('1 foto aggiunte', { timeout: 20_000 });
}

test('il tag porta l\'indirizzo del viaggio, non di un posto', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok', 'Phuket']);

  // Le tre parti che rendono l'URL quello che è.
  expect(tagUrl).toContain('/v/');
  expect(tagUrl).toContain('?w=');
  expect(tagUrl).toContain('#');
});

test('se la ricerca non trova il luogo, le coordinate si scrivono a mano', async ({ page }) => {
  await creaViaggio(page, 'Thailandia', ['Bangkok']);

  // Da qui in poi la ricerca non trova più niente. I due campi numerici sono l'unica via
  // d'uscita del modulo, e senza di loro un posto senza nome su Nominatim — una spiaggia,
  // una casa — non si potrebbe aggiungere affatto.
  await fingiLaRicerca(page, false);

  const riga = page.locator('.trip').first();
  await riga.getByRole('button', { name: '+ Tappa' }).click();
  await riga.getByPlaceholder('Cala Gonone').fill('la spiaggia dei nonni');

  // Prima di cercare non ci sono: sono il ripiego, non il modulo.
  await expect(riga.getByPlaceholder('40.28')).toBeHidden();

  await riga.getByRole('button', { name: 'Cerca' }).click();
  await expect(riga.getByPlaceholder('40.28')).toBeVisible();

  await riga.getByPlaceholder('40.28').fill('40.7069');
  await riga.getByPlaceholder('9.62').fill('9.6972');
  await riga.getByRole('button', { name: 'Aggiungi' }).click();

  await expect(riga.locator('.stopchip').filter({ hasText: 'la spiaggia dei nonni' })).toBeVisible();
});

/*
 * Il giro che rende utile l'esportazione.
 *
 * Il portachiavi vive nel localStorage di un browser solo: un viaggio creato dal telefono,
 * sul computer compare nell'elenco ma con le copertine grigie, perché la sua chiave è
 * rimasta di là. Per un po' l'esportazione è esistita senza il suo inverso, e il file
 * prodotto non si poteva ricaricare da nessuna parte.
 */
test('le chiavi si portano da un dispositivo all\'altro', async ({ page }) => {
  await creaViaggio(page, 'Thailandia', ['Bangkok']);

  const scaricato = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta' }).click();
  const file = await (await scaricato).path();

  // Da qui in poi questo browser è un browser qualsiasi: ha il token master, non le chiavi.
  await page.evaluate(() => localStorage.removeItem('ricordi:keychain'));
  await page.reload();

  const riga = page.locator('.trip').first();
  await expect(riga.locator('.trip__missing')).toContainText('Importa');
  await expect(riga.getByRole('button', { name: '+ Tappa' })).toHaveCount(0);

  await page.locator('.panel input[type="file"]').setInputFiles(file);
  await expect(page.locator('.panel__import-esito')).toContainText('1 chiave aggiunta');

  // Tornata la chiave, il viaggio è di nuovo governabile da qui.
  await expect(riga.getByRole('button', { name: '+ Tappa' })).toBeVisible();
  await expect(riga.locator('.trip__missing')).toHaveCount(0);
});

test('la chiave di cifratura non arriva mai al server', async ({ page }) => {
  const richieste: string[] = [];
  page.on('request', (request) => richieste.push(request.url()));

  const tagUrl = await creaViaggio(page, 'Lisbona', ['Bangkok']);
  const chiave = tagUrl.split('#')[1]!;

  await page.goto(percorso(tagUrl));
  await page.waitForTimeout(1500);

  // Nessuna richiesta, di nessun tipo, deve contenere la chiave.
  for (const url of richieste) {
    expect(url).not.toContain(chiave);
  }
});

test('la mappa e le tappe ci sono subito, senza nessuna attesa', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok', 'Phuket']);
  await page.goto(percorso(tagUrl));

  // Niente sipario, niente volo: si arriva e il viaggio è già lì.
  await expect(page.locator('.trip-title h1')).toHaveText('Thailandia', { timeout: 20_000 });
  await expect(page.locator('.deck__card')).toHaveCount(2);
  await expect(page.locator('.deck__card').first()).toHaveClass(/deck__card--current/);

  // Le foto non sono sulla prima schermata: si aprono toccando una tappa.
  await expect(page.locator('.shelf')).toBeHidden();
});

test('carica una foto e la ritrova nella galleria della sua tappa', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  await page.goto(percorso(tagUrl));

  await caricaUnaFoto(page);

  // La foto è nella griglia, ed è stata decifrata: senza chiave l'immagine non
  // comparirebbe affatto.
  const tile = page.locator('.shelf .tile').first();
  await expect(tile).toBeVisible();
  await expect(tile.locator('img')).toHaveAttribute('src', /^blob:/);

  // Regressione: la griglia si aggiornava e l'etichetta no, lasciando "0 foto" scritto
  // sulla scheda della tappa di cui si stavano guardando le foto.
  await page.locator('.shelf__back').click();
  await expect(page.locator('.deck__card--current .deck__meta')).toContainText('1 foto');
});

test('le foto entrano nella griglia mentre le altre sono ancora in viaggio', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  await page.goto(percorso(tagUrl));
  await apriTappa(page, 0);

  // Le miniature appena spedite non devono tornare indietro da R2: ce le abbiamo già in
  // chiaro, ed è quello che le fa comparire subito invece che dopo un giro di rete.
  const letture: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/media/')) letture.push(r.url());
  });

  /*
   * Le ultime foto vengono trattenute di proposito.
   *
   * Sei PNG da quattro pixel partono così in fretta che la finestra "alcune arrivate,
   * altre no" non esisterebbe, e il test passerebbe anche se la griglia si riempisse solo
   * alla fine — cioè proprio il comportamento che deve escludere. La coda ne lavora
   * quattro per volta e ogni foto spedisce due blob: le prime otto richieste sono le
   * prime quattro foto, e le successive restano ferme abbastanza da poter guardare.
   */
  let spedizioni = 0;
  await page.route('**/api/stops/*/media', async (route) => {
    spedizioni++;
    await new Promise((resolve) => setTimeout(resolve, spedizioni <= 8 ? 30 : 3000));
    await route.continue();
  });

  await page.locator('.shelf input[type="file"]').setInputFiles(
    Array.from({ length: 6 }, (_, i) => ({
      name: `ricordo-${i}.png`,
      mimeType: 'image/png',
      buffer: PNG_4x4,
    })),
  );

  // Il momento che conta: quattro foto già visibili, il caricamento ancora aperto.
  await expect(page.locator('.shelf .tile')).toHaveCount(4, { timeout: 30_000 });
  await expect(page.locator('.uploader__status')).toContainText('di 6');

  await expect(page.locator('.uploader__status')).toContainText('6 foto aggiunte', { timeout: 60_000 });
  await expect(page.locator('.shelf .tile')).toHaveCount(6);
  expect(letture).toEqual([]);
});

/*
 * Cancellare non deve far perdere il segno.
 *
 * Togliere una foto ricostruisce la pagina, e ricostruirla la riportava in cima: con
 * dieci foto da togliere significava ritrovare il punto dieci volte.
 */
test('cancellare una foto non riporta la galleria all\'inizio', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  await page.goto(percorso(tagUrl));
  await apriTappa(page, 0);

  await page.locator('.shelf input[type="file"]').setInputFiles(
    Array.from({ length: 8 }, (_, i) => ({
      name: `ricordo-${i}.png`,
      mimeType: 'image/png',
      buffer: PNG_4x4,
    })),
  );
  await expect(page.locator('.shelf .tile')).toHaveCount(8, { timeout: 60_000 });

  const pagina = page.locator('.shelf .page').nth(1);
  await pagina.evaluate((el) => el.scrollTo({ top: 200 }));
  const prima = await pagina.evaluate((el) => el.scrollTop);
  expect(prima).toBeGreaterThan(0);

  /*
   * Si apre l'ULTIMA foto, non la prima.
   *
   * Playwright porta in vista l'elemento che sta per cliccare: con la prima, che sta in
   * cima, riporterebbe la pagina su da sola — e il test misurerebbe il proprio effetto
   * collaterale invece del comportamento del sito. Ci è cascato, e per due volte ha fatto
   * sospettare un difetto che non c'era.
   */
  await page.locator('.shelf .tile').last().click();
  const elimina = page.locator('.viewer__action--danger');
  await elimina.click();
  await elimina.click();

  await expect(page.locator('.shelf .tile')).toHaveCount(7, { timeout: 30_000 });
  // Lo scorrimento è rimasto dov'era, non è tornato a zero.
  expect(await pagina.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('scorrere il carosello cambia la tappa corrente, senza toccare niente', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok', 'Phuket']);
  await page.goto(percorso(tagUrl));
  await expect(page.locator('.deck__card')).toHaveCount(2);
  await expect(page.locator('.deck__card').first()).toHaveClass(/deck__card--current/);

  // Una strisciata, nessun tocco: la tappa cambia e la mappa la segue.
  await strisciaIlCarosello(page, 180);
  await expect(page.locator('.deck__card--current .deck__name')).toHaveText('Phuket', {
    timeout: 5000,
  });

  // Strisciare non apre niente: le foto restano dietro un tocco.
  await expect(page.locator('.shelf')).toBeHidden();
});

test('un tocco su una scheda apre le sue foto', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok', 'Phuket']);
  await page.goto(percorso(tagUrl));
  await expect(page.locator('.deck__card')).toHaveCount(2);

  // Un tocco solo, anche su una tappa che non è quella corrente.
  await page.locator('.deck__card').nth(1).click();
  await expect(page.locator('.shelf')).toBeVisible();
  await expect(page.locator('.shelf__title')).toHaveText('Phuket');
});

test('le foto della seconda tappa si decifrano con la stessa chiave', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok', 'Phuket']);
  await page.goto(percorso(tagUrl));

  await caricaUnaFoto(page, 0);
  await page.locator('.shelf__back').click();
  await caricaUnaFoto(page, 1);

  await page.reload();
  await expect(page.locator('.deck__card')).toHaveCount(2);
  await apriTappa(page, 1);

  await expect(page.locator('.shelf__title')).toHaveText('Phuket');
  await expect(page.locator('.shelf .tile img').first()).toHaveAttribute('src', /^blob:/, {
    timeout: 20_000,
  });
});

test('[WEBGL] la mappa riempie lo schermo e le tappe ci stanno sopra', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok', 'Phuket']);
  await page.goto(percorso(tagUrl));
  await expect(page.locator('.deck__card')).toHaveCount(2);

  const viewport = page.viewportSize()!;
  const mappa = (await page.locator('.map').boundingBox())!;
  const carosello = (await page.locator('.deck').boundingBox())!;

  expect(mappa.height).toBeGreaterThan(viewport.height * 0.9);
  // Il carosello sta in fondo, sopra la mappa: è l'unica cosa che le ruba spazio.
  expect(carosello.y + carosello.height).toBeGreaterThan(viewport.height - 4);
});

test('[HEIC] una foto iPhone si carica anche dove il browser non sa leggerla', async ({ page }) => {
  // Il file è un HEIC vero, prodotto con `sips -s format heic`. Su Chrome
  // createImageBitmap lo rifiuta: se questo test passa, il convertitore ha funzionato.
  const tagUrl = await creaViaggio(page, 'Sardegna', ['Sardegna']);
  await page.goto(percorso(tagUrl));
  await apriTappa(page, 0);

  await page.locator('.shelf input[type="file"]').setInputFiles('tests/fixtures/foto-iphone.heic');

  // Generoso: la prima conversione deve scaricare il decodificatore WebAssembly.
  await expect(page.locator('.uploader__status')).toContainText('1 foto aggiunte', { timeout: 60_000 });
  await expect(page.locator('.shelf .tile img').first()).toHaveAttribute('src', /^blob:/, {
    timeout: 20_000,
  });
});

test('il visore resta chiuso finché non si tocca una foto', async ({ page }) => {
  // Regressione: `.viewer` dichiara display:grid, che batte l'attributo `hidden` del
  // browser. Senza una regola esplicita il visore resta nero sopra tutta la pagina e
  // sembra che il sito non carichi.
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  await page.goto(percorso(tagUrl));

  await expect(page.locator('.viewer')).toBeHidden();
  await caricaUnaFoto(page);

  await page.locator('.shelf .tile').first().click();
  await expect(page.locator('.viewer')).toBeVisible();

  await page.getByRole('button', { name: 'Chiudi' }).click();
  await expect(page.locator('.viewer')).toBeHidden();
});

test('la galleria si chiude e torna alla mappa', async ({ page }) => {
  // Regressione della stessa famiglia: un sovrapposto a schermo intero che dichiara
  // `overflow` e `animation` batte l'attributo `hidden`, e resta lì a coprire la mappa.
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  await page.goto(percorso(tagUrl));

  await apriTappa(page, 0);
  await expect(page.locator('.shelf')).toBeVisible();

  await page.locator('.shelf__back').click();
  await expect(page.locator('.shelf')).toBeHidden();
  await expect(page.locator('.deck__card').first()).toBeVisible();
});

test('il token di scrittura sparisce dalla barra degli indirizzi', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  await page.goto(percorso(tagUrl));

  await apriTappa(page, 0);
  await expect(page.getByRole('button', { name: '+ Aggiungi foto' })).toBeVisible({ timeout: 15_000 });

  // La chiave resta (serve a ricaricare), il token no.
  expect(page.url()).not.toContain('?w=');
  expect(page.url()).toContain('#');
});

test('chi apre il link condiviso legge ma non può caricare, e non vede il menu', async ({ browser, page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  const condiviso = percorso(tagUrl).replace(/\?w=[^#]*/, '');

  // Contesto nuovo: nessun localStorage, come un telefono che non ha mai visto il tag né
  // l'indirizzo segreto.
  const altroContesto = await browser.newContext();
  const altraPagina = await altroContesto.newPage();

  await altraPagina.goto(condiviso);
  await expect(altraPagina.locator('.trip-title h1')).toHaveText('Thailandia', { timeout: 20_000 });

  await altraPagina.locator('.deck__card').first().click();
  await expect(altraPagina.locator('.shelf')).toBeVisible();
  await expect(altraPagina.getByRole('button', { name: '+ Aggiungi foto' })).toHaveCount(0);
  await expect(altraPagina.locator('.menu')).toHaveCount(0);

  await altroContesto.close();
});

test('il menu compare solo dopo essere passati dall\'indirizzo segreto', async ({ browser, page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);

  // Su questo contesto la pagina master è già stata visitata dentro creaViaggio.
  await page.goto(percorso(tagUrl));
  await expect(page.locator('.menu__toggle')).toBeVisible({ timeout: 20_000 });

  await page.locator('.menu__toggle').click();
  await expect(page.getByRole('button', { name: '+ Nuovo viaggio' })).toBeVisible();

  // Un contesto che non ha mai visto /m/<token> non ha nessun menu da aprire.
  const vergine = await browser.newContext();
  const altraPagina = await vergine.newPage();
  await altraPagina.goto(percorso(tagUrl).replace(/\?w=[^#]*/, ''));
  await expect(altraPagina.locator('.trip-title h1')).toBeVisible({ timeout: 20_000 });
  await expect(altraPagina.locator('.menu__toggle')).toHaveCount(0);

  await vergine.close();
});

test('un link senza chiave lo dice, invece di rompersi', async ({ page }) => {
  const tagUrl = await creaViaggio(page, 'Thailandia', ['Bangkok']);
  const senzaChiave = percorso(tagUrl).split('#')[0]!;

  await page.goto(senzaChiave);
  await expect(page.locator('.message h1')).toHaveText('Link incompleto');
});

test('uno slug inventato non rivela niente', async ({ page }) => {
  await page.goto('/v/inventatodinulla#Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDA');
  await expect(page.locator('.message h1')).toHaveText('Viaggio non trovato');
});
