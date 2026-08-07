/**
 * Il giro completo in un browser vero: crea un posto, carica una foto, la rilegge.
 *
 * Esiste perché tutto il resto dei test gira a pezzi separati, e i pezzi qui si toccano
 * in modi che nessun test unitario può verificare: canvas che ridimensiona davvero,
 * WebCrypto che cifra davvero, il blob che parte e torna, la chiave che sopravvive nel
 * frammento dell'URL.
 *
 * Quello che questo test NON copre, e va provato a mano su un iPhone: il tocco del tag
 * NFC, Safari, e il volo sul globo (serve WebGL e una GPU vera).
 */

import { expect, test, type Page } from '@playwright/test';

const MASTER_URL = '/m/master-di-test';

/** PNG 4x4 valido, minimo indispensabile perché createImageBitmap lo accetti. */
const PNG_4x4 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P8z8Dwn4EIwESMolGFoworsQIAZbEDCUxU2VkAAAAASUVORK5CYII=',
  'base64',
);

async function creaPosto(page: Page, nome: string): Promise<string> {
  await page.goto(MASTER_URL);

  await page.getByPlaceholder('Bangkok').first().fill(nome);
  await page.getByPlaceholder('13.7563').fill('13.7563');
  await page.getByPlaceholder('100.5018').fill('100.5018');
  await page.getByRole('button', { name: 'Crea il posto' }).click();

  const url = page.locator('.master__url');
  await expect(url).toBeVisible();

  const tagUrl = await url.textContent();
  if (!tagUrl) throw new Error('la pagina master non ha prodotto un URL');
  return tagUrl;
}

test('crea un posto e produce un URL da scrivere sul tag', async ({ page }) => {
  const tagUrl = await creaPosto(page, 'Bangkok');

  // Le tre parti che rendono l'URL quello che è.
  expect(tagUrl).toContain('/p/');
  expect(tagUrl).toContain('?w=');
  expect(tagUrl).toContain('#');
});

test('la chiave di cifratura non arriva mai al server', async ({ page }) => {
  const richieste: string[] = [];
  page.on('request', (request) => richieste.push(request.url()));

  const tagUrl = await creaPosto(page, 'Lisbona');
  const chiave = tagUrl.split('#')[1]!;

  await page.goto(new URL(tagUrl).pathname + new URL(tagUrl).search + '#' + chiave);
  await page.waitForTimeout(1500);

  // Nessuna richiesta, di nessun tipo, deve contenere la chiave.
  for (const url of richieste) {
    expect(url).not.toContain(chiave);
  }
});

test('carica una foto e la ritrova nella griglia', async ({ page }) => {
  const tagUrl = await creaPosto(page, 'Bangkok');
  await page.goto(percorso(tagUrl));

  // Chi arriva dal tag vede il pulsante di caricamento.
  const trigger = page.getByRole('button', { name: '+ Aggiungi foto' });
  await expect(trigger).toBeVisible({ timeout: 15_000 });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'ricordo.png',
    mimeType: 'image/png',
    buffer: PNG_4x4,
  });

  await expect(page.locator('.uploader__status')).toContainText('1 foto aggiunte', { timeout: 20_000 });

  // La foto è nella griglia, ed è stata decifrata: senza chiave l'immagine non
  // comparirebbe affatto.
  const tile = page.locator('.tile').first();
  await expect(tile).toBeVisible();
  await expect(tile.locator('img')).toHaveAttribute('src', /^blob:/);
});

test('il token di scrittura sparisce dalla barra degli indirizzi', async ({ page }) => {
  const tagUrl = await creaPosto(page, 'Bangkok');
  await page.goto(percorso(tagUrl));
  await expect(page.getByRole('button', { name: '+ Aggiungi foto' })).toBeVisible({ timeout: 15_000 });

  // La chiave resta (serve a ricaricare), il token no.
  expect(page.url()).not.toContain('?w=');
  expect(page.url()).toContain('#');
});

test('chi apre il link condiviso legge ma non può caricare', async ({ browser, page }) => {
  const tagUrl = await creaPosto(page, 'Bangkok');
  const condiviso = percorso(tagUrl).replace(/\?w=[^#]*/, '');

  // Contesto nuovo: nessun localStorage, come un telefono che non ha mai visto il tag.
  const altroContesto = await browser.newContext();
  const altraPagina = await altroContesto.newPage();

  await altraPagina.goto(condiviso);
  await expect(altraPagina.locator('.place-header h1')).toHaveText('Bangkok', { timeout: 15_000 });
  await expect(altraPagina.getByRole('button', { name: '+ Aggiungi foto' })).toHaveCount(0);

  await altroContesto.close();
});

test('un link senza chiave lo dice, invece di rompersi', async ({ page }) => {
  const tagUrl = await creaPosto(page, 'Bangkok');
  const senzaChiave = percorso(tagUrl).split('#')[0]!;

  await page.goto(senzaChiave);
  await expect(page.locator('.message h1')).toHaveText('Link incompleto');
});

test('uno slug inventato non rivela niente', async ({ page }) => {
  await page.goto('/p/inventatodinulla#Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDA');
  await expect(page.locator('.message h1')).toHaveText('Posto non trovato');
});

function percorso(tagUrl: string): string {
  const url = new URL(tagUrl);
  return url.pathname + url.search + url.hash;
}
