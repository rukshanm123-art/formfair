import { defineConfig } from 'vite';

/**
 * FormFair builds as a library, not as a page. Dependencies are left external so a
 * consumer resolves one copy of parse5 and one of axe-core, and so the published
 * bundle stays the analysis code alone.
 */
export default defineConfig({
  build: {
    lib: {
      // Two entries: the core analyser, and the Node provider that needs jsdom. A
      // consumer of the core package must never pull jsdom in transitively.
      entry: { index: 'src/index.ts', node: 'src/node.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: ['parse5', 'axe-core', 'jsdom', /^node:/],
    },
    sourcemap: true,
    target: 'es2022',
  },
});
