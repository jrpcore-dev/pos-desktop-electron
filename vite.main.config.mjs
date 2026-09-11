import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "fs";
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
      external: ["electron", "better-sqlite3", "electron-updater", "express"],
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
        try { copyFileSync("src/main/api-server.js", ".vite/build/api-server.js"); } catch(e) {}
        try { copyFileSync("src/main/discovery.js", ".vite/build/discovery.js"); } catch(e) {}
        copyRuntimeDeps(join(buildDir, "node_modules"));
        console.log("Archivos copiados al build exitosamente");
      },
    },
  ],
});
