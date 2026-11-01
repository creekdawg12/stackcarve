import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1400
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        // Unhashed so a page cached by GitHub Pages for a few minutes after a deploy still finds its worker.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js'
      }
    }
  }
});
