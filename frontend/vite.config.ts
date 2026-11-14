import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/_sketches/**', ...(mode === 'test' ? [] : ['**/tests/**'])] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
}));
