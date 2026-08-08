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
  reporter: [['list']],

  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      // Il dispositivo su cui questa cosa verrà davvero usata.
      name: 'safari-iphone',
      use: { ...devices['iPhone 13'] },
    },
    {
      /*
       * Solo i test marcati [HEIC], e c'è un motivo preciso: Safari l'HEIC lo decodifica
       * da solo, quindi su WebKit il convertitore non verrebbe mai esercitato e un suo
       * guasto passerebbe inosservato. Chrome invece l'HEIC non lo sa leggere: è qui che
       * la conversione o funziona o si vede.
       */
      name: 'chrome-desktop',
      grep: /\[HEIC\]/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    // La radice risponde 200 con il guscio HTML: è l'unica rotta che dice "sono su"
    // senza dipendere da dati nel database.
    url: 'http://127.0.0.1:8788/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
