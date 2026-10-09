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
- [ ] Tabla `idempotency_keys`
- [ ] `POST /api/sales` con `Idempotency-Key` (reusa guarda de stock)
- [ ] Prueba de paridad local vs HTTP + replay idempotente

### Entrega 2d — `customer_id` en `sales`
- [ ] `ALTER sales ADD customer_id`
- [ ] Wiring en payload de `record-sale`
- [ ] Regresión sin/con cliente

---

## Bloque 3 — Caja por dispositivo + operación online
- [ ] 3a `device_id` en `cash_register` + folios con letra automática y secuencia continua
- [ ] 3b Sesiones persistidas (`box_sessions`, SHA-256, TTL 10 h, una por caja) + `safeStorage`
- [ ] 3b `ReauthModal` (solo bloquea escrituras al Host) + carrito persistido
- [ ] 3c Discovery cliente (UDP + IP manual) + UI de primer arranque (rol, buscar, código)
- [ ] 3d Descarga inicial con progreso real (staging + swap, reanudar/reiniciar, resync 24 h)
- [ ] 3e host-busy + `runBatched`/`yieldToLoop` + Worker para imports/snapshot
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
- [ ] `docs/plan-multicaja-v2.1.md` actualizado (hecho)
