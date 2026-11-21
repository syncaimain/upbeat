import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Dev server port chosen to stay clear of the sibling SmartSpectra projects
// that may run on this machine at the same time.
const DEV_PORT = 5182;

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve('electron/main.ts') } },
    },
  },
  preload: {
    // The window runs with sandbox: true, so the preload must be a single
    // self-contained CommonJS file (the SmartSpectra preload is bundled in).
    build: {
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve('electron/preload.ts') } },
    },
  },
  renderer: {
    root: resolve('src'),
    publicDir: resolve('static'),
    server: { port: DEV_PORT, strictPort: true },
    plugins: [svelte()],
    resolve: { alias: { $config: resolve('config') } },
    build: {
      rollupOptions: { input: { index: resolve('src/index.html') } },
    },
  },
});
