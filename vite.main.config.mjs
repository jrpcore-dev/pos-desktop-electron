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
        try { copyFileSync("src/main/activation.js", ".vite/build/activation.js"); } catch(e) {}
        try { copyFileSync("src/main/scopes.js", ".vite/build/scopes.js"); } catch(e) {}
        try { copyFileSync("src/main/ipc-scopes.js", ".vite/build/ipc-scopes.js"); } catch(e) {}
        try { copyFileSync("src/main/sales-core.js", ".vite/build/sales-core.js"); } catch(e) {}
        try { copyFileSync("src/main/db-schema.js", ".vite/build/db-schema.js"); } catch(e) {}
        try { copyFileSync("src/main/discovery.js", ".vite/build/discovery.js"); } catch(e) {}
        try { copyFileSync("src/main/pins.js", ".vite/build/pins.js"); } catch(e) {}
        try { copyFileSync("src/main/protocol.js", ".vite/build/protocol.js"); } catch(e) {}
        try { copyFileSync("src/main/client-link.js", ".vite/build/client-link.js"); } catch(e) {}
        try { copyFileSync("src/main/replica-engine.js", ".vite/build/replica-engine.js"); } catch(e) {}
      try { copyFileSync("src/main/replica-live.js", ".vite/build/replica-live.js"); } catch(e) {}
        try { copyFileSync("src/main/change-stream.js", ".vite/build/change-stream.js"); } catch(e) {}
        try { copyFileSync("src/main/batch-runner.js", ".vite/build/batch-runner.js"); } catch(e) {}
        copyRuntimeDeps(join(buildDir, "node_modules"));
        console.log("Archivos copiados al build exitosamente");
      },
    },
  ],
});
