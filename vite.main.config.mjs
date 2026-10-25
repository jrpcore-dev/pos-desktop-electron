import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { copyRuntimeDeps } from "./scripts/copy-runtime-deps.mjs";

export default defineConfig({
  resolve: {
    browserField: false,
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
    build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/main/main.js",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: ["electron", "better-sqlite3", "electron-updater", "express", "serialport"],
    },
  },
  plugins: [
    {
      name: "copy-main-files",
      writeBundle() {
        const buildDir = ".vite/build";
        const buildDbDir = ".vite/build/db";
        mkdirSync(buildDbDir, { recursive: true });
        try { copyFileSync("src/db/database.js", ".vite/build/db/database.js"); } catch(e) {}
        try { copyFileSync("src/db/pos-system.db", ".vite/build/db/pos-system.db"); } catch(e) {}
        // A5 · TODOS los .js de src/main, sin lista manual. La lista anterior
        // se nos ha roto el build tres veces (la última, faltaba replica-live.js
        // y `check-build-requires` sólo lo veía al empaquetar). `main.js` es la
        // entrada del bundler: copiarla encima BORRARÍA el bundle, así que
        // queda fuera de propósito.
        for (const f of readdirSync("src/main")) {
          if (!f.endsWith(".js") || f === "main.js") continue;
          try { copyFileSync(`src/main/${f}`, `${buildDir}/${f}`); } catch(e) {}
        }
        copyRuntimeDeps(join(buildDir, "node_modules"));
        console.log("Archivos copiados al build exitosamente");
      },
    },
  ],
});
