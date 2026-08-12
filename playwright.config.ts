import { defineConfig, devices } from '@playwright/test';

/**
 * Test end-to-end contro il Worker in locale, con D1 e R2 emulati.
 *
 * Il profilo è un iPhone: è l'unico dispositivo su cui questa cosa verrà davvero usata,
 * e provarla a 1440px di larghezza non direbbe niente di utile.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false, // un solo database locale condiviso
  workers: 1,
  /*
   * Un ritentativo, e solo per un motivo: il test marcato [WEBGL] gira su swiftshader,
   * cioè WebGL emulato via software, che sotto il carico degli altri quindici test ogni
   * tanto non riesce a inizializzare il contesto. Quando succede MapScene non parte e la
   * fascia non compare — comportamento corretto del prodotto, ambiente inaffidabile.
   * Visto fallire una volta su tre corse complete, mai da solo.
   */
  retries: 1,
  reporter: [['list']],

  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      // Il dispositivo su cui questa cosa verrà davvero usata.
      name: 'safari-iphone',
      // Tutto tranne i test che pretendono WebGL: WebKit headless non ce l'ha, quindi lì
      // la mappa non parte proprio e la fascia non esiste. È il comportamento voluto, non
      // un guasto — vedi la regola sul contenuto che non dipende dalla messa in scena.
      grepInvert: /\[WEBGL\]/,
      use: { ...devices['iPhone 13'] },
    },
    {
      /*
       * Due famiglie di test girano qui e non su Safari.
       *
       * [HEIC]: Safari l'HEIC lo decodifica da solo, quindi su WebKit il convertitore non
       * verrebbe mai esercitato e un suo guasto passerebbe inosservato. Chrome invece
       * l'HEIC non lo sa leggere: è qui che la conversione o funziona o si vede.
       *
       * [WEBGL]: WebKit headless non ha WebGL, quindi la mappa non parte proprio e la
       * fascia non esiste. Chrome con swiftshader ce l'ha, seppure via software.
       */
      name: 'chrome-desktop',
      grep: /\[HEIC\]|\[WEBGL\]/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],

  webServer: {
    /*
     * Porta esplicita e database separato, e non `npm run dev`. Due difetti in una riga:
     *
     * - wrangler sceglie 8787 e slitta alla prima libera se è occupata, quindi con un
     *   server di sviluppo già aperto a mano i test finivano sulla porta sbagliata;
     * - senza `--persist-to`, D1 e R2 emulati sono gli STESSI dello sviluppo, e ogni
     *   corsa lasciava quindici viaggi di prova dentro il database vero. Succedeva
     *   davvero, e sono stati trovati a mano.
     */
    command: 'npm run dev:prove',
    // La radice risponde 200 con il guscio HTML: è l'unica rotta che dice "sono su"
    // senza dipendere da dati nel database.
    url: 'http://127.0.0.1:8788/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
