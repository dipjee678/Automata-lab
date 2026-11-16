import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :4000 and is proxied, so the browser only
// ever talks to one origin. For a separate production API set VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 900 },
});
