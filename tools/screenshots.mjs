/**
 * Le schermate del sito, per guardarlo invece che immaginarselo.
 *
 * Serve perché i problemi di questa interfaccia sono quasi tutti invisibili nel codice:
 * un'attribuzione troppo luminosa, uno zoom che atterra sui nomi delle frazioni, una
 * barra che finisce dentro una sfumatura. Si vedono solo in un'immagine.
 *
 * Uso:
 *   npm run dev:prove              (in un terminale: porta 8788, database separato)
 *   node tools/screenshots.mjs     (le immagini finiscono in tools/screenshots/)
 *
 * Punta al database DELLE PROVE, non a quello di sviluppo, e la ragione è che questo
 * strumento comincia cancellando tutti i viaggi che trova. Puntato altrove distrugge
 * roba vera: è già successo, ed è per quello che i due database ora sono separati.
 * Le foto di prova le genera ffmpeg, in tre proporzioni diverse, per vedere la griglia
 * come sarà davvero.
 */

import { chromium, devices } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8788';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
const FOTO_DIR = new URL('./foto-di-prova/', import.meta.url).pathname;
const MASTER = 'master-di-test';
const FOTO = readdirSync(FOTO_DIR).sort().map((f) => path.join(FOTO_DIR, f));

const TAPPE = [
  { nome: 'Budoni', lat: '40.7069', lon: '9.6972' },
  { nome: 'Cala Gonone', lat: '40.2814', lon: '9.6274' },
  { nome: 'Bosa', lat: '40.2969', lon: '8.5008' },
];

// Pulizia: il database locale si porta dietro i viaggi delle prove precedenti.
const esistenti = await fetch(`${BASE}/api/trips`, { headers: { Authorization: `Bearer ${MASTER}` } }).then((r) => r.json());
for (const t of esistenti) {
  await fetch(`${BASE}/api/trips/${t.slug}`, { method: 'DELETE', headers: { Authorization: `Bearer ${MASTER}` } });
}
console.log(`ripuliti ${esistenti.length} viaggi`);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
const page = await ctx.newPage();
// Un errore JavaScript nella pagina è la causa più probabile di uno strumento che si
// blocca aspettando qualcosa che non arriverà mai: qui si vede subito.
page.on('pageerror', (e) => console.log('ERRORE NELLA PAGINA:', e.message));
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png` });

/*
 * La ricerca del luogo risponde da qui, non da Nominatim.
 *
 * Il modulo della tappa chiede un luogo e ne ricava nome e coordinate; i due campi
 * numerici compaiono solo quando la ricerca fallisce. Chiamare il servizio vero
 * legherebbe uno strumento di lavoro alla rete e alla cortesia di OpenStreetMap, e le
 * schermate cambierebbero a seconda di cosa risponde. Qui le coordinate sono quelle
 * della tabella qui sopra, sempre le stesse.
 */
await page.route('https://nominatim.openstreetmap.org/**', (route) => {
  const cercato = new URL(route.request().url()).searchParams.get('q') ?? '';
  const tappa = TAPPE.find((t) => t.nome.toLowerCase() === cercato.toLowerCase());

  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(
      tappa ? [{ lat: tappa.lat, lon: tappa.lon, display_name: `${tappa.nome}, Sardegna, Italia` }] : [],
    ),
  });
});

await page.goto(`${BASE}/m/master-di-test`);
await page.evaluate(() => localStorage.removeItem('ricordi:keychain'));
await page.reload();
await page.getByRole('button', { name: '+ Nuovo viaggio' }).waitFor();
await shot('01-master-vuoto');

await page.getByRole('button', { name: '+ Nuovo viaggio' }).click();
await page.getByPlaceholder('Thailandia').fill('Sardegna 2026');
await page.getByRole('button', { name: 'Crea il viaggio' }).click();
await page.locator('.trip').first().waitFor();

await page.locator('.address__url').waitFor({ state: 'visible', timeout: 15000 });
const urls = [await page.locator('.address__url').textContent()];

const riga = page.locator('.trip').first();
await riga.waitFor();
for (const t of TAPPE) {
  await riga.getByRole('button', { name: '+ Tappa' }).click();
  await riga.getByPlaceholder('Cala Gonone').fill(t.nome);
  // Si cerca il luogo: nome e coordinate arrivano insieme da lì. I campi numerici sono
  // il ripiego per quando la ricerca non trova niente, e restano nascosti se trova.
  await riga.getByRole('button', { name: 'Cerca' }).click();
  await riga.locator('.stopform__found').waitFor({ timeout: 15000 });
  await riga.getByRole('button', { name: 'Aggiungi' }).click();
  await riga.locator('.stopchip').filter({ hasText: t.nome }).waitFor({ timeout: 15000 });
}
await shot('02-master-pieno-alto');
await page.evaluate(() => window.scrollTo(0, 900));
await shot('03-master-pieno-basso');

const percorso = (u) => { const x = new URL(u); return x.pathname + x.search + x.hash; };
const viaggio = BASE + percorso(urls[0]);

await page.goto(viaggio);
await page.locator('.deck__card').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1200);
await shot('04-mappa-vuota');

/** Un tocco su una scheda apre le sue foto. */
async function apriTappa(i) {
  /*
   * Il foglio delle foto va chiuso prima.
   *
   * Da quando non copre più tutto lo schermo ma si ferma sotto la mappa, il carosello
   * delle tappe gli resta sotto: con il foglio aperto una scheda non si può toccare, ed è
   * il comportamento voluto — per cambiare tappa si chiude e si scorre. Lo strumento
   * cliccava direttamente e finiva a bussare contro il pannello del caricamento.
   */
  const shelf = page.locator('.shelf');
  if (await shelf.isVisible()) {
    await page.locator('.shelf__back').click();
    await shelf.waitFor({ state: 'hidden' });
  }

  await page.locator('.deck__card').nth(i).click();
  await shelf.waitFor();
}

for (let i = 0; i < 3; i++) {
  await apriTappa(i);
  await page.locator('.shelf input[type="file"]').setInputFiles(FOTO.slice(i * 3, i * 3 + 3));
  if (i === 0) { await page.waitForTimeout(900); await shot('05-caricamento'); }
  await page.locator('.shelf .uploader__status').filter({ hasText: 'foto aggiunte' }).waitFor({ timeout: 60000 });
  await page.locator('.shelf__back').click();
  await page.waitForTimeout(400);
}

await page.goto(viaggio);
await page.locator('.deck__card').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1400);
await shot('06-prima-tappa');

// Una strisciata, non un tocco: è così che si cambia tappa.
const striscia = async (pixel) => {
  const rail = await page.locator('.deck__rail').boundingBox();
  const y = rail.y + rail.height / 2;
  const da = rail.x + rail.width * 0.8;
  await page.mouse.move(da, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(da - (pixel * i) / 10, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

await striscia(150);
await page.waitForTimeout(2200);
await shot('07-seconda-tappa');

await striscia(150);
await page.waitForTimeout(2200);
await shot('08-terza-tappa');

await apriTappa(2);
await page.waitForTimeout(900);
await shot('09-galleria');

await page.locator('.shelf .tile').first().click();
await page.waitForTimeout(1500);
await shot('10-visore');
await page.getByRole('button', { name: 'Chiudi' }).click();
await page.locator('.shelf__back').click();

await page.locator('.menu__toggle').click();
await page.waitForTimeout(900);
await shot('11-menu');

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const dp = await desk.newPage();
const dshot = (n) => dp.screenshot({ path: `${OUT}${n}.png` });
await dp.goto(viaggio);
await dp.locator('.deck__card').first().waitFor({ timeout: 30000 });
await dp.waitForTimeout(1600);
await dshot('12-desktop');

await browser.close();
console.log('viaggio:', viaggio);
