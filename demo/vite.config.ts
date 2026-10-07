import { defineConfig } from 'vite';

/**
 * The demonstration interface builds as a SELF-CONTAINED page, which is the opposite of
 * how the library builds.
 *
 * `../vite.config.ts` leaves parse5 external so a consumer resolves one copy. Here parse5
 * is bundled in deliberately: the output has to open from a file:// URL with no server,
 * no install and no network, so that running it cannot send a page's markup anywhere.
 * Nothing in the analysis path is rebuilt or re-implemented - this bundles the same
 * `src/index.ts` the library publishes.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'FormFairDemo',
      fileName: () => 'demo.js',
    },
    outDir: 'build',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      /**
       * parse5 and the analyser ARE bundled, so the page stands alone. jsdom and axe-core
       * are not: the library reaches them only through `await import(...)` inside the
       * delegated provider, which this page never calls. Bundling them would pull a Node
       * DOM implementation into a browser page for code that never runs.
       */
      external: ['jsdom', 'axe-core'],
    },
  },
});
