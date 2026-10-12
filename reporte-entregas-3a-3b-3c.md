# Reporte de entregas — 3a.i, 3b, 3c

Apuntes de verificación. Cada afirmación es `[EJECUTADO]` (salida pegada),
`[LEÍDO EN CÓDIGO]` o `[NO VERIFICADO]`. Sin abrir la app ni probar interfaz.

HEAD al empezar: `c9c161c` (fix de main) ← `3f49afe` ← `3b951a1` ← `d445aa7`
← `f71a790` ← `41ad893`.

---

## ENTREGA 3a.i — caja por dispositivo

**Commit `d190f84` `feat(caja): caja por dispositivo (3a.i)`**

```
 scripts/check-2d-api.cjs      |   3 +-
 scripts/check-3a-ipc.cjs      | 253 ++++++++++++++++++++++
 scripts/check-3a-register.cjs | 437 ++++++++++++++++++++++++++++++++++
 scripts/harness-2c-api.cjs    |   3 +-
 src/main/api-server.js        |   9 +-
 src/main/db-schema.js         |  33 +++-
 src/main/main.js              |  36 ++--
 src/main/sales-core.js        |  36 +++-
 8 files changed, 782 insertions(+), 28 deletions(-)
```
Solo ficheros míos. `TITLEBAR_HEIGHT 48→56` (otro frente) quedó **sin stagear**
y `task.md` re-stageado tras el commit (`M `).

### Qué se hizo
- `db-schema.js`: `ensureHostDeviceId(db)` genera **una sola vez** el id del
  Host (`host-<24 hex>`) y lo guarda en `settings["host_device_id"]`.
  Migración idempotente: `cash_register.device_id TEXT` + backfill de TODAS
  las cajas (abiertas y cerradas) con ese id + `idx_cash_register_device`.
- `sales-core.js`: `findOpenRegister(db, cashierId, role, deviceId)` añade
  `AND device_id = ?` **solo** cuando se pasa `deviceId` (sin deviceId =
  comportamiento legado, intacto). `createSaleTx` gana `deviceId` +
  `requireRegister` → si no hay caja propia lanza `NO_OPEN_REGISTER`
  «Abra caja para vender».
- `main.js`: `hostDeviceId` tras `runMigrations`; el wrapper
  `findOpenRegister(cashierId, role)` pasa el device_id del Host; apertura
  registra `device_id`; auto-cierre, `status`, `previous-today` y el reenganche
  de huérfanas acotados al Host; `migrateRegisterContinuity` conserva la última
  caja **por dispositivo**.
- `api-server.js`: `/api/sales` manda `deviceId: req.deviceId` +
  `requireRegister: true` (el device_id sale del `requirePaired`, nunca del
  body); el gasto de recepción de inventario se acota al device_id del Host.
- Seeds de `harness-2c-api.cjs:64` y `check-2d-api.cjs:34` declaran el
  `device_id` de la caja del fixture (antes quedaba NULL y el filtro estricto
  daría `NO_OPEN_REGISTER`).

### Pruebas `[EJECUTADO]`
- `check-3a-register.cjs` **34 PASS / 0 FAIL**:
  - DDL de HEAD vs actual: solo `cash_register.device_id` + `idx_cash_register_device`.
  - Migración sobre **copia** de `C:\Users\jacob\AppData\Roaming\JRP POS\db\pos-system.db`:
    esquema solo gana esos 2, `integrity_check = ok`, 0 cajas con NULL,
    cajas y ventas intactas, idempotente (2 pasadas),
    `host_device_id = host-2157c04398b5992f23425f08`.
  - Host único: con `deviceId` devuelve la **misma** caja que sin él.
  - Dos dispositivos con caja abierta → cada uno ve la suya y cada venta cae
    en la suya; `box-2` sin caja → `null` y `NO_OPEN_REGISTER`.
  - Venta local del Host fuera de caja → sigue válida (`register_id NULL`).
- `check-3a-ipc.cjs` **26 PASS / 0 FAIL** (carga `src/main/main.js` con
  electron stubbeado y BD temporal; invoca los handlers reales):
  apertura registra el device_id, 2ª apertura auto-cierra **solo** la del Host
  (la de `box-1` sigue abierta), cancelar y cerrar sin cambios, consultas de
  «caja actual» devuelven la del Host.
- Regresión `[EJECUTADO]`: `harness-2c-nucleo` (golden byte-idéntico, 14
  escenarios), `check-2d-nucleo` 12/0, `check-empty-db` 17/0,
  `harness-2c-api` 32/0, `check-2d-api` 25/0, `harness-2b --compare` →
  «baseline before/after idéntico» 8/0, `test-ipc-scopes` 0 diffs,
  `check-main-load` 4/0.

### Llamadores y consultas (archivo:línea) `[LEÍDO EN CÓDIGO]`
- `findOpenRegister`: def. `sales-core.js:23`; uso interno `sales-core.js:98`;
  export `:244`; wrapper del Host `main.js:2111-2112`; llamadores del wrapper
  `main.js:1534` (add-stock), `2660` (register-cash-expense), `2690`
  (get-cash-register-status), `2901` (get-cash-register-expenses); tests
  `check-3a-register.cjs:259-279`.
- «La caja actual» → acotadas al device_id del Host: `main.js:2694`, `2730`,
  `2769` (INSERT con device_id), `2919`, `3505+3528` (continuity por
  dispositivo), `3556`; `api-server.js:363`.
- No son «la caja actual» → intactos: por id `main.js:1538, 1545, 1914, 1989,
  2669, 2674, 2751, 2790, 2840, 2905, 2934, 2942, 2981, 2989, 3026, 3052`;
  reportes/listados `main.js:2147, 2160, 2323, 2355-2356, 2387-2388, 2875,
  3145, 3160-3161`; DDL `db-schema.js`.

### `[NO VERIFICABLE]` en 3a.i
- Arranque con la app real empaquetada (no se abrió la app; la regla).
- Dos dispositivos físicos reales (simulados en harness).
- La BD real de producción: solo se migró una **copia**; el fichero real no
  se tocó.

---

## ENTREGA 3b — sesiones persistidas

**Commit `c036b24` `feat(sesiones): sesiones de caja persistidas (3b)`**

```
 scripts/check-3a-register.cjs           |  34 +++--
 scripts/check-3b-sessions.cjs           | 227 ++++++++++++++++++++++++++++++++
 src/main/api-server.js                  |  73 ++++++++--
 src/main/db-schema.js                   |  14 ++
 src/renderer/components/ReauthModal.jsx | 110 ++++++++++++++++
 src/renderer/lib/cartBackup.js          |  48 ++++++++
 src/renderer/lib/sessionToken.js        |  74 ++++++++++++
 7 files changed, 558 insertions(+), 22 deletions(-)
```

### Qué se hizo
- `db-schema.js`: tabla aditiva `box_sessions(token_hash PK, cashier_id,
  device_id, device_type, created_at, expires_at, last_used_at, revoked)`.
- `api-server.js`: `/api/auth` emite 32 bytes y guarda **solo el sha-256**
  (`activation.hashToken`); TTL 10 h; un login nuevo revoca la sesión anterior
  del mismo `(cashier_id, device_id)`; `requireAuth` hashea el header, valida
  expiración/revocado (401) y actualiza `last_used_at` con throttle de 5 min;
  `stopServer` ya no vacía sesiones → reiniciar el Host no desloguea; poda de
  vencidas al arrancar. Sin canales IPC nuevos ni módulos nuevos en main.
- Piezas de cliente **inertes** (sin montar, sin proxy, sin canales nuevos):
  `src/renderer/lib/sessionToken.js` (token en memoria; si no hay safeStorage
  **no** guarda en claro y lo reporta), `src/renderer/components/ReauthModal.jsx`
  (pad de NIP, «Tu sesión expiró. Confirma tu NIP para continuar. Tu venta sigue
  aquí.», capa superpuesta que no desmonta la venta),
  `src/renderer/lib/cartBackup.js` (respaldo por pestaña en
  `sessionStorage`, clave `vendia:cart-backup:<device_id>`).
- El carrito **no** se persistía hoy (solo claves de UI en localStorage:
  `cartWidth`, `lastPaymentMethod`, `currentCashier`, `themeMode`,
  `eodPendingAction`, `eodWithdrawPrefill`, `scalePort`, `scaleBaud`,
  `stockRegisterExpense`) → el respaldo no duplica nada `[LEÍDO EN CÓDIGO]`.

### Pruebas `[EJECUTADO]`
- `check-3b-sessions.cjs` **31 PASS / 0 FAIL**: token válido tras parar y
  arrancar el servidor sobre la misma BD; en la BD solo el sha-256 (64 hex) y
  ninguna fila contiene el token en claro; vencido → 401 «Sesión expirada» y se
  borra; revocado → 401; vencido en scope nuevo → **401 y no 403**; scope sin
  emparejar → 403; móvil y caja con el mismo header; login nuevo revoca la
  sesión anterior del mismo dispositivo sin tocar la del otro; `last_used_at`
  igual a `created_at` al entrar, sin reescribirse dentro de 5 min y sí al
  pasar; sesión vencida podada al arrancar y las vivas intactas.
- Regresión `[EJECUTADO]`: `harness-2b --compare` (baseline 2b idéntico) 8/0,
  `harness-2c-api` 32/0, `check-2d-api` 25/0, `check-3a-register` 34/0,
  `check-3a-ipc` 26/0, `harness-2c-nucleo` golden OK, `check-2d-nucleo` 12/0,
  `check-empty-db` 17/0, `test-ipc-scopes` 0 diffs, esbuild OK en los 3
  ficheros de cliente.

### `[NO VERIFICADO]` en 3b
- safeStorage real: hoy no hay puente expuesto en el preload, así que el
  módulo informa «safeStorage no disponible» y el token vive solo en memoria
  (nunca en claro).
- Lo visual del `ReauthModal` (no montado) y el respaldo de carrito en una
  pestaña real.
- Un teléfono real conectado (cubierto por el baseline 2b, no por hardware).

---

## ENTREGA 3c — descubrimiento y emparejamiento de una caja

**Commit `abb2d5d` `feat(vinculo): descubrimiento y emparejamiento de cajas (3c)`**

```
 scripts/check-3a-register.cjs             |  14 +-
 scripts/check-3c-link.cjs                 | 317 ++++++++++++++++++++++++++++++
 scripts/ipc-scopes.golden.json            |   6 +
 src/main/activation.js                    |  41 +++-
 src/main/api-server.js                    |  86 +++++++-
 src/main/client-link.js                   | 302 ++++++++++++++++++++++++++++
 src/main/ipc-scopes.js                    |   8 +
 src/main/main.js                          |  28 ++-
 src/main/protocol.js                      |  40 ++++
 src/renderer/components/BoxLinkWizard.jsx | 207 +++++++++++++++++++++
 src/renderer/ipcAllowlist.generated.js    |   6 +
 vite.main.config.mjs                      |   2 +
 12 files changed, 1045 insertions(+), 12 deletions(-)
```
Solo míos. `TITLEBAR_HEIGHT 48→56` (otro frente) y la línea `vendesaldo` de
`vite.main.config.mjs` (otro frente) quedaron **sin stagear**; `task.md`
re-stageado tras el commit (`M `).

### Qué se hizo

- **`src/main/protocol.js` (nuevo)**: `PROTOCOL_VERSION = "2.0"` y
  `MIN_SUPPORTED = "2.0"` (`protocol.js:10-11`); comparación **por número
  MAYOR** (`checkProtocol`, `protocol.js:18`) → `PROTOCOL_MISMATCH` si el
  cliente va más allá de 2.x o por debajo del mínimo. Un cliente que **no
  declara versión** es anterior a 3c y se acepta (así el set móvil actual
  sigue funcionando).
- **`api-server.js`**: `/api/health` (`:436`) conserva `success`/`ok` y
  añade `protocol_version` + `min_supported`; **`GET /api/activation/info`**
  público mínimo (`:447`) → `{protocol_version, min_supported, app_version,
  host_device_id}`; **`GET /api/activation/status`** (`:461`) autenticado solo
  con `x-device-id`/`x-device-token` (sin scopes de ventas, funciona
  pendiente) → `{approved, revoked, device_code, host_device_id,
  protocol_version}`; un **revocado sí puede leer su estado** (solo eso).
  `/api/activation/pair` (`:677`): comprobación de protocolo **antes** de
  contar intentos → **426** `PROTOCOL_MISMATCH` sin emparejar (`:702`);
  401 ahora lleva `code: PAIR_CODE_INVALID`, `attempts_left` y
  `retry_after_ms`; 429 lleva `code: PAIR_RATE_LIMITED` y `retry_after_ms`;
  la respuesta de éxito añade `device_code`, `host_device_id` y
  `protocol_version`. El código **se sigue exigiendo siempre** (el endpoint
  nunca consulta el candado `isEnabled`) y el rate limit sigue intacto.
- **`activation.js`**: `nextDeviceCode(db)` (`:148`) asigna letras
  A, B, C… **sin la H** (`HOST_DEVICE_CODE = "H"`, `:137`;
  `DEVICE_CODE_LETTERS` la excluye, `:138`); si pasan de 25 cajas usa
  `A2, B2…`; se asigna **una sola vez** y se conserva al re-emparejar;
  `registerPairing` devuelve `{deviceId, deviceCode, approved}`.
- **`src/main/client-link.js` (nuevo, lado caja)**: `discoverHosts`
  (`:122`) manda `POS_DISCOVERY` por UDP al 3457, junta `POS_SERVER:ip:port`
  (`udpDiscover`, `:65`), deduplica por `ip:port` y **valida cada candidato**
  con `/api/health` + `/api/activation/info` (`inspectHost`, `:96`); la **IP
  manual** es la alternativa (se valida igual y también se deduplica).
  `pairAsBox` (`:151`) usa `device_id` propio y `deviceType: 'desktop_box'`,
  comprueba el protocolo del Host y guarda `host_url`/`host_device_id` +
  `sync_completed = "0"`. `linkStatus` (`:223`) valida `host_device_id` en
  cada reconexión; `waitForApproval` (`:270`) sondea hasta aprobar/revoke.
  Settings locales (`SETTINGS`, `:21`): `device_role`, `host_url`,
  `host_device_id`, `sync_completed`, más `box_device_id` y
  `box_paired_token`. **Sin `sync_completed = "1"` no se vende** (`canSell`).
  Errores diferenciados: `PAIR_CODE_INVALID` (con intentos y ventana),
  `PAIR_RATE_LIMITED`, `HOST_NOT_FOUND`, `PROTOCOL_MISMATCH`, `PAIR_PENDING`,
  `PAIR_REVOKED`, `HOST_MISMATCH`, `NOT_PAIRED`, `NO_HOST_LINKED`,
  `HOST_UNREACHABLE`.
- **`main.js`**: `require("./client-link")`; `startServer(db, 3456,
  { appVersion: app.getVersion() })`; 6 canales IPC (`main.js:2560-2579`):
  `box-discover-hosts`, `box-pair`, `box-wait-approval`, `box-link-status`,
  `box-get-settings`, `box-save-settings`.
- **Clasificación**: en `ipc-scopes.js` → SYSTEM `box-discover-hosts`,
  `box-pair`, `box-wait-approval`; HOST_READ `box-link-status`,
  `box-get-settings`; HOST_WRITE `box-save-settings`. Allowlist regenerado y
  golden `--update`: **solo aparecen mis 6 canales nuevos**.
- **`vite.main.config.mjs`**: mis 2 líneas de copia (`protocol.js`,
  `client-link.js`); la de `vendesaldo` (otro frente) **no** se stageó.
- **`BoxLinkWizard.jsx` (nuevo)**: asistente de 3 pasos (buscar Host →
  código → aprobación) con los mensajes de cada código de error. **No está
  montado en ninguna ruta**: solo presentación.
- **`check-3a-register.cjs`**: el golden del DDL es **HEAD-relativo**; con
  3b ya commiteado el diff esperado es **vacío** → `DDL_AGREGADO = []`.
  `ESPERADO_B` (migración sobre la BD real) **no cambió**: sigue fijando
  `cash_register.device_id` + `idx_cash_register_device` + `box_sessions`.

### Pruebas `[EJECUTADO]`

- `check-3c-link.cjs` **52 PASS / 0 FAIL**:
  - `/api/health` conserva `success`/`ok` y declara `protocol_version` + `min_supported`.
  - `/api/activation/info` público sin headers, con protocolo, versión del
    build (`appVersion` llega desde `main.js`) y `host_device_id`, y **sin
    más claves** (mínimo).
  - `/api/activation/status` sin headers → 403; con headers →
    `{approved:false, revoked:false, device_code:"A", host_device_id, protocol_version}`;
    token erróneo → 403; **revocado → 200 con `revoked:true`**.
  - `pair` sin código → 400 aunque el candado está **apagado**; código
    malo → 401 `PAIR_CODE_INVALID` con `attempts_left: 4` y `retry_after_ms`;
    5 fallos → 429 `PAIR_RATE_LIMITED` y **no empareja**; protocolo `1.0` →
    426 `PROTOCOL_MISMATCH` y no empareja.
  - `desktop_box` → `pending:true`; primera caja `device_code "A"`, segunda
    `"B"`, re-emparejar conserva `"A"`; `DEVICE_CODE_LETTERS` sin la H y
    códigos únicos en la BD.
  - `client-link`: pendiente y sin vender (`canSell=false`), aprobar →
    `approved`, antes de aprobar → `PAIR_PENDING`, revocar → `PAIR_REVOKED`;
    `pairAsBox` guarda `device_role=client`, `host_url`, `host_device_id`,
    `sync_completed="0"` y rechaza claves desconocidas; con
    `markSyncCompleted(true)` → `canSell=true`.
  - Descubrimiento **UDP en loopback** (responder real de `discovery.js` en
    el 3457) encuentra y valida el Host; **IP manual deduplicada**; sin
    Hosts válidos → `HOST_NOT_FOUND`; Host que declara protocolo `9.0` →
    `PROTOCOL_MISMATCH` desde `pairAsBox`.
  - **Dos Hosts**: el segundo (otra BD, otro `host_device_id`) que también
    tiene emparejada a la misma caja → `HOST_MISMATCH` con `expected`/`got`.
- Regresión `[EJECUTADO]`: `harness-2b --compare` contra un **worktree de
  HEAD `c036b24`** (3b) con `mklink /J` a `node_modules` →
  «baseline before/after idéntico» **8/0**; `harness-2c-api` **32/0**,
  `check-2d-api` **25/0**, `check-2d-nucleo` **12/0**, `check-empty-db`
  **17/0**, `harness-2c-nucleo` golden byte-idéntico (14 escenarios),
  `check-3a-register` **34/0** (con el golden actualizado), `check-3a-ipc`
  **26/0**, `check-3b-sessions` **31/0**, `test-ipc-scopes` **0 diffs**,
  `gen-ipc-allowlist --check` **0 mismatches**, `check-main-load` **4/0**,
  `esbuild` del JSX 0 errores.
- Empaquetado `[EJECUTADO]`: `npm run package` **exit 0** (se empaquetó
  `out/Vendia-win32-x64`); `check-build-requires` **OK** (38 requires
  globales, arranque-list listo). `check-asar-modules` **ignorado por
  petición del usuario** (sus 2 fallos son `express` y `better-sqlite3`,
  externos y excluidos del asar por diseño).

### Llamadores y consultas (archivo:línea) `[LEÍDO EN CÓDIGO]`
- `pair` nunca llama a `activation.isEnabled` → el código se exige siempre
  (`api-server.js:677`).
- `/api/activation/status` autentica contra `paired_devices.paired_token_hash`
  con `timingSafe`, **sin** `deviceScopes` → sin scopes de ventas
  (`api-server.js:461`).
- `registerPairing` conserva `device_code` en el `ON CONFLICT` → el código
  no cambia al re-emparejar; `nextDeviceCode` lee todos los códigos
  existentes (`activation.js:148`).
- `main.js:2560-2579` es el único registrador de los canales `box-*`; el
  asistente del renderer **no** los invoca aún.

### `[NO VERIFICADO]` en 3c
- Lo visual del `BoxLinkWizard` (componente no montado, no se abrió la app).
- Un Host real en otra máquina, un segundo Host físico y cajas físicas
  reales (todo simulado en loopback por el harness).
- Un teléfono real con el set móvil actual (cubierto por el baseline 2b,
  no por hardware).
- Empaquetado en runtime (solo se empaquetó y se inspeccionaron requires).

---

## AMPLIACIÓN — commit `8f6b342` `fix(vinculo): token cifrado con safeStorage y letras solo para cajas (3c)`

**Commit propio** (6 ficheros, +194/−14): `scripts/check-3a-register.cjs`,
`scripts/check-3c-link.cjs`, `src/main/activation.js`, `src/main/client-link.js`,
`src/main/main.js`, `src/renderer/components/BoxLinkWizard.jsx`. Solo míos;
`TITLEBAR_HEIGHT` y `task.md` quedaron como estaban.

### b) ¿Dónde y cómo se guarda `box_paired_token`?

Antes: `activation.setSetting(db, "box_paired_token", token)` → **en claro** en
la tabla `settings`. Ahora `[LEÍDO EN CÓDIGO]`:

- `client-link.js:60` `TOKEN_ENC_PREFIX = "enc:v1:"` + `secretCipher` inyectado.
- `safeStorageCipher()` (`client-link.js:66`) usa
  `electron.safeStorage.encryptString/decryptString` (base64) y devuelve
  **null** si no está disponible (fuera de Electron, `RUN_AS_NODE`, antes de
  `app.ready` o build sin él).
- `main.js` lo inyecta en `app.on("ready")`:
  `clientLink.setSecretCipher(clientLink.safeStorageCipher())`.
- `savePairedToken` (`client-link.js:96`): **solo** escribe
  `enc:v1:<base64>`; sin cipher **borra cualquier resto** y devuelve
  `{persisted:false, reason:"safeStorage no disponible"}` → nunca en claro.
- `readPairedToken` (`client-link.js:110`): devuelve el token **solo** si está
  con el prefijo `enc:v1:` y hay cipher para abrirlo; un **residuo en claro**
  de una versión anterior se **borra** de `settings` y devuelve `null`.
- `linkStatus` sin token desbloqueable → `TOKEN_UNAVAILABLE` (mensaje propio
  en el wizard), no un `NOT_PAIRED` engañoso.
- El cifrado **no sale hacia el renderer**: `getSettings` omite
  `box_paired_token` y sólo informa `tokenPersisted`; `saveSettings` rechaza
  esa clave (sólo `savePairedToken` puede escribirla).

### c) ¿Un celular consume letra? `[EJECUTADO]` — NO

`activation.js:157`: `device_code` = el de la fila si ya existía; si no,
`nextDeviceCode(db)` **sólo** para `device_type = desktop_box`; un `mobile`
usa `generateDeviceCode()` (`D-<6 hex>`), que nunca colisiona con una letra.
Pruebas en `check-3c-link.cjs`:

```
PASS móvil: se empareja aprobado (comportamiento actual)
PASS móvil recibe código D-… (no letra)
PASS el código del móvil no está en el alfabeto de letras de caja
PASS el móvil sigue siendo device_type mobile
PASS primera caja → device_code «A»   ← la caja siguiente sigue siendo «A»
```

### Token cifrado: pruebas `[EJECUTADO]`

```
PASS pairAsBox informa que el token quedó persistido (cifrado)
PASS settings guarda el token con prefijo enc:v1
PASS el token en claro NO aparece en settings
PASS box-get-settings no devuelve el token
PASS sin cipher → TOKEN_UNAVAILABLE (no se usa token en claro)
PASS sin cipher no se escribe ningún token en settings
PASS restaurado el cipher, el token vuelve a guardarse cifrado
PASS un token en claro NO se devuelve
PASS y además se BORRA de settings
```
(El harness inyecta un cifrador de prueba porque con `RUN_AS_NODE` no hay
`safeStorage`; en la app real lo inyecta `main.js`.)

### `check-3a-register` adaptado `[EJECUTADO]`

La **BD real ya viene migrada** (la app corrió en esta máquina:
`box_sessions`, `cash_register.device_id` e `idx_cash_register_device` ya
están; `host_device_id = host-8f984c39ec1cbfeec5dd9b81`, distinto del de antes,
y `integrity_check = ok` — inspección **solo lectura**). El chequeo B ahora
distingue ambos casos: BD sin migrar → gana lo declarado; BD ya migrada →
**la migración no cambia nada** y se comprueba además el **contenido** del
esquema terminado. Pasa de 34 a **35 PASS / 0 FAIL**.

### Regresión y empaquetado `[EJECUTADO]`
- `check-3c-link.cjs` **69 PASS / 0 FAIL**; `check-3a-register` **35/0**;
  `check-3a-ipc` **26/0**; `check-3b-sessions` **31/0**; `check-2d-api` **25/0**;
  `check-2d-nucleo` **12/0**; `check-empty-db` **17/0**;
  `harness-2c-nucleo` golden byte-idéntico; `harness-2c-api` **32/0** en 3
  corridas seguidas; `test-ipc-scopes` 0 diffs; `check-main-load` **4/0**;
  `esbuild` del JSX 0 errores.
- `harness-2b --compare` contra un worktree de **HEAD `abb2d5d`** →
  «baseline before/after idéntico» **8/0** (el móvil sigue pareando igual).
- **`npm run package` FALLÓ** esta vez con
  `EPERM: unlink '.vite\build\node_modules\better-sqlite3\build\Release\better_sqlite3.node'`:
  hay una **app de desarrollo abierta** (`electron-forge start`, pids
  3472/19856/11940 y electron 11940/4016/1528/6924) que bloquea el binario.
  **No la maté** porque es tuya. `check-build-requires` sigue **OK** sobre el
  build anterior (el empaquetado válido es el de `abb2d5d`): al cerrar la app
  se repite el `package`.

### `[NO VERIFICADO]` en la ampliación
- `safeStorage` real de Electron: el cifrado se probó con un cipher inyectado;
  el camino `safeStorage.encryptString` sólo está leído en código (el harness
  corre con `RUN_AS_NODE`, donde no hay `safeStorage`).
- Volver a empaquetar con `8f6b342` (bloqueado por la app abierta).

---

## Entrega 3d · réplica Host→caja: change_log, snapshot/changes y descarga inicial

Commit **`0e69694`** (`replica(3d): change_log, snapshot/changes y descarga inicial con staging+swap`).

### Qué incluye
- **`src/main/db-schema.js`** — `ensureChangeLog()`, llamado al final de `runMigrations`:
  tabla `change_log(seq PK AUTOINCREMENT, tbl, row_id, op, ts)`, índice
  `idx_change_log_tbl_row(tbl,row_id)` y **27 triggers** `trg_change_log_<tabla>_<op>`
  (9 tablas × insert/update/delete). `replicaPlan(db)` devuelve las columnas
  replicables de cada tabla.
- **`src/main/api-server.js`** — `GET /api/replica/snapshot` y `GET /api/replica/changes`,
  con `protectBox(SCOPE.CATALOG_READ)`.
- **`src/main/replica-engine.js`** (nuevo) — `state/setState/ensureStaging/clearStaging/
  swap/downloadSnapshot/applyChanges/resetSync/isStale`.
- **`src/main/main.js`** — handlers `replica-status` (LOCAL_READ), `replica-sync-now` y
  `replica-reset` (SYSTEM) + coalescer `emitDbChanged` → evento `db-changed` (~150 ms,
  `{tables, ids, at}`).
- **`src/renderer/lib/useDbChanges.js`** (nuevo) + adopción en el badge de stock bajo
  (`Layout.jsx`) y en `SalesTerminal.jsx` (`catalogVersion` en las deps de
  `[barcode, catalogVersion]`). El polling se conserva como respaldo.
- **`vite.main.config.mjs`** — línea de copia de `replica-engine.js`.
- **`scripts/check-3d-replica.cjs`** (nuevo, 522 líneas).

### Decisiones que quedan fijadas
- **No se replican costos**: `products.cost_price` queda fuera del plan (en la caja vale 0).
- **No se replican PINs**: `REPLICATED_CASHIER_COLUMNS = id,name,role,is_active`.
- `settings` sólo entrega `REPLICATED_SETTINGS_KEYS`; tokens, códigos y demás claves
  **jamás salen del Host**.
- `snapshot_seq` se fija en la primera página y se reenvía en las siguientes: el corte
  no se desplaza al paginar.
- `/changes` con `since` por debajo del hueco compactado →
  `{resync: true, code: "LOG_COMPACTED"}`.
- Fila ya borrada al leerla → se envía como `delete`.
- Staging `stg_replica_<tabla>` **conservado entre ejecuciones**: la descarga es
  **reanudable** por cursor persistido (`replica_cursor_<tabla>`).
- Swap + `markSyncCompleted(true)` + estado en **una sola transacción** `exclusive()`;
  `sync_completed` sólo llega a 1 tras el swap completo.
- Resync completo a las 24 h (`RESYNC_AFTER_MS`).

### Medidas `[EJECUTADO]`
- Coste de los triggers en una venta: **+0,16 a +0,30 ms** por venta (51 eventos en
  50 ventas) → intrascendente.
- Coste en un import de **27 000** productos: **+1,1 s a +3,7 s** (41-135 µs/fila).
  Es el motivo de proponer el **marcador `'bulk'`** para la 3e: durante un import el
  Host debería silenciar el log y emitir un único evento en lugar de 27 000.
- Migración sobre copia de la BD real: datos intactos, `integrity_check ok`, y la BD
  gana exactamente `change_log` + su índice + los 27 triggers.

### Dos correcciones hechas durante la entrega `[LEÍDO EN CÓDIGO]`
- **Paginación**: al paginar por cursor (`id > cursor`), una fila escrita *después* puede
  entrar en una página posterior; eso **no es un fallo**. La garantía real es que
  `snapshot_seq` queda fijo y el log cubre ese cambio, así que la caja no la acaba teniendo
  dos veces. El harness lo comprueba así (la aserción inicial, que negaba la entrada,
  era mía y estaba mal).
- **Autenticación**: la primera versión usaba `protect()` (sesión de cajero en
  `box_sessions`), pero una caja **no inicia sesión de cajero**: sólo tiene su
  `paired_token`. Se añadió `protectBox()` = `requirePairedApproved` + `requireDeviceScope`,
  que exige emparejamiento válido, dispositivo **aprobado** y el scope `catalog:read` del
  tipo `desktop_box`. Por eso el endpoint responde **403**, no 401, a un dispositivo sin emparejar.

### Regresión y empaquetado de la 3d `[EJECUTADO]`
| chequeo | resultado |
|---|---|
| `check-3d-replica` | **64 PASS / 0 FAIL** |
| `check-3a-register` | **35/0** (golden del DDL actualizado: los 29 statements nuevos declarados) |
| `check-3a-ipc` | **26/0** |
| `check-3b-sessions` | **31/0** |
| `check-2d-api` | **25/0** |
| `check-2d-nucleo` | **12/0** |
| `check-empty-db` | **17/0** |
| `check-main-load` | **4/0** |
| `harness-2c-api` | **32/0** en 3 corridas seguidas |
| `harness-2c-nucleo` | golden **byte-idéntico** |
| `harness-2b --compare` | **8/0**, baseline before/after idéntico |
| `test-ipc-scopes` | **0 diffs** (golden: `replica-status`=local_read, `replica-sync-now`/`replica-reset`=system) |
| `gen-ipc-allowlist --check` | **0 mismatches** (3 invoke + el evento `db-changed`) |
| `esbuild` del JSX | **0 errores** |

- **`npm run package` EXIT=0** y **`check-build-requires` EXIT=0** (46 requires globales).
  ⚠ hay que correrlo con **Node normal, no con `ELECTRON_RUN_AS_NODE`**: Electron parchea
  `fs` para entender `.asar`, así que un `statSync` sobre `app.asar` devuelve
  «directorio, size 0» en lugar del fichero de 35 MB y el chequeo acusa falsamente
  «no hay app.asar».
- `replica-engine.js` confirmado **dentro del `app.asar`** empaquetado (2035 archivos),
  lo que valida la línea de copia en `vite.main.config.mjs`.

### Incidente con `node_modules` — error mío `[EJECUTADO]`
Para comparar el `harness-2b` contra HEAD creé un worktree temporal y enlacé `node_modules`
dentro con **`mklink /J`**. Después ejecuté `git worktree remove --force`: Git en Windows
recorre el junction como directorio normal y **borró el contenido real**. Ese fue el vaciado.
No vuelvo a combinar junctions dentro de un worktree con borrado forzado.

La reinstalación topó con dos políticas **nuevas de npm 12** que no existían cuando se
instaló el proyecto originalmente:
1. `allow-git` cambió su defecto a `none` → rechaza `@electron/node-gyp`, que está
   declarado como dependencia git. Se resolvió con `--allow-git=all` **por comando**
   (sin persistir) más una reescritura `ssh→https` limitada a ese proceso vía
   `GIT_CONFIG_*`, sin tocar el git global.
2. `allow-scripts` bloqueó los 6 scripts de instalación → `electron` sin binario y
   `better-sqlite3` sin compilar. Se aprobaron **uno a uno** (`npm install-scripts approve`),
   nunca con la opción global de «permitir todo».

Reinstalado limpio desde el lockfile: **1093 paquetes, EXIT=0**. Después hizo falta
**`electron-rebuild -f -w better-sqlite3`**: `npm rebuild` lo compila contra el Node del
sistema (NODE_MODULE_VERSION 137) y los harnesses corren bajo Electron 37 (136), así que
sin ese paso todos fallan con «compiled against a different Node.js version».

Dos apuntes añadidos:
- `npm install-scripts approve` **escribió un bloque `allowScripts` en `package.json`**
  (único cambio de ese fichero; el lockfile quedó intacto). Sin él, la próxima
  instalación vuelve a bloquear esos scripts. Está pendiente de decidir si se conserva.
- También quedó un `lucide-react` a medias del primer `npm ci` interrumpido (le faltaba
  `dist/esm/lucide-react.mjs`), que rompía el empaquetado con
  «Failed to resolve entry for package "lucide-react"». Apareció y se reparó con el
  reinstalado limpio.

### `[NO VERIFICADO]` en la 3d
- `safeStorage` real de Electron: sigue sin probarse en vivo (el harness corre con
  `RUN_AS_NODE`, donde no hay `safeStorage`). Sólo leído en código.
- El motor **en vivo** de la caja (backoff, polling 3-5 s y el catch-up antes de vender)
  queda para la 3f; en esta entrega sólo está la descarga inicial y `applyChanges`.
- Compactación del log: el endpoint ya devuelve `LOG_COMPACTED`, pero el proceso que
  poda el `change_log` aún no existe (3f).

---

## Entrega 3e · SSE `/api/events`, filtro de fila replicable, `runBatched` y modo lote

Commit **`8243491`** `replica(3e): SSE /api/events, filtro de fila replicable, runBatched y modo lote`

```
 scripts/check-3a-register.cjs |  24 +-
 scripts/check-3d-replica.cjs  |   6 +-
 scripts/check-3e-events.cjs   | 558 ++++++++++++++++++++++   (nuevo)
 src/main/api-server.js        |  88 ++++++-
 src/main/batch-runner.js      |  59 +++++   (nuevo)
 src/main/change-stream.js     | 208 ++++++++++++++   (nuevo)
 src/main/db-schema.js         | 175 ++++++++++++++++-
 src/main/main.js              |  77 ++++---
 vite.main.config.mjs          |   2 +
 9 files changed, 1139 insertions(+), 58 deletions(-)
```

Sólo ficheros míos. `TITLEBAR_HEIGHT 48→56` (`src/main/main.js`) y la línea `vendesaldo`
de `vite.main.config.mjs` —ambas de otros frentes— quedaron **sin stagear**: tras el
commit siguen como ` M` en el árbol.

### Qué incluye

- **`src/main/change-stream.js`** (nuevo) — `createChangeStream({db, changeLogTable,
  getSetting, coalesceMs, heartbeatMs})`. Un **único** sonda mira `change_log` cada
  150 ms y escribe a todas las cajas: `hello` (al conectar), `changes` (coalescido),
  `resync`, `busy`, `ready` y `heartbeat`. El `id` de cada frame **es** el `seq`, así
  que la caja reanuda sólo con `Last-Event-ID` y el Host no guarda estado por cliente
  más allá de su cursor. Temporizadores con `unref()` para que los harness salgan limpios.
- **`src/main/batch-runner.js`** (nuevo) — `runBatched(items, worker, {batchSize})` y
  `yieldToLoop()`: trocea la carga y cede el hilo con `setImmediate` entre lotes.
- **`src/main/db-schema.js`** — `REPLICATED_FILTERS` (descriptor `is_active = 1`),
  `replicaFilterSql`, `changeLogRowId`, `changeLogLeaveTrigger` → **28 triggers**;
  `beginBulk`/`endBulk` con `BULK_MIN_ROWS = 1000`; `ensureChangeLog` recupera un lote
  que quedó abierto por una caída.
- **`src/main/api-server.js`** — `GET /api/events` con
  `protectBox(SCOPE.EVENTS_SUBSCRIBE)`; `replicaWhere` aplicado también a `total`,
  `readRow` y `pageOf`; el sonda arranca y para con el servidor; `hostBusy`/`hostReady`
  y `getStatus().events`.
- **`src/main/main.js`** — los imports troceados con `runBatched`, envueltos en
  `hostBusy`/`hostReady` + `beginBulk`/`endBulk` dentro de `finally`; `seedCatalogIfEmpty`
  es async y se espera dentro de `app.on("ready", async …)`, así que el orden de arranque
  (catálogo antes de crear ventana) no cambia.
- **`vite.main.config.mjs`** — `change-stream.js` y `batch-runner.js` en la lista de copia.
- **`scripts/check-3e-events.cjs`** (nuevo, 66 aserciones), `check-3d-replica` 27→28 en
  tres sitios, y el golden de `check-3a-register`.

### Decisiones que quedan fijadas `[LEÍDO EN CÓDIGO]`

1. **El filtro es `is_active = 1`, no `is_catalog = 0`.** En la BD real hay **4
   productos con `is_active = 1` Y `is_catalog = 1`** (ids 5, 9, 10, 30350) que un
   filtro por catálogo habría dejado de vender en las cajas. El criterio lo ancla la
   propia app, que ya pregunta «¿se vende?» con `is_active = 1` en `api-server.js`
   (búsqueda y `/:barcode`) y en `main.js` (listados). `[EJECUTADO]` sobre la BD real
   (`sólo lectura`): 27 298 productos, 21 activos, 4 de ellos también en catálogo.
2. **`REPLICATED_FILTERS` es la única fuente.** De ahí sale el `WHEN` de los triggers,
   la cláusula de `snapshot`/`changes` y el predicado del golden: no pueden desviarse.
3. **El `NULL` no viaja.** `is_active INTEGER DEFAULT 1` es nullable, y `COALESCE(is_active, 0) = 1`
   evita que un `NULL` se cuele en un upsert. La baja (1 → 0) se entrega como `delete`;
   el alta (0 → 1), como `upsert`.
4. **El `linkActive` del catálogo sí emite `upsert`** (sigue en el conjunto y cambian
   `cat_name`/`ref_unit`); lo crítico es que **no** emita `delete`.
5. **Modo lote en dos tiempos.** `beginBulk` escribe la bandera `replica_bulk_active`
   **antes** de apagar los triggers; `endBulk` deja **una sola** marca `op='bulk'`
   (`tbl='__bulk__'`), fija `change_log_first_seq` al `seq` de esa marca, recrea los
   triggers **antes** de borrar la bandera (orden anti-caída) y devuelve el `seq`.
   Por debajo de `BULK_MIN_ROWS = 1000` no compensa y el delta sigue fino.
6. **SSE y no WebSocket:** la caja sólo recibe, el protocolo ya trae reanudación y
   reconexión, y pasa por proxies sin *upgrade*. El heartbeat es un **evento real**,
   no un comentario `: hb`, para que la caja pueda medir su propio retraso.
7. **`hostBusy`/`hostReady` en todos los imports** (cualquier import bloquea el bucle),
   pero el modo lote sólo se arma por encima del umbral.
8. **Sin canales IPC nuevos** → ni `ipc-scopes`, ni el golden, ni la allowlist cambian.

### Bugs encontrados y corregidos en el camino `[EJECUTADO]`

- **El filtro por catálogo habría dejado de vender 4 productos reales.** Detectado al
  consultar la BD: 4 filas son activas *y* constan en el XLSX. Rediseñado como `is_active`.
- **`bulkFlagSet(db, "0")` cerraba mal el segundo lote.** En JS `"0"` es *truthy*:
  `beginBulk` de la segunda importación habría devuelto `false` y los triggers habrían
  seguido encendidos. Ahora la bandera se `DELETE`a: es `"1"` o inexistente, nunca `"0"`.
- **`check-3a-register` fallaba por espacios donde el DDL lleva `\n`.** `sqlite_master`
  conserva los saltos de línea del generador (`ON products\nWHEN…`): separadores `\s+`.
- **`replicaStreamStats` estaba exportada sin llamador.** Conectada a `getStatus()`
  (`events: {clients, last_seen, busy, …}`) en vez de dejar código muerto.
- **`check-3a-register` seguía describiendo la delta de la 3d** (heredado de `0e69694`).
  Tras commitear la 3e se reseteó a delta vacío, para que la prueba pase en árbol limpio
  y la próxima entrega declare ahí la suya.

### Pruebas `[EJECUTADO]`

```
ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\check-3e-events.cjs
=== 3e: 66 PASS / 0 FAIL ===   (EXIT=0)
```

| Sección | n | Qué cubre |
|---|---:|---|
| A · filtro de fila | 14 | snapshot sólo vendibles; `total` ≠ tamaño de tabla; `is_active` como columna; filas inactivas mudas en triggers y en `/changes`; 0→1 = upsert; 1→0 = delete con `row_id`; `linkActive` sin delete; borrar inactivo no genera eventos |
| B · SSE | 17 | 403 sin emparejar; `text/event-stream`; `hello` con `id=seq`; `changes` con tablas; **60 escrituras → UN solo frame**; reanudación por `Last-Event-ID` sin reenvíos; `resync LOG_COMPACTED` bajo hueco; `busy`/`ready` con motivo y seq; heartbeat < 7 s **como evento** |
| C · runBatched | 11 | primer lote síncrono; cede el hilo antes del 2.º (4 lotes = 3 cesiones); 25 elementos en orden sin pérdidas; resumen `{batches, processed, ms}`; vacío → 0 lotes; `TypeError` con argumentos malos; `batchSize` inválido → default 500 |
| D · modo lote | 24 | triggers apagados y **0 eventos** durante el lote; idempotencia de `beginBulk`/`endBulk`; **exactamente 1 marca `bulk`**; `first_seq` = su `seq`; bandera **borrada**; caja conectada → `busy` → `ready` → `resync` automático; `/changes` bajo la marca → `LOG_COMPACTED` y desde la marca en adelante normal; 28 triggers restaurados; y la recuperación por caída (lote abierto → marca + hueco adelantado + bandera borrada + triggers) |

### Regresión y empaquetado `[EJECUTADO]`

Todos `EXIT=0`:

| Harness | Resultado |
|---|---|
| `check-3d-replica` | 64 PASS / 0 FAIL |
| `check-3e-events` | 66 PASS / 0 FAIL |
| `check-3c-link` | 69 PASS / 0 FAIL (antes `EADDRINUSE :3457`, por la app en marcha) |
| `check-3a-register` | 35 PASS / 0 FAIL |
| `check-3b-sessions` | 31 PASS / 0 FAIL |
| `check-3a-ipc` | 26 PASS / 0 FAIL |
| `check-empty-db` | 17 PASS / 0 FAIL |
| `check-2d-nucleo` | 12 PASS / 0 FAIL |
| `check-main-load` | 4 PASS / 0 FAIL (bundle fresco) |
| `check-2d-api` · `check-role` · `harness-2b` · `harness-2c-nucleo` · `harness-2c-api` | 0 fallos |
| `test-ipc-scopes` · `gen-ipc-allowlist --check` | 0 diffs · 0 mismatches |
| `npm run package` | EXIT=0 |
| `check-build-requires` (**Node normal**, no `ELECTRON_RUN_AS_NODE`) | `OK · arranque-list@` |

Comprobación adicional del artefacto `[EJECUTADO]`: leyendo `app.asar` por el offset de
su header, los cuatro ficheros —`change-stream.js`, `batch-runner.js`, `api-server.js`,
`db-schema.js`— están dentro **byte a byte iguales a `src`**, y el `main.js` del bundle
pide `./batch-runner` mientras que `api-server.js` pide `./change-stream`.
(`check-asar-modules` no se ejecuta, por decisión de la línea.)

### `[NO VERIFICADO]` en la 3e
- `safeStorage` real de Electron (heredado de 3c/3d): el harness corre con `RUN_AS_NODE`,
  donde no existe.
- El **consumidor** del SSE: 3e entrega el lado Host. La caja que se suscriba y el
  reemplazo de `db-changed` quedan para la 3f.
- La compactación que sube `change_log_first_seq` sigue sin existir (3f): aquí sólo se
  ha implementado y probado el **consumo** de ese hueco (`LOG_COMPACTED`).
- Latido y coalescencia con la app real abierta y varias cajas a la vez (el harness
  levanta una sola caja simulada y mide contra reloj propio).
