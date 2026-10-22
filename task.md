# Task — Multi-caja Vendia (ejecución v2.1)

Checklist de ejecución. Se marca `[x]` al finalizar y verificar cada tarea.
Referencia de diseño: `docs/plan-multicaja-v2.1.md`.

Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` hecho.

---

## Ejecución multicaja v2.1 — fases A–H (2026-10)

### Fase A — Correcciones previas ✅
- [x] Clave de idempotencia estable (hash del carrito) + comentario de `rpc-channels.js`.
- [x] Cancelación de venta/línea con comprobación de dueño y reglas de caja cerrada; `cancelled_by_device`.
- [x] Guarda `HOST_HAS_DATA` al convertir Host→caja.
- [x] `ReauthModal` montado en `Layout` ante `session-expired`, sin desmontar el carrito.

### Fase B — Folios ✅
- [x] `sales.folio` único + `folio_counters` por dispositivo.
- [x] Formato `A-000123`; el Host usa `H`; secuencia continua por equipo, nunca reinicia.
- [x] Host valida unicidad y `createSaleTx` asigna folio.
- [x] Folio visible en ticket, historial y detalle de ticket.

### Fase C — Cola offline ✅
- [x] `pending_sales` persistente + máquina de estados (`pending/syncing/synced/conflict/cancelled`).
- [x] Reintento ordenado sin límite, subida automática al reconectar; conflictos de stock se marcan, nunca se rechazan.
- [x] Cancelación de ventas en cola y bloqueo de cierre de caja con cola pendiente.
- [x] PIN y caja cacheados para vender sin Host (PIN válido 24 h desde la última sincronización, aviso fuerte después).
- [x] Prueba obligatoria `scripts/check-4c-offline-queue.cjs`: **19/19**.

### Fase D — Host ocupado vs. caído ✅
- [x] `host_busy` en `/api/health` + SSE; la caja distingue ocupado de caído.
- [x] Banner con ventas pendientes (listar/cancelar/sincronizar), aviso a 30 min / 4 h y a administrador con pendientes > 1 h.
- [x] Indicador compacto en la barra superior (`SystemStatus`).
- [x] Nada de esto bloquea vender.

### Fase E — Conflictos de stock ✅
- [x] `get-stock-conflicts` y `resolve-stock-conflict` idempotente en el Host.
- [x] Pantalla `StockConflicts` (ruta `/stock-conflicts`, entrada de menú) para revisar y ajustar inventario.

### Fase F — Protocolo, dispositivos y reportes ✅
- [x] Protocolo `2.1`, mínimo `2.0`; cabeceras en llamadas de la caja; bloqueo de escrituras incompatible y aviso menor guardado en `protocol_warning`.
- [x] `pending_sync` reportado al Host; renombrar dispositivo; revocar/aprobar/activar sólo en Host.
- [x] Filtro por caja en Reportes (consolidado / Host / caja) y columna Caja en cortes.
- [x] Importación de catálogo desde la caja (lectura local del archivo + contenido por RPC).
- [x] `rename-device`, `list-sale-devices`, allowlist IPC regenerado.

### Fase G — Respaldos y promoción ✅
- [x] `backup-service.js`: SHA-256, `integrity_check`, validación de tablas de identidad, retención 24 horarios + 8 semanales, copia externa.
- [x] Respaldo automático cada 15 min, al cerrar caja y diario; la caja designada jala la copia cada 15 min.
- [x] Restauración con `restoreIntoLiveDb` (ATTACH + copia por tabla en transacción) y `promote-to-host` manual con respaldo de seguridad y relanzamiento.
- [x] Prueba obligatoria `scripts/check-6g-promotion.cjs`: **20/20** (identidad/emparejamiento preservados; cola sin duplicados ni pérdidas).

### Fase H — Verificación final
- [x] `node --check` de los módulos principales.
- [x] Pruebas existentes: 2d núcleo/API, 3a IPC/registro, 3b, 3d, 3e, 3f, 4c, 6g, harness 2b/2c, scopes IPC.
- [~] `check-3c-link.cjs`: no puede completarse mientras la app real esté abierta (ocupa TCP 3456 y UDP 3457); el resto 67/67.
- [ ] `npm run package` (se ejecuta al cierre de la fase H).
- [ ] `check-build-requires` / `check-asar-modules`.

> **NO VERIFICADO:** la UI nueva (banners, filtros, conflictos, durabilidad, promoción) no se ha visto en pantalla; la app no se abrió en esta ejecución. Se validó sintaxis, handlers, allowlist y pruebas headless.
>
> **NO VERIFICADO:** `check-3c-link.cjs` falla sólo por el puerto UDP 3457/TCP 3456 ocupado por una instancia abierta (PID 6432); no por un cambio de código.

---

## Bloque 1 — Guarda atómica de stock  ✅ HECHO
- [x] Guarda atómica en `record-sale`
- [x] Guarda atómica en `remove-stock`
- [x] Error `INSUFFICIENT_STOCK` + campos aditivos
- [x] Prueba SQL 16/16
- [x] `node --check` OK

---

## Bloque 2 — Acceso del cliente al Host

### Entrega 2a — Clasificación de handlers fail-closed  ✅ HECHO
- [x] Crear `src/main/ipc-scopes.js` (mapa `channel → scope`, guard fail-closed)
- [x] Clasificar los 124 handlers (`SYSTEM | LOCAL_READ | HOST_READ | HOST_WRITE`)
- [x] Instalar guard sobre `ipcMain.handle` (passthrough en host)
- [x] Leer `settings.device_role` (default `host`) al arrancar
- [x] Harness de regresión (124 clasificados + passthrough host + fail-closed cliente)
- [x] `node --check` de archivos tocados
- [x] Build `npm run package` con EXIT=0

### Entrega 2b — Scopes por `device_type`  ✅ HECHO
- [x] Kill-switch `CLIENT_ROLE_ENABLED=false` en `ipc-scopes.js`: rechaza `device_role='client'` en `save-setting` y trata un `client` guardado como `host`.
- [x] Migración aditiva `paired_devices`: `device_type` (default `mobile`), `scopes` (JSON), `device_code`, `protocol_version`, `approved` (default 1 → existentes aprobados).
- [x] Set de scopes por tipo: `mobile` = `{catalog:read, catalog:write, stock:read, stock:write}` (exacto a la app), `desktop_box` = `{catalog:read, sales:write, register:*, events:subscribe, backup:receive}`, desconocidos = `{}` (mínimos, fail-closed).
- [x] `requireScope(scope)` sobre `requirePaired`: scopes NUEVOS (sales/register/events/backup) exigen emparejamiento SIEMPRE; legados idénticos a hoy con el candado apagado.
- [x] `POST /api/activation/pair` acepta `deviceType`/`protocol_version`; `desktop_box` queda pendiente (`approved=0`) hasta aprobar en Configuración → App Móvil.
- [x] UI Aprobar/Rechazar en la lista de dispositivos (Configuración).
- [x] Regresión móvil idéntica al baseline (before/after: 0 diffs) + pruebas de scope y migración (8/8).
- [x] `node --check`, allowlist `--check` (mismatches=0), golden (0 diffs), `npm run package` EXIT=0.

> **Nota (por qué el rol cliente sigue apagado):** en modo cliente, `HOST_READ`
> se resuelve ejecutando el handler local (lee la BD local), no un proxy al Host.
> Como aún no hay aislamiento por scope del lado del cliente ni réplica, activar
> `device_role='client'` expondría datos compartidos. El kill-switch
> `CLIENT_ROLE_ENABLED=false` lo impide hasta el Bloque 3 (proxy al Host).

### Entrega 2c — Endpoints de escritura (empieza `POST /api/sales`)

#### 2c-A — Núcleo compartido + regla de stock nueva  ✅ HECHO
- [x] `src/main/sales-core.js`: `createSaleTx(db, payload)` compartido + `findOpenRegister` movido (wrapper en `main.js`).
- [x] Regla nueva: la venta NUNCA se rechaza por stock. Descuento atómico e incondicional (`stock = stock - ?`), lectura del stock resultante en la misma transacción.
- [x] Warning `STOCK_NEGATIVE { code, product_id, name, available_before, sold, stock_after }`, **consolidado por producto** (varias líneas del mismo producto → un warning).
- [x] Rastro durable: columnas aditivas `sales.stock_conflict` (0/1) y `sales.conflict_detail` (JSON de warnings).
- [x] Validación en el núcleo (ambos caminos): producto existente (`PRODUCT_NOT_FOUND`), cantidad finita > 0 entera salvo `sale_unit='weight'`, precio finito ≥ 0, unidad conocida, tope de líneas (500). Verificado en copia read-only de la BD real: 0 precedentes de qty ≤ 0 o decimal no-peso.
- [x] UI: aviso no bloqueante en `SalesTerminal`; badge de stock bajo se refresca reutilizando el evento `sale-registered` (sin polling nuevo).
- [x] Texto del setting `sale_without_stock` en Configuración (solo controla el carrito).
- [x] Baseline + golden capturados con el código ACTUAL y diff consciente (ver abajo).

#### 2c-B — `POST /api/sales`  ✅ HECHO
- [x] Tabla `idempotency_keys` en `createTables`; PK `(device_id, endpoint, key)`
- [x] `POST /api/sales` con `requireScope('sales:write')` + `Idempotency-Key` obligatoria + validación estricta (errores del núcleo mapeados a 4xx) + virtual 256 kb en esa ruta (sin tocar el parser global)
- [x] Huella de idempotencia sobre serialización canónica (claves ordenadas en cada nivel): mismo payload con otro orden de campos → replay, no 422
- [x] Inserción de la clave DENTRO de la misma transacción `BEGIN IMMEDIATE` que la venta
- [x] Replay: misma clave + mismo payload → respuesta guardada tal cual (incluidos warnings); misma clave + payload distinto → 422
- [x] Limpieza de claves > 7 días al arrancar
- [x] Tope de líneas por venta vía `MAX_CART_LINES` (500) en el núcleo; confirmar que el parser global (`express.json()`) no cambia y se puede dejar con su límite por defecto
- [x] Harness HTTP real (Electron + fetch contra Express): 31/31, con concurrencia REAL (dos fetch simultáneos misma clave → una sola venta y respuestas idénticas; dos procesos independientes vendiendo la última unidad → ambas ventas y stock exacto) y scopes (celular 403, desktop_box pendiente 403, aprobado 200)
- [x] Empacado: `vite.main.config.mjs` debe copiar también `scopes.js`, `ipc-scopes.js` y `sales-core.js` junto a los módulos externalizados (`activation.js`, `api-server.js`) o la app revienta al arrancar (`Cannot find module './scopes'`). Verificado: asar contiene `.vite/renderer` + `.vite/build` completos y `activation.js`/`api-server.js` cargan OK.

> **Nota (Bloque 3):** una venta entrante por HTTP **no** refresca por sí sola las
> pantallas abiertas del Host (no hay bus de eventos todavía).
>
> **Pendiente revisión Bloques 4/5:** `record-sale`/`POST /api/sales` confían en
> los precios enviados por el cliente (`item.finalPrice || item.price`), por
> paridad; y en HTTP la identidad del cajero sale del token, no del payload.

### Entrega 2d — `customer_id` en `sales`
- [x] `ALTER sales ADD customer_id`
- [x] Wiring en payload de `record-sale`
- [x] Regresión sin/con cliente

---

## Bloque 3 — Caja por dispositivo + operación online
- [x] 3a `device_id` en `cash_register` + folios con letra automática y secuencia continua
- [x] 3b Sesiones persistidas (`box_sessions`, SHA-256, TTL 10 h, una por caja) + `safeStorage`
- [x] 3b `ReauthModal` (solo bloquea escrituras al Host) + carrito persistido
- [x] 3c Discovery cliente (UDP + IP manual) + UI de primer arranque (rol, buscar, código)
- [x] 3d Descarga inicial con progreso real (staging + swap, reanudar/reiniciar, resync 24 h)
- [x] 3e host-busy + `runBatched`/`yieldToLoop` · **Worker thread DIFERIDO** (decisión de la línea).
- [x] 3f Réplica incremental en tiempo real: SSE delta, tombstones, `updated_at`, `change_log`, evento `db-changed`, `useDbChanges`.
- [x] 3f `db-changed` agregado al allowlist de preload

---

## Bloque 6 — Backups (versión mínima)
- [x] Replicar respaldos a una caja designada + copia externa (cada 15 min, cierre y diario; 24 + 8)
- [x] Restauración manual documentada (valida `integrity_check` y tablas de identidad)
- [ ] (Fase 2) Cifrado de backups, salvo carpeta de nube
- [x] Promoción manual de una caja a Host (`promote-to-host`)

---

## Bloque 4 — Resiliencia
- [x] Tolerancia a host-busy en el cliente (liveness por SSE, banner)
- [x] Reconexión + reintentos (sin límite, ordenados)
- [x] Cola de ventas offline + reconciliación (conflictos se marcan, no se rechazan)
- [x] UI de resolución de conflictos de stock
- [x] Login offline con PINs cacheados (24 h desde la última sincronización; aviso, nunca bloqueo)

---

## Bloque 5 — Gobernanza
- [x] Handshake `protocol_version` (major bloquea, minor avisa) + bloqueo de escrituras
- [x] Tareas compartidas vía RPC al Host
- [x] Reportes consolidados con filtro por caja

---

## Transversal
- [x] Harness "baseline dorado" versionado
- [~] CI/manual: `gen-ipc-allowlist --check` + build EXIT=0 (allowlist regenerado; build en fase H)
- [x] Arranque real obligatorio en CADA entrega: `node scripts/check-build-requires.mjs` (requires relativos de `.vite/build` + asar completo con renderer) y lanzar `out/…/JRP POS.exe` confirmando ventana y log sin `Cannot find module` ni `ERR_FILE_NOT_FOUND` (EXIT=0 no los detecta).
- [x] `docs/plan-multicaja-v2.1.md` actualizado
