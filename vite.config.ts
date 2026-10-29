import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

// Tauri espera un puerto fijo y no debe tapar sus propios errores de compilación.
export default defineConfig({
  plugins: [react(), alphaTab()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // alphaTab pesa unos 1,5 MB; en una app de escritorio no importa.
    chunkSizeWarningLimit: 3000,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
