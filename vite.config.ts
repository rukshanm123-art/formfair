import { defineConfig } from 'vite';

/**
 * FormFair builds as a library, not as a page. Dependencies are left external so a
 * consumer resolves one copy of parse5 and one of axe-core, and so the published
 * bundle stays the analysis code alone.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['parse5', 'axe-core', 'jsdom', /^node:/],
    },
    sourcemap: true,
    target: 'es2022',
  },
});
