import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import { defineWorkspace } from 'vitest/config';

// Le stesse migrazioni che girano in produzione, applicate al DB di test: se una
// migrazione è sbagliata i test devono accorgersene, non aggirarla con uno schema a mano.
const migrations = await readD1Migrations('./migrations');

export default defineWorkspace([
  {
    // Le librerie del browser: WebCrypto, Blob e canvas finto girano qui.
    test: {
      name: 'lib',
      include: ['tests/lib/**/*.test.ts'],
      environment: 'happy-dom',
    },
  },
  defineWorkersConfig({
    // Il Worker gira dentro workerd vero, con D1 e R2 emulati: quello che passa qui
    // passa anche in produzione.
    test: {
      name: 'worker',
      include: ['tests/worker/**/*.test.ts'],
      setupFiles: ['./tests/worker/setup.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: '2024-12-30',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: ['DB'],
            r2Buckets: ['MEDIA'],
            bindings: {
              TEST_MIGRATIONS: migrations,
              // SHA-256 di "master-di-test". Verificabile con:
              //   node -e "console.log(require('crypto').createHash('sha256').update('master-di-test').digest('hex'))"
              MASTER_TOKEN_HASH: 'fb911d9fa5ff4100174f088ba0e2ad0ee6b579e7ec895af9df113dfdce662b5e',
            },
          },
        },
      },
    },
  }),
]);
