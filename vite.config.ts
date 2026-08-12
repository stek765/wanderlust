import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Un progetto piccolo: un solo bundle è più veloce da servire di tanti chunk.
    // MapLibre lo separerebbe già il suo import dinamico; la regola resta perché dà al
    // pezzo grosso un nome riconoscibile, e quando si misura una pagina lenta è la prima
    // cosa che si va a cercare nell'elenco delle richieste.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('maplibre-gl') ? 'maplibre' : undefined),
      },
    },
  },
});
