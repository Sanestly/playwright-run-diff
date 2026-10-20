import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Serves generated real fixtures under /sample-a/..., /identical/...
  // so "Try sample" works offline against checked-in traces.
  publicDir: resolve(root, '../../fixtures/generated'),
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    },
  },
});
