import { applyD1Migrations, env } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    MEDIA: R2Bucket;
    MASTER_TOKEN_HASH: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}

// Lo schema dei test è lo stesso della produzione, applicato una volta prima di tutto.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
