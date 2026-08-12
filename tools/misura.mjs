/**
 * Due numeri sul primo tocco del magnete, con la rete rallentata.
 *
 *   primo pixel    quando compare qualcosa (first-contentful-paint)
 *   prima tappa    quando il carosello ha una tappa evidenziata, cioè quando la pagina
 *                  è davvero utilizzabile
 *
 * Il secondo è quello che conta: oggi aspetta la mappa, e la mappa aspetta CARTO.
 */

import { chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8788';
const MASTER = 'master-di-test';
const GIRI = Number(process.env.GIRI ?? 3);

const auth = { Authorization: `Bearer ${MASTER}`, 'Content-Type': 'application/json' };

// --- semina: un viaggio con tre tappe, senza foto (le foto non sono in mezzo alla misura)

const esistenti = await fetch(`${BASE}/api/trips`, { headers: auth }).then((r) => r.json());
for (const t of esistenti) {
  await fetch(`${BASE}/api/trips/${t.slug}`, { method: 'DELETE', headers: auth });
}

const trip = await fetch(`${BASE}/api/trips`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: 'Misura' }),
}).then((r) => r.json());

for (const tappa of [
  { name: 'Budoni', lat: 40.7069, lon: 9.6972 },
  { name: 'Cala Gonone', lat: 40.2814, lon: 9.6274 },
  { name: 'Bosa', lat: 40.2969, lon: 8.5008 },
]) {
  await fetch(`${BASE}/api/trips/${trip.slug}/stops`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(tappa),
  });
}

const chiave = randomBytes(32).toString('base64url');
const URL_VIAGGIO = `${BASE}/v/${trip.slug}?w=${encodeURIComponent(trip.writeToken)}#${chiave}`;

// --- misura

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Segna a che millisecondo dalla partenza compaiono le cose che ci interessano. */
const SPIA = `
  window.__t = {};
  const segna = (nome) => { if (window.__t[nome] === undefined) window.__t[nome] = performance.now(); };
  new MutationObserver(() => {
    if (document.querySelector('.deck__card')) segna('schede');
    if (document.querySelector('.deck__card--current')) segna('tappaAttiva');
    if (document.querySelector('.maplibregl-canvas')) segna('mappa');
  // Su \`document\` e non su \`documentElement\`: lo script parte prima che l'elemento radice esista.
  }).observe(document, { childList: true, subtree: true, attributes: true });

  // Il primo disegno va osservato, non letto alla fine: da quando la pagina è pronta
  // prima di dipingere, andarlo a cercare dopo restituiva una misura vuota.
  new PerformanceObserver((lista) => {
    for (const voce of lista.getEntries()) {
      if (voce.name === 'first-contentful-paint') window.__t.fcp = voce.startTime;
    }
  }).observe({ type: 'paint', buffered: true });
`;

const giri = [];

for (let i = 0; i < GIRI; i++) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(SPIA);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ERRORE NELLA PAGINA:', e.message));

  // 4G scarso: è la rete di chi tocca un magnete in cucina, non quella di casa.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  // Un telefono non è un portatile: il codice che arriva va anche interpretato.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const jsBytes = { prima: 0 };
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/assets/') && u.endsWith('.js')) jsBytes.prima += 1;
  });

  await page.goto(URL_VIAGGIO, { waitUntil: 'commit' });
  // La mappa è l'ultima ad arrivare: aspettarla serve a vedere che arriva ancora.
  await page.waitForFunction(
    () => window.__t?.tappaAttiva !== undefined && window.__t?.fcp !== undefined && window.__t?.mappa !== undefined,
    null,
    { timeout: 60000 },
  );

  const t = await page.evaluate(() => ({
    ...window.__t,
    js: performance
      .getEntriesByType('resource')
      .filter((r) => r.name.includes('/assets/') && r.name.endsWith('.js'))
      .map((r) => ({ nome: r.name.split('/').pop(), fine: Math.round(r.responseEnd) })),
  }));

  giri.push(t);
  console.log(
    `giro ${i + 1}: primo pixel ${Math.round(t.fcp)} ms · schede ${Math.round(t.schede)} ms · tappa attiva ${Math.round(t.tappaAttiva)} ms · mappa ${Math.round(t.mappa)} ms`,
  );
  await ctx.close();
}

await browser.close();

const mediana = (n) => {
  const v = giri.map((g) => g[n]).sort((a, b) => a - b);
  return Math.round(v[Math.floor(v.length / 2)]);
};

console.log('\n--- mediana su', GIRI, 'giri ---');
console.log('primo pixel  ', mediana('fcp'), 'ms');
console.log('schede       ', mediana('schede'), 'ms');
console.log('tappa attiva ', mediana('tappaAttiva'), 'ms');
console.log('mappa         ', mediana('mappa'), 'ms');
console.log('\njs scaricato (ultimo giro):');
for (const j of giri.at(-1).js) console.log(' ', j.nome, '→ finito a', j.fine, 'ms');
