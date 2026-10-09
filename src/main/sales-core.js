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

const findOpenRegister = (db, cashierId, role) => {
  if (role === "admin" || !cashierId) {
    return (
      db
        .prepare(
          "SELECT * FROM cash_register WHERE status = 'open' ORDER BY id DESC LIMIT 1",
        )
        .get() || null
    );
  }
  return (
    db
      .prepare(
        "SELECT * FROM cash_register WHERE status = 'open' AND cashier_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(cashierId) ||
    db
      .prepare(
        "SELECT * FROM cash_register WHERE status = 'open' ORDER BY id DESC LIMIT 1",
      )
      .get() ||
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
  { cart, total, paymentMethod, discountTotal, cashierName, cashierId, role },
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

  const openReg = findOpenRegister(db, cashierId, role);
  const registerId = openReg ? openReg.id : null;

  const saleStmt = db.prepare(
    "INSERT INTO sales (total, payment_method, discount_total, register_id, cashier_name) VALUES (?, ?, ?, ?, ?)",
  );
  const saleInfo = saleStmt.run(
    total,
    paymentMethod || "cash",
    discountTotal || 0,
    registerId,
    cashierName || "Usuario Principal",
  );
  const saleId = saleInfo.lastInsertRowid;

  const itemStmt = db.prepare(
    "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale, discount_percent, stock_deducted) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const stockStmt = db.prepare(
    "UPDATE products SET stock = stock - ? WHERE id = ?",
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
    stockStmt.run(stockDeducted, item.id);
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

  return { success: true, saleId, warnings };
};

module.exports = { findOpenRegister, createSaleTx, MAX_CART_LINES };
