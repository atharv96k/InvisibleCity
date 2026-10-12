import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // In development the app calls /api/*; forward it to the Express server.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
