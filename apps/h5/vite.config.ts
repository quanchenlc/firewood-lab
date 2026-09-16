import { defineConfig } from 'vite';

// GitHub project Pages: https://quanchenlc.github.io/firewood-lab/
export default defineConfig({
  base: '/firewood-lab/',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
