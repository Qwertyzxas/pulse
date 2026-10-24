import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // served from https://<user>.github.io/pulse/
  base: '/pulse/',
  plugins: [vue()],
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5175 },
  preview: { host: '127.0.0.1', port: 4175 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
