"use strict";
// PASO 3 · Auxiliar 2a/2b (kill-switch de rol), movido desde
// C:\Users\jacob\AppData\Local\Temp\opencode\vendia-verify\check-role.cjs.
// Solo lectura sobre src/main/ipc-scopes.js.
//   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-role.cjs
const path = require("path");
const REPO = process.argv[2] || path.resolve(__dirname, "..");
const scopes = require(path.join(REPO, "src/main/ipc-scopes.js"));
console.log("CLIENT_ROLE_ENABLED =", scopes.CLIENT_ROLE_ENABLED);
console.log("ROLES =", JSON.stringify(scopes.ROLES));
console.log("normalizeRole('client') =", JSON.stringify(scopes.normalizeRole("client")));
console.log("normalizeRole('Client') =", JSON.stringify(scopes.normalizeRole("Client")));
console.log("normalizeRole('host') =", JSON.stringify(scopes.normalizeRole("host")));
console.log("normalizeRole(undefined) =", JSON.stringify(scopes.normalizeRole(undefined)));
