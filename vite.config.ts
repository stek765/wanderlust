import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Un progetto piccolo: un solo bundle è più veloce da servire di tanti chunk.
    // MapLibre resta separato perché è grosso e la sua cache va tenuta a parte.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('maplibre-gl') ? 'maplibre' : undefined),
      },
    },
  },
});
