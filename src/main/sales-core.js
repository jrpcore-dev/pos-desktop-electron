"use strict";

// ─── Núcleo transaccional de venta ──────────────────────────────────────────
// Compartido entre el handler IPC `record-sale` (Host local) y el endpoint
// `POST /api/sales` (cajas desktop_box). Recibe `db` explícito para poder
// componerse con otras transacciones (p. ej. la tabla de idempotencia).
//
// `createSaleTx` NO abre su propia transacción: el llamador la envuelve con
// `db.transaction(...)`, de modo que la venta y cualquier trabajo adicional
// (idempotencia) commitean o revierten juntas.
//
// Regla de stock (Entrega 2c): si un producto no alcanza, la venta NUNCA se
// rechaza por stock. El descuento es atómico e incondicional
// (`stock = stock - ?`) y, si el stock resultante queda negativo, se emite un
// warning `STOCK_NEGATIVE` (consolidado por producto) para que el admin ajuste
// el inventario. El resto de validaciones (payload, cantidades, existencia de
// producto) sí provocan rollback total.

const crypto = require("crypto");
const credit = require("./credit");

const MAX_CART_LINES = 500;
const KNOWN_UNITS = ["piece", "weight", "box", "package", "boxpack"];

// Bloque 5 · folio continuo por dispositivo: H-000001 para el Host, A-000001
// para la caja A, etc. El prefijo sale del `device_code` que el Host asigna al
// aprobar la caja.
//
// Fase 2 · el prefijo es el código COMPLETO (A, B, A2, B2…): antes se tomaba
// sólo la primera letra y la caja A2 emitía los mismos folios que la A (cada
// una con su contador). Un código que no es de caja (`D-1A2B3C` de celular o
// de respaldo) da `X1A2B3C`, y sin código se deriva del device_id: nunca una
// letra que pueda tener otra caja.
const FOLIO_RE = /^([A-Z][A-Z0-9]{0,7})-(\d{6,})$/;

const folioPrefixFor = (code, deviceId) => {
  const c = String(code || "").trim().toUpperCase();
  if (/^[A-Z]\d{0,2}$/.test(c)) return c;
  const m = /^D-([0-9A-F]{6})$/.exec(c);
  if (m) return `X${m[1]}`;
  if (!deviceId) return "X";
  return `X${crypto.createHash("sha256").update(String(deviceId)).digest("hex").slice(0, 6).toUpperCase()}`;
};

// Prefijo que emitía la versión anterior (primera letra): se sigue aceptando
// para no dejar en conflicto las ventas que ya estaban en la cola offline.
const legacyPrefixFor = (code) => {
  const m = /^([A-Z])/.exec(String(code || "").trim().toUpperCase());
  return m ? m[1] : "X";
};

const deviceCodeOf = (db, deviceId) => {
  try {
    const row = db
      .prepare("SELECT device_code FROM paired_devices WHERE device_id = ?")
      .get(deviceId);
    return row ? row.device_code : null;
  } catch (err) {
    return null;
  }
};

const isHostDevice = (db, deviceId) => {
  if (!deviceId) return true;
  try {
    const host = db
      .prepare("SELECT value FROM settings WHERE key = 'host_device_id'")
      .get();
    return !!host && host.value === deviceId;
  } catch (err) {
    return false;
  }
};

const folioLetter = (db, deviceId) => {
  if (!deviceId) return "H";
  let row = null;
  try {
    // El Host vende con su `host_device_id`, que NO está en paired_devices:
    // sin esta comparación sus ventas saldrían con "X" y chocarían con las de
    // una caja sin código.
    const host = db
      .prepare("SELECT value FROM settings WHERE key = 'host_device_id'")
      .get();
    if (host && host.value === deviceId) return "H";
    row = db
      .prepare("SELECT device_code FROM paired_devices WHERE device_id = ?")
      .get(deviceId);
  } catch (err) {
    row = null;
  }
  return folioPrefixFor(row && row.device_code, deviceId);
};

const formatFolio = (letter, seq) =>
  `${letter}-${String(Math.max(1, Number(seq) || 1)).padStart(6, "0")}`;

// Reserva el siguiente folio. El llamador SIEMPRE corre dentro de una
// transacción (createSaleTx o el wrapper de /api/sales), así que el
// SELECT+UPDATE es atómico frente a otras ventas del mismo dispositivo.
// El Host puede llegar con `host_device_id` o sin device_id (venta local
// histórica). Ambos deben compartir el MISMO contador "host"; si no, dos
// ventas del Host sacarían H-000001 dos veces.
const folioKey = (db, deviceId) => {
  if (!deviceId) return "host";
  try {
    const host = db
      .prepare("SELECT value FROM settings WHERE key = 'host_device_id'")
      .get();
    if (host && host.value === deviceId) return "host";
  } catch (err) {}
  return String(deviceId);
};

const nextFolio = (db, deviceId) => {
  const key = folioKey(db, deviceId);
  db.prepare(
    "INSERT OR IGNORE INTO folio_counters (device_key, next_seq) VALUES (?, 1)",
  ).run(key);
  const row = db
    .prepare("SELECT next_seq FROM folio_counters WHERE device_key = ?")
    .get(key);
  const seq = Number(row && row.next_seq) || 1;
  db.prepare("UPDATE folio_counters SET next_seq = ? WHERE device_key = ?").run(
    seq + 1,
    key,
  );
  return formatFolio(folioLetter(db, deviceId), seq);
};

// El Host valida el folio que manda la caja y adelanta su contador para que
// una asignación futura del Host no choque. No reescribe el folio recibido.
const acceptFolio = (db, deviceId, folio) => {
  const value = String(folio || "").trim().toUpperCase();
  const parts = FOLIO_RE.exec(value);
  if (!parts) {
    throw fail("FOLIO_INVALID", `Folio inválido: ${folio}`);
  }
  // Fase 2 · el prefijo tiene que ser el de ESTE dispositivo: una caja no
  // puede gastar folios de la serie del Host ni de otra caja.
  if (!isHostDevice(db, deviceId)) {
    const code = deviceCodeOf(db, deviceId);
    const allowed = [folioPrefixFor(code, deviceId), legacyPrefixFor(code)];
    if (!allowed.includes(parts[1])) {
      throw fail("FOLIO_INVALID", `El folio ${value} no es de la serie de esta caja`, {
        expected_prefix: allowed[0],
      });
    }
  }
  const key = folioKey(db, deviceId);
  const seq = Number(parts[2]);
  db.prepare(
    "INSERT OR IGNORE INTO folio_counters (device_key, next_seq) VALUES (?, 1)",
  ).run(key);
  const row = db
    .prepare("SELECT next_seq FROM folio_counters WHERE device_key = ?")
    .get(key);
  if (!row || Number(row.next_seq) <= seq) {
    db.prepare(
      "UPDATE folio_counters SET next_seq = ? WHERE device_key = ?",
    ).run(seq + 1, key);
  }
  return value;
};

// Siguiente número que el Host tiene registrado para la serie del
// dispositivo. La caja lo usa para no retroceder tras reinstalar o restaurar.
const folioNextSeq = (db, deviceId) => {
  try {
    const row = db
      .prepare("SELECT next_seq FROM folio_counters WHERE device_key = ?")
      .get(folioKey(db, deviceId));
    return row ? Number(row.next_seq) || 1 : 1;
  } catch (err) {
    return 1;
  }
};

// 3a.i · deviceId filtra por dispositivo y quita el fallback a caja ajena.
const findOpenRegister = (db, cashierId, role, deviceId) => {
  const dev = deviceId ? " AND device_id = ?" : "";
  const devArgs = deviceId ? [deviceId] : [];
  if (role === "admin" || !cashierId) {
    return (
      db
        .prepare(
          `SELECT * FROM cash_register WHERE status = 'open'${dev} ORDER BY id DESC LIMIT 1`,
        )
        .get(...devArgs) || null
    );
  }
  return (
    db
      .prepare(
        `SELECT * FROM cash_register WHERE status = 'open' AND cashier_id = ?${dev} ORDER BY id DESC LIMIT 1`,
      )
      .get(cashierId, ...devArgs) ||
    db
      .prepare(
        `SELECT * FROM cash_register WHERE status = 'open'${dev} ORDER BY id DESC LIMIT 1`,
      )
      .get(...devArgs) ||
    null
  );
};

const fail = (code, message, extra) => {
  const err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
};

// El total cobrado es la suma de las líneas; en efectivo puede redondearse al
// paso configurado (`rounding_mode`, 0.5 por defecto). Más allá de eso, el
// payload se alteró o el renderer tiene un bug: se rechaza.
const assertTotalMatchesLines = (db, cart, total, paymentMethod) => {
  const sum = cart.reduce((acc, item) => {
    const unit = item ? item.finalPrice ?? item.price : NaN;
    const qty = item ? item.quantity : NaN;
    return acc + (Number.isFinite(unit) && Number.isFinite(qty) ? unit * qty : 0);
  }, 0);
  let tolerance = 0.01 + cart.length * 0.005;
  if ((paymentMethod || "cash") === "cash") {
    let step = 0.5;
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'rounding_mode'").get();
      const parsed = parseFloat(row && row.value);
      if (Number.isFinite(parsed) && parsed > 0) step = parsed;
    } catch (err) {}
    tolerance += step / 2;
  }
  if (Math.abs(sum - total) > tolerance) {
    throw fail(
      "TOTAL_MISMATCH",
      `El total (${total}) no cuadra con las líneas (${sum.toFixed(2)})`,
    );
  }
};

const createSaleTx = (
  db,
  {
    cart,
    total,
    paymentMethod,
    discountTotal,
    cashierName,
    cashierId,
    role,
    customerId,
    deviceId,
    requireRegister,
    // Bloque 4/5 · venta de la cola offline: la caja manda el folio, la caja
    // abierta que dio el Host y la hora local; el Host pone `synced_at`.
    folio,
    registerId,
    syncedAt,
    clientCreatedAt,
    // Fase 1 · ventas que llegan por red: el total debe cuadrar con las líneas.
    strictTotals,
    // Recarga Taecel (sólo service-transactions): la venta usa la serie del
    // Host (`null` → "H") para no gastar folios de la serie local de la caja,
    // y su línea puede enlazarse con el ledger del proveedor.
    folioDeviceId,
    allowServiceLink,
    // Fiado (paymentMethod 'credit'): lo que pagó al momento, su método y el
    // PIN del propietario si la venta rebasa el límite (ver credit.js).
    creditPaid,
    creditPaidMethod,
    ownerPin,
  },
) => {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw fail("INVALID_PAYLOAD", "El carrito está vacío");
  }
  if (cart.length > MAX_CART_LINES) {
    throw fail("INVALID_PAYLOAD", "El carrito excede el máximo de líneas");
  }
  if (!Number.isFinite(total) || total < 0) {
    throw fail("INVALID_PAYLOAD", "Total inválido");
  }
  for (const item of cart) {
    const pct = item && item.discount_percent;
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      throw fail("INVALID_DISCOUNT", "Descuento inválido");
    }
  }

  let resolvedCustomerId = null;
  let customerWarning = null;
  if (customerId !== undefined && customerId !== null) {
    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw fail("INVALID_CUSTOMER", "Cliente inválido");
    }
    const exists = db
      .prepare("SELECT id FROM customers WHERE id = ?")
      .get(customerId);
    if (exists) {
      resolvedCustomerId = customerId;
    } else {
      customerWarning = { code: "CUSTOMER_NOT_FOUND", customer_id: customerId };
    }
  }

  // Fiado: se valida cliente, límite y monto ANTES de escribir nada.
  const creditPrep =
    paymentMethod === "credit"
      ? credit.prepareCreditSale(db, {
          customerId: resolvedCustomerId,
          total,
          creditPaid,
          creditPaidMethod,
          ownerPin,
        })
      : null;

  const openReg = findOpenRegister(db, cashierId, role, deviceId);
  // 3a.i · la caja exige caja propia; el Host local vende también fuera de caja.
  if (requireRegister && !openReg && !registerId) {
    throw fail("NO_OPEN_REGISTER", "Abra caja para vender");
  }
  // Venta sincronizada desde la cola: se conserva la caja que estaba abierta
  // cuando se vendió, aunque ya se haya cerrado. Se valida que sea de la caja.
  let registerIdFinal = openReg ? openReg.id : null;
  let lateWarning = null;
  if (registerId) {
    const row = db
      .prepare("SELECT id, device_id, status FROM cash_register WHERE id = ?")
      .get(registerId);
    if (!row) throw fail("REGISTER_NOT_FOUND", "La caja de la venta no existe");
    if (deviceId && row.device_id && row.device_id !== deviceId) {
      throw fail("REGISTER_NOT_OWNED", "La caja de la venta pertenece a otro dispositivo");
    }
    registerIdFinal = row.id;
    // Fase 2 · la venta se hizo con la caja abierta pero llegó después del
    // corte: se conserva en su turno (el dinero estaba en ese cajón) y se
    // avisa para que el admin revise la diferencia del corte.
    if (row.status === "closed") {
      lateWarning = { code: "LATE_SYNC_CLOSED_REGISTER", register_id: row.id };
    }
  }
  const folioFinal = folio
    ? acceptFolio(db, deviceId, folio)
    : nextFolio(db, folioDeviceId !== undefined ? folioDeviceId : deviceId);

  const saleStmt = db.prepare(
    // 3g/C · `device_id` deja constancia de qué aparato hizo la venta: sin él,
    // una venta sin caja abierta no se puede atribuir a nadie.
    "INSERT INTO sales (total, payment_method, discount_total, register_id, cashier_name, customer_id, device_id, folio, synced_at, client_created_at, credit_amount, credit_paid, credit_paid_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const saleInfo = saleStmt.run(
    total,
    paymentMethod || "cash",
    discountTotal || 0,
    registerIdFinal,
    cashierName || "Usuario Principal",
    resolvedCustomerId,
    deviceId || null,
    folioFinal,
    syncedAt || null,
    clientCreatedAt || null,
    creditPrep ? creditPrep.amount : 0,
    creditPrep ? creditPrep.paid : 0,
    creditPrep ? creditPrep.method : null,
  );
  const saleId = saleInfo.lastInsertRowid;

  const itemStmt = db.prepare(
    "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale, discount_percent, stock_deducted, service_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // `day_sold` mantiene el contador "vendido hoy" de la línea base compartida:
  // se escribe junto al stock, así que la fila cambia igual que antes y viaja
  // a las cajas sin tráfico de réplica extra.
  const stockStmt = db.prepare(
    "UPDATE products SET stock = stock - ?, day_sold = COALESCE(day_sold, 0) + ? WHERE id = ?",
  );
  const getProductStmt = db.prepare(
    "SELECT name, stock, sale_unit, box_qty, pack_qty FROM products WHERE id = ?",
  );
  const getStockStmt = db.prepare("SELECT stock FROM products WHERE id = ?");

  const warningByProduct = new Map();

  for (const item of cart) {
    // Manual items: product_id null, sin stock ni validación de unidad.
    const isManual = item.isManual || typeof item.id !== "number";
    const quantity = item.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw fail("INVALID_QUANTITY", "Cantidad inválida");
    }
    const unitPrice = item.finalPrice ?? item.price;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw fail("INVALID_PRICE", "Precio inválido");
    }

    if (isManual) {
      const productName = item.name;
      if (typeof productName !== "string" || productName.trim() === "") {
        throw fail("INVALID_PAYLOAD", "Producto manual sin nombre");
      }
      itemStmt.run(
        saleId,
        null,
        productName,
        quantity,
        unitPrice,
        item.discount_percent || 0,
        0,
        // Recarga Taecel: enlaza la línea de venta con el ledger del proveedor.
        // Nunca desde el carrito de un cliente: sólo la llamada interna.
        allowServiceLink ? item.serviceTransactionId || null : null,
      );
      continue;
    }

    const product = getProductStmt.get(item.id);
    if (!product) {
      throw fail(
        "PRODUCT_NOT_FOUND",
        `Producto no encontrado (id ${item.id})`,
      );
    }

    const saleUnit = product.sale_unit || "piece";
    if (!KNOWN_UNITS.includes(saleUnit)) {
      throw fail("INVALID_UNIT", `Unidad inválida para "${product.name}"`);
    }

    // Entero salvo productos por peso (con precedentes confirmados en la BD
    // real: el único decimal histórico es en sale_unit='weight').
    if (saleUnit !== "weight" && !Number.isInteger(quantity)) {
      throw fail(
        "INVALID_QUANTITY",
        `Cantidad inválida para "${product.name}"`,
      );
    }

    let stockDeducted;
    if (item.isBoxItem) {
      if (!Number.isFinite(item.box_qty) || item.box_qty <= 0) {
        throw fail("INVALID_UNIT", `Caja inválida para "${product.name}"`);
      }
      stockDeducted = quantity * item.box_qty;
    } else if (item.isPackItem) {
      if (!Number.isFinite(item.pack_qty) || item.pack_qty <= 0) {
        throw fail("INVALID_UNIT", `Paquete inválido para "${product.name}"`);
      }
      stockDeducted = quantity * item.pack_qty;
    } else {
      stockDeducted = quantity;
    }

    const stockBefore = product.stock;
    // Descuento atómico SIN condición de stock: la venta nunca se rechaza por
    // stock insuficiente.
    stockStmt.run(stockDeducted, stockDeducted, item.id);
    const stockAfter = getStockStmt.get(item.id).stock;

    itemStmt.run(
      saleId,
      item.id,
      product.name,
      quantity,
      unitPrice,
      item.discount_percent || 0,
      stockDeducted,
      null,
    );

    if (stockAfter < 0) {
      const existing = warningByProduct.get(item.id);
      if (existing) {
        existing.sold += stockDeducted;
        existing.stock_after = stockAfter;
      } else {
        warningByProduct.set(item.id, {
          code: "STOCK_NEGATIVE",
          product_id: item.id,
          name: product.name,
          available_before: stockBefore,
          sold: stockDeducted,
          stock_after: stockAfter,
        });
      }
    }
  }

  // Después de validar las líneas (producto, unidad, cantidad) para que esos
  // errores conserven su código; el throw revierte la venta entera.
  if (strictTotals) assertTotalMatchesLines(db, cart, total, paymentMethod);

  const warnings = [...warningByProduct.values()];
  if (warnings.length > 0) {
    db.prepare(
      "UPDATE sales SET stock_conflict = 1, conflict_detail = ? WHERE id = ?",
    ).run(JSON.stringify(warnings), saleId);
  }
  if (customerWarning) {
    warnings.push(customerWarning);
  }
  if (lateWarning) {
    warnings.push(lateWarning);
  }

  // Cargo a la cuenta del cliente: sólo la parte fiada, en la misma
  // transacción que la venta (o se guardan las dos o ninguna).
  const creditInfo = creditPrep
    ? credit.chargeSale(db, creditPrep, {
        saleId,
        folio: folioFinal,
        total,
        registerId: registerIdFinal,
        deviceId,
        cashierId,
        cashierName,
      })
    : undefined;

  return {
    success: true,
    saleId,
    folio: folioFinal,
    warnings,
    ...(creditInfo ? { credit: creditInfo } : {}),
  };
};

module.exports = {
  findOpenRegister,
  createSaleTx,
  nextFolio,
  acceptFolio,
  formatFolio,
  folioPrefixFor,
  folioNextSeq,
  MAX_CART_LINES,
};
