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

const MAX_CART_LINES = 500;
const KNOWN_UNITS = ["piece", "weight", "box", "package", "boxpack"];

// Bloque 5 · folio continuo por dispositivo: H-000001 para el Host, A-000001
// para la caja A, etc. La letra sale del `device_code` que el Host ya asigna al
// aprobar la caja; si no existe se usa "X" para no romper el formato.
const FOLIO_RE = /^([A-Z])-(\d{6,})$/;

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
  const m = /^([A-Z])/.exec(String((row && row.device_code) || ""));
  return m ? m[1] : "X";
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
  if (!FOLIO_RE.test(value)) {
    throw fail("FOLIO_INVALID", `Folio inválido: ${folio}`);
  }
  const key = folioKey(db, deviceId);
  const seq = Number(value.split("-")[1]);
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

  const openReg = findOpenRegister(db, cashierId, role, deviceId);
  // 3a.i · la caja exige caja propia; el Host local vende también fuera de caja.
  if (requireRegister && !openReg && !registerId) {
    throw fail("NO_OPEN_REGISTER", "Abra caja para vender");
  }
  // Venta sincronizada desde la cola: se conserva la caja que estaba abierta
  // cuando se vendió, aunque ya se haya cerrado. Se valida que sea de la caja.
  let registerIdFinal = openReg ? openReg.id : null;
  if (registerId) {
    const row = db
      .prepare("SELECT id, device_id FROM cash_register WHERE id = ?")
      .get(registerId);
    if (!row) throw fail("REGISTER_NOT_FOUND", "La caja de la venta no existe");
    if (deviceId && row.device_id && row.device_id !== deviceId) {
      throw fail("REGISTER_NOT_OWNED", "La caja de la venta pertenece a otro dispositivo");
    }
    registerIdFinal = row.id;
  }
  const folioFinal = folio
    ? acceptFolio(db, deviceId, folio)
    : nextFolio(db, deviceId);

  const saleStmt = db.prepare(
    // 3g/C · `device_id` deja constancia de qué aparato hizo la venta: sin él,
    // una venta sin caja abierta no se puede atribuir a nadie.
    "INSERT INTO sales (total, payment_method, discount_total, register_id, cashier_name, customer_id, device_id, folio, synced_at, client_created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  );
  const saleId = saleInfo.lastInsertRowid;

  const itemStmt = db.prepare(
    "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale, discount_percent, stock_deducted) VALUES (?, ?, ?, ?, ?, ?, ?)",
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

  const warnings = [...warningByProduct.values()];
  if (warnings.length > 0) {
    db.prepare(
      "UPDATE sales SET stock_conflict = 1, conflict_detail = ? WHERE id = ?",
    ).run(JSON.stringify(warnings), saleId);
  }
  if (customerWarning) {
    warnings.push(customerWarning);
  }

  return { success: true, saleId, folio: folioFinal, warnings };
};

module.exports = {
  findOpenRegister,
  createSaleTx,
  nextFolio,
  acceptFolio,
  formatFolio,
  MAX_CART_LINES,
};
