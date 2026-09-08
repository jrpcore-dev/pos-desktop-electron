import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: "src/renderer/preload.js",
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    rollupOptions: {
      external: ["electron"],
    },
    outDir: ".vite/build",
    emptyOutDir: false,
  },
});
