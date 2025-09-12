import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Note: proxy helps avoid CORS in dev. Disable if not needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/bybit': {
        target: 'https://api.bybit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bybit/, ''),
        secure: true
      }
    }
  }
});

