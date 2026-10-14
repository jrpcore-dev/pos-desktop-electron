# Task — Multi-caja Vendia (ejecución v2.1)

Checklist de ejecución. Se marca `[x]` al finalizar y verificar cada tarea.
Referencia de diseño: `docs/plan-multicaja-v2.1.md`.

Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` hecho.

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
- [ ] 3a `device_id` en `cash_register` + folios con letra automática y secuencia continua
- [ ] 3b Sesiones persistidas (`box_sessions`, SHA-256, TTL 10 h, una por caja) + `safeStorage`
- [ ] 3b `ReauthModal` (solo bloquea escrituras al Host) + carrito persistido
- [ ] 3c Discovery cliente (UDP + IP manual) + UI de primer arranque (rol, buscar, código)
- [ ] 3d Descarga inicial con progreso real (staging + swap, reanudar/reiniciar, resync 24 h)
- [ ] 3e host-busy + `runBatched`/`yieldToLoop` · **Worker thread DIFERIDO**: no hace falta para la primera prueba con 2 PCs (decisión de la línea); `runBatched` basta para los imports. Revísalo si un import llega a congelar la app.
- [ ] 3f Réplica incremental en tiempo real: SSE delta, tombstones, `updated_at`, `change_log`, evento `db-changed`, `useDbChanges` (sin reescribir pantallas)
- [ ] 3f `db-changed` agregado al allowlist de preload

---

## Bloque 6 — Backups (versión mínima)
- [ ] Replicar respaldos a una caja designada + copia externa
- [ ] Restauración manual documentada
- [ ] (Fase 2) Cifrado de backups, salvo carpeta de nube

---

## Bloque 4 — Resiliencia
- [ ] Tolerancia a host-busy en el cliente (liveness por SSE, banner)
- [ ] Reconexión + reintentos
- [ ] Cola de ventas offline (solo desde este bloque) + reconciliación
- [ ] UI de resolución de conflictos (stock/folios)
- [ ] Login offline con PINs cacheados (hash replicado, umbral 4 h)

---

## Bloque 5 — Gobernanza
- [ ] Handshake `protocol_version` (major bloquea, minor avisa) + bloqueo de escrituras
- [ ] Tareas compartidas vía Host
- [ ] Reportes consolidados

---

## Transversal
- [ ] Harness "baseline dorado" versionado
- [ ] CI/manual: `gen-ipc-allowlist --check` + build EXIT=0
- [x] Arranque real obligatorio en CADA entrega: `node scripts/check-build-requires.mjs` (requires relativos de `.vite/build` + asar completo con renderer) y lanzar `out/…/JRP POS.exe` confirmando ventana y log sin `Cannot find module` ni `ERR_FILE_NOT_FOUND` (EXIT=0 no los detecta).
- [ ] `docs/plan-multicaja-v2.1.md` actualizado (hecho)
