"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Ledger de recargas Taecel y máquina de estados.
//
//   requesting → RequestTXN enviado, sin transID todavía (ventana corta)
//   pending    → transID recibido; StatusTXN aún no confirma
//   applied    → el operador aplicó; se crea la venta real (sales/sale_items)
//   failed     → el operador rechazó; NO se crea venta
//   unknown    → no sabemos; NO se crea venta y se marca para revisión
//
// Ciclo de confirmación (tiempos exigidos por Taecel en la certificación):
//   · StatusTXN se consulta en cuanto RequestTXN devuelve el transID.
//   · Cada StatusTXN espera 10 s como máximo; entre consultas se esperan 3 s.
//   · "En proceso", timeout o respuesta mal formada → se vuelve a consultar.
//   · Se consulta mientras no pasen 60 s desde RequestTXN; ninguna consulta
//     espera más allá de los 65 s. Después se da
//     seguimiento con getSales: al cerrar la ventana y a los 1.5, 3.5, 8.5 y
//     18.5 min. Sin estatus final tras el último, queda `unknown` para
//     revisión. Ni el poller ni la UI consultan StatusTXN fuera
//     de este ciclo.
//
// Reglas que sostienen el negocio:
//   · RequestTXN NUNCA se reenvía automáticamente.
//   · StatusTXN.success sólo dice que la consulta funcionó; el resultado es
//     data.Status.
//   · Si la caja ya cerró cuando se confirma `applied`, NO se toca el corte
//     cerrado: la fila queda applied + needs_review y el admin la revisa.
//   · La venta se crea en el Host con el register_id original; así aparece en
//     ventas, reportes y corte como cualquier otra.
//   · La referencia completa se guarda cifrada; para buscar/reconciliar se usan
//     el enmascarado y el hash (getSales devuelve el teléfono completo).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");
const salesCore = require("./sales-core");
const { normalizeReference, maskReference } = require("./taecel-errors");

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_AGE_SEC = 60;
// Ventana de StatusTXN (Taecel: 60–65 s desde RequestTXN). Se sigue enviando
// mientras no hayan pasado 60 s; ninguna respuesta se espera más allá de 65 s.
// Así una consulta enviada justo antes de los 60 s conserva 5 s de timeout.
const STATUS_CYCLE_MS = POLL_MAX_AGE_SEC * 1000;
const STATUS_HARD_LIMIT_MS = 65 * 1000;
const STATUS_RETRY_MS = 3000;
const STATUS_TIMEOUT_MS = 10000;
const AGE_CUTOFF_REASONS = new Set(["TIMEOUT_60S", "TXN_NOT_FOUND", "STATUS_UNCONFIRMED"]);
// Seguimiento con getSales tras la ventana de StatusTXN: uno al cerrar la
// ventana y luego a estos segundos desde RequestTXN (1.5, 3.5, 8.5 y 18.5 min).
const FOLLOWUP_AT_SEC = [90, 210, 510, 1110];
const RATE_LIMIT_MAX_AGE_SEC = 300;
const REQUEST_STALE_SEC = 120;
// Red de seguridad: más allá del último getSales agendado.
const PENDING_STALE_SEC = 25 * 60;
const HISTORY_LIMIT = 200;

const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

const parseSqlDate = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isFinite(d.getTime()) ? d : null;
};

const ageSeconds = (requestedAt) => {
  const d = parseSqlDate(requestedAt);
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// getSales pide la fecha local (YYYY-MM-DD); requested_at viene en UTC.
const localDate = (value) => {
  const d = value instanceof Date ? value : parseSqlDate(value) || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const moneyCents = (cents) => {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
};

const makeRefCte = (clientRequestId) => {
  const clean = String(clientRequestId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 44);
  return clean ? `R${clean}` : `R${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
};

// ─── Comisión de la tienda ──────────────────────────────────────────────────
// Lo que la tienda cobra ENCIMA del importe (no viaja a Taecel). Se configura
// por tipo (categoría de Taecel) y, opcionalmente, por compañía. Vive en
// `settings` del Host; las cajas la reciben ya calculada en el catálogo.
const FEES_KEY = "service_fees";
const FEE_CATEGORIES = Object.freeze({ 1: "recargas", 2: "paquetes", 3: "servicios", 4: "tarjetas" });
const MAX_FEE_CENTS = 100000; // $1,000: más es casi seguro un error de captura

const cleanFee = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_FEE_CENTS);
};

const normalizeFees = (raw) => {
  const src = raw && typeof raw === "object" ? raw : {};
  const byCategory = {};
  for (const key of Object.values(FEE_CATEGORIES)) {
    byCategory[key] = cleanFee(src.byCategory && src.byCategory[key]);
  }
  const byCarrier = {};
  if (src.byCarrier && typeof src.byCarrier === "object") {
    for (const [id, cents] of Object.entries(src.byCarrier)) {
      const key = String(id || "").trim();
      if (!key || cents == null || cents === "") continue;
      // 0 explícito sí vale: "a esta compañía no se le cobra".
      const n = Math.round(Number(cents));
      if (Number.isFinite(n) && n >= 0) byCarrier[key] = Math.min(n, MAX_FEE_CENTS);
    }
  }
  return { byCategory, byCarrier };
};

const createServiceTransactions = ({
  db,
  taecel,
  emit = () => {},
  logger = () => {},
} = {}) => {
  if (!db) throw new Error("createServiceTransactions requiere db");
  if (!taecel) throw new Error("createServiceTransactions requiere taecel");

  const inFlight = new Map();
  // id de fila -> promesa del ciclo StatusTXN en curso (uno por transacción).
  const cycles = new Map();
  let poller = null;
  let ticking = false;

  const readFees = () => {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(FEES_KEY);
      return normalizeFees(row ? JSON.parse(row.value) : null);
    } catch (err) {
      logger("fees-read", err);
      return normalizeFees(null);
    }
  };

  const feeFor = (operator, fees = readFees()) => {
    if (!operator) return 0;
    const id = String(operator.id ?? operator.key ?? "");
    if (id && Object.prototype.hasOwnProperty.call(fees.byCarrier, id)) {
      return fees.byCarrier[id];
    }
    const cat = FEE_CATEGORIES[Number(operator.categoryId)];
    return cat ? fees.byCategory[cat] || 0 : 0;
  };

  const getFees = () => ({ ok: true, fees: readFees() });

  const setFees = (payload = {}) => {
    const fees = normalizeFees(payload.fees || payload);
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(FEES_KEY, JSON.stringify(fees));
    return { ok: true, fees };
  };

  // El catálogo sale con la comisión vigente de cada compañía: la caja la
  // muestra y la manda de vuelta para confirmar que cobra el mismo total.
  const withFees = (catalog) => {
    if (!catalog || !Array.isArray(catalog.operators)) return catalog;
    const fees = readFees();
    return {
      ...catalog,
      operators: catalog.operators.map((op) => ({ ...op, feeCents: feeFor(op, fees) })),
    };
  };

  const getById = (id) =>
    db.prepare("SELECT * FROM service_transactions WHERE id = ?").get(id) || null;

  const getByClientRequestId = (clientRequestId) =>
    db
      .prepare("SELECT * FROM service_transactions WHERE client_request_id = ?")
      .get(String(clientRequestId || "")) || null;

  const getForSettlement = (row) => {
    if (!row) return null;
    return db
      .prepare("SELECT * FROM service_transactions WHERE id = ?")
      .get(row.id) || row;
  };

  const toUiRow = (row) => {
    if (!row) return null;
    let status = row.status;
    if (status === "requesting") status = "pending";
    if (status === "applied" && Number(row.needs_review) === 1) {
      status = "needs_review";
    }
    // `reversed` ya no existe en Taecel; el estado queda por compatibilidad de
    // la UI si alguna fila vieja lo tuviera.
    const amountCents = Number(row.amount_cents) || 0;
    const feeCents = Number(row.fee_cents) || 0;
    return {
      id: row.id,
      transactionId: row.id,
      clientRequestId: row.client_request_id,
      status,
      rawStatus: row.status,
      providerStatus: row.provider_status || null,
      providerMessage: row.provider_message || null,
      transId: row.provider_trans_id || null,
      providerFolio: row.provider_folio || null,
      saleId: row.sale_id || null,
      saleFolio: row.sale_folio || null,
      needsReview: Number(row.needs_review) === 1,
      reviewReason: row.review_reason || null,
      operatorKey: row.carrier_id || null,
      operatorName: row.carrier_name || null,
      operatorLogo: row.carrier_logo || null,
      productName: row.product_name || null,
      sku: row.product_code || null,
      inputValue: row.reference_masked || "",
      referenceMasked: row.reference_masked || "",
      quote: { amountCents, feeCents, totalCents: amountCents + feeCents },
      amountCents,
      feeCents,
      paymentMethod: row.payment_method || "cash",
      folio: row.sale_folio || row.provider_folio || row.ref_cte || null,
      refCte: row.ref_cte || null,
      createdAt: row.requested_at,
      appliedAt: row.applied_at || null,
      failedAt: row.failed_at || null,
      lastCheckedAt: row.last_checked_at || null,
      checkAttempts: Number(row.check_attempts) || 0,
      registerId: row.register_id || null,
      cashierName: row.cashier_name || null,
      deviceId: row.device_id || null,
    };
  };

  const resultFromRow = (row, extra = {}) => {
    if (!row) {
      return {
        ok: false,
        code: "SERVICE_TX_NOT_FOUND",
        error: "No se encontró la operación",
        ...extra,
      };
    }
    const ui = toUiRow(row);
    return {
      ...ui,
      ok: ui.status === "applied" || ui.status === "pending" || ui.status === "needs_review",
      code: null,
      error: null,
      ...extra,
    };
  };

  const touch = (tables = ["service_transactions"]) => {
    try {
      emit(tables);
    } catch (err) {
      logger("emit", err);
    }
  };

  const setStatusFields = (rowId, args) => {
    const {
      status,
      providerStatus = null,
      providerMessage = null,
      providerTransId = null,
      providerFolio = null,
      nextCheckAt = null,
      needsReview = 0,
      reviewReason = null,
      rawStatusJson = null,
      saleId = null,
      saleFolio = null,
      saldoFinalCents = null,
      cargoCents = null,
      abonoCents = null,
      comisionCents = null,
      applied = false,
      failed = false,
      incrementAttempts = true,
    } = args;
    db.prepare(
      `UPDATE service_transactions SET
        status = ?,
        provider_status = COALESCE(?, provider_status),
        provider_message = ?,
        provider_trans_id = COALESCE(?, provider_trans_id),
        provider_folio = COALESCE(?, provider_folio),
        next_check_at = ?,
        needs_review = ?,
        review_reason = ?,
        raw_status_json = COALESCE(?, raw_status_json),
        sale_id = COALESCE(?, sale_id),
        sale_folio = COALESCE(?, sale_folio),
        saldo_final_cents = COALESCE(?, saldo_final_cents),
        cargo_cents = COALESCE(?, cargo_cents),
        abono_cents = COALESCE(?, abono_cents),
        comision_cents = COALESCE(?, comision_cents),
        applied_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE applied_at END,
        failed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE failed_at END,
        last_checked_at = CURRENT_TIMESTAMP,
        check_attempts = check_attempts + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    ).run(
      status,
      providerStatus,
      providerMessage,
      providerTransId,
      providerFolio,
      nextCheckAt,
      needsReview ? 1 : 0,
      reviewReason,
      rawStatusJson,
      saleId,
      saleFolio,
      saldoFinalCents,
      cargoCents,
      abonoCents,
      comisionCents,
      applied ? 1 : 0,
      failed ? 1 : 0,
      incrementAttempts ? 1 : 0,
      rowId,
    );
  };

  const markUnknown = (row, reason, result = null) => {
    const current = getForSettlement(row);
    if (!current) return null;
    setStatusFields(current.id, {
      status: "unknown",
      providerStatus: result && result.rawStatus ? result.rawStatus : current.provider_status,
      providerMessage:
        (result && (result.message || result.error)) ||
        current.provider_message ||
        "No se pudo confirmar la recarga",
      providerTransId: result && result.transId ? String(result.transId) : null,
      providerFolio: result && result.folio ? String(result.folio) : null,
      nextCheckAt: null,
      needsReview: 1,
      reviewReason: reason,
      rawStatusJson: result && result.sanitized ? JSON.stringify(result.sanitized) : null,
      saldoFinalCents: result ? result.saldoFinalCents : null,
      cargoCents: result ? result.cargoCents : null,
      abonoCents: result ? result.abonoCents : null,
      comisionCents: result ? result.comisionCents : null,
    });
    touch();
    return getForSettlement(current);
  };

  const markFailed = (row, result) => {
    const current = getForSettlement(row);
    if (!current) return null;
    setStatusFields(current.id, {
      status: "failed",
      providerStatus: result.rawStatus || "Fracasada",
      providerMessage: result.message || "La recarga fue rechazada",
      providerTransId: result.transId ? String(result.transId) : null,
      providerFolio: result.folio ? String(result.folio) : null,
      nextCheckAt: null,
      needsReview: 0,
      reviewReason: null,
      rawStatusJson: result.sanitized ? JSON.stringify(result.sanitized) : null,
      saldoFinalCents: result.saldoFinalCents,
      cargoCents: result.cargoCents,
      abonoCents: result.abonoCents,
      comisionCents: result.comisionCents,
      failed: true,
    });
    touch();
    return getForSettlement(current);
  };

  const finalizeApplied = (row, result) => {
    const first = getForSettlement(row);
    if (!first) return null;

    // Si ya hay venta, sólo se actualiza el estado del proveedor.
    if (first.sale_id) {
      setStatusFields(first.id, {
        status: "applied",
        providerStatus: result.rawStatus || first.provider_status || "Exitosa",
        providerMessage: result.message || first.provider_message,
        providerFolio: result.folio ? String(result.folio) : null,
        providerTransId: result.transId ? String(result.transId) : null,
        nextCheckAt: null,
        needsReview: 0,
        reviewReason: null,
        rawStatusJson: result.sanitized ? JSON.stringify(result.sanitized) : null,
        saldoFinalCents: result.saldoFinalCents,
        cargoCents: result.cargoCents,
        abonoCents: result.abonoCents,
        comisionCents: result.comisionCents,
        applied: true,
      });
      if (Number(result.saldoFinalCents) >= 0) {
        taecel.rememberBalanceFromStatus(first.category_id, result.saldoFinalCents);
      }
      touch(["sales", "service_transactions"]);
      return getForSettlement(first);
    }

    const run = db.transaction(() => {
      const current = getForSettlement(first);
      if (!current) return { row: null, sale: null, saleError: null };

      // La caja debe seguir abierta. Si ya cerró, no se toca el corte cerrado:
      // la fila queda applied + needs_review para que el admin decida.
      let registerId = current.register_id;
      if (!registerId && current.device_id) {
        const open = salesCore.findOpenRegister(
          db,
          current.cashier_id,
          "cashier",
          current.device_id,
        );
        if (open) registerId = open.id;
      }
      const reg = registerId
        ? db
            .prepare("SELECT id, status, device_id FROM cash_register WHERE id = ?")
            .get(registerId)
        : null;

      let sale = null;
      let saleError = null;
      let needsReview = 0;
      let reviewReason = null;

      if (!Number.isFinite(Number(current.amount_cents)) || Number(current.amount_cents) <= 0) {
        needsReview = 1;
        reviewReason = "INVALID_AMOUNT";
      } else if (!reg) {
        needsReview = 1;
        reviewReason = "NO_REGISTER";
      } else if (reg.status !== "open") {
        needsReview = 1;
        reviewReason = "REGISTER_CLOSED";
      } else if (current.device_id && reg.device_id && reg.device_id !== current.device_id) {
        needsReview = 1;
        reviewReason = "REGISTER_OWNER_MISMATCH";
      } else {
        const isBill = Number(current.category_id) === 3;
        const desc = `${isBill ? "Pago" : "Recarga"} ${current.carrier_name || ""} ${moneyCents(
          current.amount_cents,
        )}${current.reference_masked ? ` · ${current.reference_masked}` : ""}`.trim();
        const feeCents = Number(current.fee_cents) || 0;
        const cart = [
          {
            isManual: true,
            name: desc,
            quantity: 1,
            price: Number(current.amount_cents) / 100,
            finalPrice: Number(current.amount_cents) / 100,
            serviceTransactionId: current.id,
          },
        ];
        // La comisión es ganancia de la tienda: renglón propio, sin enlace al
        // ledger (así sí cuenta en utilidades) y con costo 0.
        if (feeCents > 0) {
          cart.push({
            isManual: true,
            name: `Comisión ${isBill ? "pago" : "recarga"} ${current.carrier_name || ""}`.trim(),
            quantity: 1,
            price: feeCents / 100,
            finalPrice: feeCents / 100,
            serviceFee: true,
          });
        }
        try {
          sale = salesCore.createSaleTx(db, {
            cart,
            total: (Number(current.amount_cents) + feeCents) / 100,
            paymentMethod: current.payment_method || "cash",
            cashierName: current.cashier_name || "Usuario Principal",
            cashierId: current.cashier_id || null,
            role: "cashier",
            deviceId: current.device_id || null,
            registerId,
            requireRegister: true,
            // Serie del Host: la caja lleva su propio contador de folios y no
            // se entera de esta venta, así que no puede tomar uno de su serie.
            folioDeviceId: null,
            allowServiceLink: true,
          });
        } catch (err) {
          sale = null;
          saleError = err;
          needsReview = 1;
          reviewReason = err.code || "SALE_CREATE_FAILED";
        }
      }

      db.prepare(
        `UPDATE service_transactions SET
          status = 'applied',
          provider_status = COALESCE(?, provider_status),
          provider_message = ?,
          provider_trans_id = COALESCE(?, provider_trans_id),
          provider_folio = COALESCE(?, provider_folio),
          register_id = COALESCE(register_id, ?),
          applied_at = CURRENT_TIMESTAMP,
          failed_at = NULL,
          last_checked_at = CURRENT_TIMESTAMP,
          check_attempts = check_attempts + 1,
          next_check_at = NULL,
          needs_review = ?,
          review_reason = ?,
          sale_id = COALESCE(?, sale_id),
          sale_folio = COALESCE(?, sale_folio),
          saldo_final_cents = COALESCE(?, saldo_final_cents),
          cargo_cents = COALESCE(?, cargo_cents),
          abono_cents = COALESCE(?, abono_cents),
          comision_cents = COALESCE(?, comision_cents),
          raw_status_json = COALESCE(?, raw_status_json),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      ).run(
        result.rawStatus || "Exitosa",
        result.message || "Recarga exitosa",
        result.transId ? String(result.transId) : null,
        result.folio ? String(result.folio) : null,
        registerId || null,
        needsReview ? 1 : 0,
        reviewReason,
        sale ? sale.saleId : null,
        sale ? sale.folio : null,
        result.saldoFinalCents,
        result.cargoCents,
        result.abonoCents,
        result.comisionCents,
        result.sanitized ? JSON.stringify(result.sanitized) : null,
        current.id,
      );

      return { row: getForSettlement(current), sale, saleError };
    });

    const out = run();
    if (out.row && Number(result.saldoFinalCents) >= 0) {
      taecel.rememberBalanceFromStatus(out.row.category_id, result.saldoFinalCents);
    }
    if (out.saleError) {
      logger("sale-create", out.saleError);
    }
    touch(["sales", "service_transactions"]);
    return out.row;
  };

  const applyStatus = (row, result) => {
    const current = getForSettlement(row);
    if (!current) return null;
    const age = ageSeconds(current.requested_at);

    if (result && result.ok) {
      const status = result.status;
      if (status === "applied") return finalizeApplied(current, result);
      if (status === "failed") return markFailed(current, result);
      if (status === "pending") {
        if (age >= POLL_MAX_AGE_SEC) {
          return markUnknown(current, "TIMEOUT_60S", result);
        }
        setStatusFields(current.id, {
          status: "pending",
          providerStatus: result.rawStatus || "en proceso",
          providerMessage: result.message || "La recarga sigue en proceso",
          providerTransId: result.transId ? String(result.transId) : null,
          providerFolio: result.folio ? String(result.folio) : null,
          nextCheckAt: "datetime('now', '+5 seconds')",
          needsReview: 0,
          reviewReason: null,
          rawStatusJson: result.sanitized ? JSON.stringify(result.sanitized) : null,
          saldoFinalCents: result.saldoFinalCents,
          cargoCents: result.cargoCents,
          abonoCents: result.abonoCents,
          comisionCents: result.comisionCents,
        });
        // El helper usa el literal SQL; se corrige aquí porque setStatusFields
        // lo pasa como parámetro. Se reescribe con datetime() real.
        db.prepare(
          "UPDATE service_transactions SET next_check_at = datetime('now', '+5 seconds') WHERE id = ?",
        ).run(current.id);
        touch();
        return getForSettlement(current);
      }
      return markUnknown(current, "STATUS_UNKNOWN", result);
    }

    const kind = result && result.kind;
    if (kind === "not_found") {
      if (age >= POLL_MAX_AGE_SEC) {
        return markUnknown(current, "TXN_NOT_FOUND", result);
      }
      db.prepare(
        "UPDATE service_transactions SET status='pending', provider_status=COALESCE(?,provider_status), provider_message=?, next_check_at=datetime('now','+5 seconds'), last_checked_at=CURRENT_TIMESTAMP, check_attempts=check_attempts+1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(
        result.rawStatus || null,
        result.message || "Taecel todavía no reconoce el transID",
        current.id,
      );
      touch();
      return getForSettlement(current);
    }
    if (kind === "rate_limit") {
      if (age >= RATE_LIMIT_MAX_AGE_SEC) {
        return markUnknown(current, "RATE_LIMITED", result);
      }
      db.prepare(
        "UPDATE service_transactions SET status='pending', provider_status=COALESCE(?,provider_status), provider_message=?, next_check_at=datetime('now','+30 seconds'), last_checked_at=CURRENT_TIMESTAMP, check_attempts=check_attempts+1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(
        result.rawStatus || null,
        result.message || "Taecel limitó las consultas; se reintentará",
        current.id,
      );
      touch();
      return getForSettlement(current);
    }
    if (kind === "config") {
      return markUnknown(current, "CONFIG_ERROR", result);
    }
    if (kind === "validation") {
      return markUnknown(current, "STATUS_VALIDATION", result);
    }
    // Transporte / 8888 / códigos no documentados: no se puede confirmar.
    if (age >= POLL_MAX_AGE_SEC) {
      return markUnknown(current, "STATUS_UNCONFIRMED", result);
    }
    db.prepare(
      "UPDATE service_transactions SET status='pending', provider_status=COALESCE(?,provider_status), provider_message=?, next_check_at=datetime('now','+5 seconds'), last_checked_at=CURRENT_TIMESTAMP, check_attempts=check_attempts+1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(
      result && result.rawStatus ? result.rawStatus : null,
      (result && (result.message || result.error)) || "No se pudo consultar el estado",
      current.id,
    );
    touch();
    return getForSettlement(current);
  };

  // Seguimiento tras la ventana de 60 s: se busca el transID en el listado de
  // ventas del día. Bolsa 2 = servicios; el resto sale de tiempo aire (1). Si
  // no aparece en la esperada se prueba la otra. Sin estatus final, la fila
  // sigue `pending` y se agenda el siguiente getSales (FOLLOWUP_AT_SEC); al
  // agotarse la agenda queda `unknown` para revisión.
  const followUpWithSales = async (row) => {
    const current = getForSettlement(row);
    if (!current || !current.provider_trans_id) return current;
    const following =
      current.status === "pending" ||
      (current.status === "unknown" && AGE_CUTOFF_REASONS.has(current.review_reason));
    const date = localDate(current.requested_at);
    const first = Number(current.category_id) === 3 ? 2 : 1;
    let sale = null;
    let lastError = null;
    for (const bolsa of [first, first === 1 ? 2 : 1]) {
      const res = await taecel.getSales({ date, bolsa, force: true });
      if (!res || !res.ok) {
        lastError = res;
        continue;
      }
      sale = (res.sales || []).find(
        (s) => s.transId && String(s.transId) === String(current.provider_trans_id),
      );
      if (sale) break;
    }
    if (sale && (sale.status === "applied" || sale.status === "failed")) {
      return applyStatus(current, { ok: true, ...sale });
    }
    if (!following) return getForSettlement(current);

    const age = ageSeconds(current.requested_at);
    const next = FOLLOWUP_AT_SEC.find((sec) => sec > age + 1);
    if (next != null) {
      db.prepare(
        `UPDATE service_transactions SET
          status = 'pending',
          provider_status = COALESCE(?, provider_status),
          provider_message = ?,
          next_check_at = datetime(requested_at, ?),
          needs_review = 0,
          review_reason = NULL,
          last_checked_at = CURRENT_TIMESTAMP,
          check_attempts = check_attempts + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      ).run(
        sale ? sale.rawStatus : null,
        "Sigue en proceso; confirmando con el listado de ventas de Taecel",
        `+${next} seconds`,
        current.id,
      );
      touch();
      return getForSettlement(current);
    }

    return markUnknown(current, "TIMEOUT_60S", {
      rawStatus: sale ? sale.rawStatus : null,
      message: sale
        ? "Taecel sigue sin estatus final; revisar en el listado de ventas"
        : lastError
          ? `Sin confirmar y no se pudo consultar getSales: ${lastError.error || lastError.message || "error"}`
          : "Sin confirmar; no aparece en el listado de ventas de Taecel",
    });
  };

  // StatusTXN inmediato, reintento cada 3 s y timeout de 10 s por consulta.
  // Se envían consultas hasta los 60 s desde RequestTXN y ninguna espera más
  // allá de los 65 s; después, getSales.
  const runStatusCycle = async (rowId, startedAtMs) => {
    for (;;) {
      const current = getById(rowId);
      if (!current || current.status !== "pending") return current;
      if (!current.provider_trans_id) {
        return markUnknown(current, "NO_TRANSID", { message: "Taecel no devolvió transID" });
      }
      const elapsed = Date.now() - startedAtMs;
      if (elapsed >= STATUS_CYCLE_MS) return followUpWithSales(current);

      const result = await taecel.statusTxn(current.provider_trans_id, {
        timeoutMs: Math.min(STATUS_TIMEOUT_MS, STATUS_HARD_LIMIT_MS - elapsed),
      });
      const updated = applyStatus(current, result);
      // applyStatus corta por edad (requested_at, al segundo); ese corte
      // también debe pasar por getSales.
      if (updated && updated.status === "unknown" && AGE_CUTOFF_REASONS.has(updated.review_reason)) {
        return followUpWithSales(updated);
      }
      if (!updated || updated.status !== "pending") return updated;

      if (Date.now() + STATUS_RETRY_MS - startedAtMs >= STATUS_CYCLE_MS) {
        return followUpWithSales(updated);
      }
      await sleep(STATUS_RETRY_MS);
    }
  };

  const ensureStatusCycle = (row, startedAtMs = null) => {
    if (!row) return null;
    if (cycles.has(row.id)) return cycles.get(row.id);
    const start = startedAtMs ?? (parseSqlDate(row.requested_at) || new Date()).getTime();
    const promise = runStatusCycle(row.id, start)
      .catch((err) => {
        logger("status-cycle", err);
        return getById(row.id);
      })
      .finally(() => {
        cycles.delete(row.id);
      });
    cycles.set(row.id, promise);
    return promise;
  };

  // `manual`: el cajero pidió revisar. Las revisiones automáticas de la UI no
  // llaman al proveedor; el ciclo de arriba es el único que consulta StatusTXN.
  const checkRow = async (row, { manual = false } = {}) => {
    const current = getForSettlement(row);
    if (!current) return null;

    if (current.status === "failed" && !current.sale_id) {
      return current;
    }
    if (current.status === "applied") {
      // Reintento de creación de venta (p. ej. la caja estaba cerrada y ya
      // abrió). No se vuelve a consultar al proveedor: ya sabemos que aplicó.
      if (!current.sale_id && Number(current.needs_review) === 1) {
        return finalizeApplied(current, {
          ok: true,
          status: "applied",
          rawStatus: current.provider_status || "Exitosa",
          message: current.provider_message || "Recarga exitosa",
          transId: current.provider_trans_id,
          folio: current.provider_folio,
          saldoFinalCents: current.saldo_final_cents,
          cargoCents: current.cargo_cents,
          abonoCents: current.abono_cents,
          comisionCents: current.comision_cents,
          sanitized: current.raw_status_json ? safeParse(current.raw_status_json) : null,
        });
      }
      return current;
    }

    if (current.status === "requesting") {
      if (ageSeconds(current.requested_at) >= REQUEST_STALE_SEC) {
        return markUnknown(current, "REQUEST_STALE", {
          message: "La solicitud no confirmó a tiempo",
        });
      }
      return current;
    }

    if (!current.provider_trans_id) {
      if (current.status === "unknown") return current;
      return markUnknown(current, "NO_TRANSID", {
        message: "Taecel no devolvió transID",
      });
    }

    if (current.status === "pending") {
      if (cycles.has(current.id)) return current;
      // En seguimiento (pasados los 60 s): el cajero puede adelantar el
      // siguiente getSales; las lecturas automáticas esperan su turno.
      if (manual && ageSeconds(current.requested_at) >= POLL_MAX_AGE_SEC) {
        return followUpWithSales(current);
      }
      const due = parseSqlDate(current.next_check_at);
      if (!due || due.getTime() <= Date.now()) ensureStatusCycle(current);
      return current;
    }

    // unknown con transID: pasada la ventana de 60 s ya no se usa StatusTXN.
    if (current.status === "unknown" && manual) {
      return followUpWithSales(current);
    }
    return current;
  };

  const safeParse = (value) => {
    try {
      return JSON.parse(value);
    } catch (err) {
      return null;
    }
  };

  const doCreate = async (payload, context) => {
    const clientRequestId = String(payload.clientRequestId || "").trim();
    if (!clientRequestId) {
      return {
        ok: false,
        code: "INVALID_CLIENT_REQUEST_ID",
        error: "Falta el identificador único de la operación",
      };
    }

    const existing = getByClientRequestId(clientRequestId);
    if (existing) return resultFromRow(existing);

    const productCode = String(payload.productCode || "").trim();
    const reference = normalizeReference(payload.reference);
    const paymentMethod = ["cash", "card", "transfer"].includes(payload.paymentMethod)
      ? payload.paymentMethod
      : "cash";
    if (!productCode) {
      return { ok: false, code: "INVALID_PRODUCT", error: "Falta el producto" };
    }
    if (!reference) {
      return { ok: false, code: "INVALID_REFERENCE", error: "Falta el número de referencia" };
    }

    const catalog = await taecel.getCatalog({ force: false });
    if (!catalog || !catalog.ok) {
      return {
        ok: false,
        code: (catalog && catalog.code) || "CATALOG_UNAVAILABLE",
        error:
          (catalog && (catalog.error || catalog.message)) ||
          "No se pudo cargar el catálogo de Taecel",
      };
    }

    let operator = null;
    let product = null;
    for (const op of catalog.operators || []) {
      const found = (op.products || []).find(
        (p) => p.sku === productCode || p.code === productCode,
      );
      if (found) {
        operator = op;
        product = found;
        break;
      }
    }
    // Servicio de monto libre (CFE, agua…): el SKU puede ser el del carrier
    // mismo. Si no hay match por producto, se resuelve por carrier para que el
    // importe que capturó el cajero sí llegue al RequestTXN.
    if (!operator) {
      operator = (catalog.operators || []).find(
        (op) => op.key === productCode || op.id === productCode,
      ) || null;
      if (operator && operator.freeAmount) {
        // Con monto libre el `productCode` que viaja a Taecel es el id del
        // carrier; el producto sólo aporta nombre y categoryId para el ledger.
        product =
          (operator.products || [])[0] ||
          { sku: operator.id, name: operator.name, categoryId: operator.categoryId, amountCents: 0 };
      } else {
        operator = null;
      }
    }
    if (!operator || !product) {
      return {
        ok: false,
        code: "TAECEL_PRODUCT_NOT_FOUND",
        error: "El producto ya no está en el catálogo. Actualiza el catálogo.",
      };
    }

    const freeAmount = !!operator.freeAmount;
    const amountCents = freeAmount
      ? Math.round(Number(payload.amountCents) || 0)
      : Number(product.amountCents) || 0;
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error: freeAmount
          ? "Este operador requiere un monto"
          : "El producto no tiene un monto válido",
      };
    }

    const input = operator.input || {};
    if (input.numeric && !/^\d+$/.test(reference)) {
      return {
        ok: false,
        code: "INVALID_REFERENCE",
        error: "El número de referencia debe contener sólo dígitos",
      };
    }
    if (input.min && reference.length < input.min) {
      return {
        ok: false,
        code: "INVALID_REFERENCE",
        error: `El número de referencia debe tener al menos ${input.min} dígitos`,
      };
    }
    if (input.max && reference.length > input.max) {
      return {
        ok: false,
        code: "INVALID_REFERENCE",
        error: `El número de referencia debe tener como máximo ${input.max} dígitos`,
      };
    }

    // La comisión la decide el Host. Si la caja mostró otra (alguien la cambió
    // mientras cobraba), no se cobra un total distinto al que vio el cliente.
    const feeCents = feeFor(operator);
    if (payload.feeCents != null && Math.round(Number(payload.feeCents)) !== feeCents) {
      return {
        ok: false,
        code: "FEE_CHANGED",
        feeCents,
        error: `La comisión cambió a ${moneyCents(feeCents)}. Revisa el total y cobra de nuevo.`,
      };
    }

    const register = salesCore.findOpenRegister(
      db,
      context.cashierId || null,
      context.role || "cashier",
      context.deviceId || null,
    );
    if (!register) {
      return {
        ok: false,
        code: "NO_OPEN_REGISTER",
        error: "Abre caja para cobrar recargas y paquetes",
      };
    }

    let cashierName = context.cashierName || "Usuario Principal";
    let role = context.role || "cashier";
    if (context.cashierId) {
      const cashier = db
        .prepare("SELECT name, role FROM cashiers WHERE id = ?")
        .get(context.cashierId);
      if (cashier) {
        cashierName = cashier.name || cashierName;
        role = cashier.role || role;
      }
    }

    const refCte = makeRefCte(clientRequestId);
    const referenceHash = sha256(reference);
    const referenceMasked = maskReference(reference);
    const referenceEnc = taecel.encryptReference(reference);
    // Con monto libre el nombre del producto no trae importe: se agrega aquí
    // para que el ledger y el ticket lo muestren completos.
    const description = freeAmount
      ? `${product.name} ${moneyCents(amountCents)}`
      : product.name || `${operator.name} ${moneyCents(amountCents)}`;

    const insert = db.prepare(
      `INSERT INTO service_transactions (
        client_request_id, ref_cte, provider, status, category_id, carrier_id,
        carrier_name, carrier_logo, product_code, product_name, reference_masked,
        reference_hash, reference_enc, amount_cents, payment_method, register_id,
        cashier_id, cashier_name, device_id, fee_cents, requested_at, updated_at
      ) VALUES (?, ?, 'taecel', 'requesting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    const info = insert.run(
      clientRequestId,
      refCte,
      Number(product.categoryId) || Number(operator.categoryId) || null,
      operator.id,
      operator.name,
      operator.logo || null,
      product.sku,
      description,
      referenceMasked,
      referenceHash,
      referenceEnc,
      amountCents,
      paymentMethod,
      register.id,
      context.cashierId || null,
      cashierName,
      context.deviceId || null,
      feeCents,
    );
    const ledgerId = Number(info.lastInsertRowid);
    touch();

    let result;
    const requestSentAt = Date.now();
    try {
      result = await taecel.requestTxn({
        productCode: product.sku,
        reference,
        amountCents,
        refCte,
        freeAmount,
      });
    } catch (err) {
      result = {
        ok: false,
        kind: "unknown",
        code: "TAECEL_TRANSPORT",
        message: err.message || "No se pudo conectar con Taecel",
        ambiguous: true,
      };
    }

    if (result && result.ok) {
      db.prepare(
        `UPDATE service_transactions SET
          status = 'pending',
          provider_trans_id = ?,
          provider_status = 'Solicitada',
          provider_message = ?,
          next_check_at = CURRENT_TIMESTAMP,
          last_checked_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      ).run(
        String(result.transId),
        result.message || "Solicitud aceptada; confirmando con el operador",
        ledgerId,
      );
      touch();
      ensureStatusCycle(getById(ledgerId), requestSentAt);
      return resultFromRow(getById(ledgerId), {
        ok: true,
        message: "Recarga enviada; estamos confirmando con el operador",
      });
    }

    const kind = result && result.kind;
    if (
      kind === "failed" ||
      kind === "validation" ||
      kind === "config" ||
      kind === "catalog" ||
      kind === "rate_limit"
    ) {
      db.prepare(
        `UPDATE service_transactions SET
          status = 'failed',
          provider_status = ?,
          provider_message = ?,
          provider_folio = NULL,
          failed_at = CURRENT_TIMESTAMP,
          last_checked_at = CURRENT_TIMESTAMP,
          next_check_at = NULL,
          needs_review = 0,
          review_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      ).run(
        result.providerCode != null ? String(result.providerCode) : null,
        result.message || result.error || "La recarga fue rechazada",
        ledgerId,
      );
      touch();
      return resultFromRow(getById(ledgerId), {
        ok: false,
        code: result.code || "TAECEL_PROVIDER_FAILED",
        error: result.message || result.error || "La recarga fue rechazada",
      });
    }

    const reviewReason =
      result && result.code === "TAECEL_TRANSPORT"
        ? "TRANSPORT_ERROR"
        : "REQUEST_AMBIGUOUS";
    db.prepare(
      `UPDATE service_transactions SET
        status = 'unknown',
        provider_status = ?,
        provider_message = ?,
        needs_review = 1,
        review_reason = ?,
        last_checked_at = CURRENT_TIMESTAMP,
        next_check_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    ).run(
      result && result.providerCode != null ? String(result.providerCode) : null,
      (result && (result.message || result.error)) || "No se pudo confirmar la solicitud",
      reviewReason,
      ledgerId,
    );
    touch();
    return resultFromRow(getById(ledgerId), {
      ok: false,
      code: (result && result.code) || "TAECEL_UNKNOWN",
      error:
        (result && (result.message || result.error)) ||
        "No sabemos si la recarga se envió. Consulta el estado antes de reintentar.",
    });
  };

  const createRecharge = (payload = {}, context = {}) => {
    const id = String(payload.clientRequestId || "").trim();
    if (!id) return doCreate(payload, context);
    if (inFlight.has(id)) return inFlight.get(id);
    const promise = doCreate(payload, context).catch((err) => {
      logger("create-recharge", err);
      return {
        ok: false,
        code: "SERVICE_TX_FAILED",
        error: err.message || "No se pudo registrar la recarga",
      };
    });
    inFlight.set(id, promise);
    promise
      .finally(() => {
        inFlight.delete(id);
      })
      .catch(() => {});
    return promise;
  };

  const getTransaction = ({ transactionId, clientRequestId } = {}) => {
    const row = transactionId
      ? getById(transactionId)
      : getByClientRequestId(clientRequestId);
    if (!row) {
      return { ok: false, code: "SERVICE_TX_NOT_FOUND", error: "No se encontró la operación" };
    }
    return { ok: true, transaction: toUiRow(row) };
  };

  const checkTransaction = async ({ transactionId, clientRequestId, manual = false } = {}) => {
    const row = transactionId
      ? getById(transactionId)
      : getByClientRequestId(clientRequestId);
    if (!row) {
      return { ok: false, code: "SERVICE_TX_NOT_FOUND", error: "No se encontró la operación" };
    }
    const updated = await checkRow(row, { manual: manual === true });
    return { ok: true, transaction: toUiRow(updated || row) };
  };

  const pendingSummary = (registerId) => {
    const rows = db
      .prepare(
        `SELECT status, payment_method, COUNT(*) AS count,
                COALESCE(SUM(amount_cents + COALESCE(fee_cents, 0)),0) AS total_cents
         FROM service_transactions
         WHERE register_id = ?
           AND (status IN ('requesting','pending','unknown')
                OR (status = 'applied' AND needs_review = 1))
         GROUP BY status, payment_method`,
      )
      .all(registerId);
    const byStatus = {
      pending: { count: 0, totalCents: 0 },
      unknown: { count: 0, totalCents: 0 },
      needs_review: { count: 0, totalCents: 0 },
    };
    const byMethod = {};
    let count = 0;
    let totalCents = 0;
    for (const r of rows) {
      const key =
        r.status === "applied"
          ? "needs_review"
          : r.status === "requesting"
            ? "pending"
            : r.status;
      const target = byStatus[key];
      if (target) {
        target.count += Number(r.count) || 0;
        target.totalCents += Number(r.total_cents) || 0;
      }
      const method = r.payment_method || "cash";
      byMethod[method] = byMethod[method] || { count: 0, totalCents: 0 };
      byMethod[method].count += Number(r.count) || 0;
      byMethod[method].totalCents += Number(r.total_cents) || 0;
      count += Number(r.count) || 0;
      totalCents += Number(r.total_cents) || 0;
    }
    return { count, totalCents, byStatus, byMethod, hasPending: count > 0 };
  };

  const history = ({ limit = 100, status = "all", search = "", from, to } = {}) => {
    const where = [];
    const args = [];
    if (status === "attention") {
      where.push(
        "(status = 'unknown' OR status = 'failed' OR (status = 'applied' AND needs_review = 1))",
      );
    } else if (status === "needs_review") {
      where.push("status = 'applied' AND needs_review = 1");
    } else if (status === "pending") {
      where.push("status IN ('requesting','pending')");
    } else if (status === "applied") {
      where.push("status = 'applied' AND needs_review = 0");
    } else if (status === "failed") {
      where.push("status = 'failed'");
    } else if (status === "unknown") {
      where.push("status = 'unknown'");
    }
    const q = String(search || "").trim();
    if (q) {
      const like = `%${q}%`;
      where.push(
        "(reference_masked LIKE ? OR provider_trans_id LIKE ? OR sale_folio LIKE ? OR provider_folio LIKE ? OR carrier_name LIKE ? OR product_name LIKE ? OR ref_cte LIKE ?)",
      );
      args.push(like, like, like, like, like, like, like);
    }
    if (from) {
      where.push("date(requested_at) >= date(?)");
      args.push(String(from));
    }
    if (to) {
      where.push("date(requested_at) <= date(?)");
      args.push(String(to));
    }
    const sql = `SELECT * FROM service_transactions ${
      where.length ? `WHERE ${where.join(" AND ")}` : ""
    } ORDER BY id DESC LIMIT ?`;
    const max = Math.min(Math.max(Number(limit) || 50, 1), HISTORY_LIMIT);
    args.push(max);
    const rows = db.prepare(sql).all(...args);
    return { ok: true, transactions: rows.map(toUiRow), count: rows.length };
  };

  const reconcileDate = async ({ date, bolsa = 1 } = {}) => {
    const salesResult = await taecel.getSales({ date, bolsa });
    if (!salesResult || !salesResult.ok) {
      return {
        ok: false,
        code: (salesResult && salesResult.code) || "TAECEL_SALES_ERROR",
        error:
          (salesResult && (salesResult.error || salesResult.message)) ||
          "No se pudieron consultar las ventas de Taecel",
      };
    }
    const d = String(date || "").trim();
    const rows = db
      .prepare(
        `SELECT * FROM service_transactions
         WHERE status IN ('requesting','pending','unknown')
           AND requested_at >= datetime(?, '-1 day')
           AND requested_at < datetime(?, '+2 day')`,
      )
      .all(d, d);
    const byTrans = new Map();
    const byHash = new Map();
    const byFolio = new Map();
    for (const row of rows) {
      if (row.provider_trans_id) byTrans.set(String(row.provider_trans_id), row);
      if (row.reference_hash) {
        const list = byHash.get(row.reference_hash) || [];
        list.push(row);
        byHash.set(row.reference_hash, list);
      }
      if (row.provider_folio) byFolio.set(String(row.provider_folio), row);
    }

    let matched = 0;
    let applied = 0;
    let failed = 0;
    let unmatched = 0;
    let duplicates = 0;
    const unmatchedList = [];
    const seen = new Set();

    for (const sale of salesResult.sales || []) {
      let row = null;
      if (sale.transId && byTrans.has(String(sale.transId))) {
        row = byTrans.get(String(sale.transId));
      }
      if (!row && sale.phone) {
        const candidates = byHash.get(sha256(sale.phone)) || [];
        const exact = candidates.filter(
          (c) =>
            Number(c.amount_cents) === Number(sale.amountCents) &&
            !seen.has(c.id),
        );
        if (exact.length === 1) row = exact[0];
        else if (exact.length > 1) duplicates += 1;
      }
      if (!row && sale.folio && byFolio.has(String(sale.folio))) {
        row = byFolio.get(String(sale.folio));
      }
      if (!row) {
        unmatched += 1;
        if (unmatchedList.length < 20) unmatchedList.push(sale.sanitized);
        continue;
      }
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      matched += 1;
      const updated = applyStatus(row, { ok: true, ...sale });
      if (updated && updated.status === "applied") applied += 1;
      else if (updated && updated.status === "failed") failed += 1;
    }

    return {
      ok: true,
      matched,
      applied,
      failed,
      unmatched,
      duplicates,
      unmatchedSales: unmatchedList,
      totalProviderSales: (salesResult.sales || []).length,
    };
  };

  const recoverAmbiguous = () => {
    const staleRequests = db
      .prepare(
        "SELECT * FROM service_transactions WHERE status = 'requesting' AND requested_at <= datetime('now','-2 minutes')",
      )
      .all();
    for (const row of staleRequests) {
      markUnknown(row, "REQUEST_STALE", {
        message: "La solicitud no confirmó a tiempo",
      });
    }
    const stalePending = db
      .prepare(
        "SELECT * FROM service_transactions WHERE status = 'pending' AND requested_at <= datetime('now', ?)",
      )
      .all(`-${PENDING_STALE_SEC} seconds`);
    for (const row of stalePending) {
      markUnknown(row, "POLL_STALE", {
        message: "No se pudo confirmar la recarga con el operador",
      });
    }
  };

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      recoverAmbiguous();
      // Retoma las pendientes sin ciclo cuando les toca: el siguiente getSales
      // agendado o, tras reiniciar la app, el ciclo interrumpido. Si ya pasaron
      // 60 s, el ciclo va directo a getSales.
      const rows = db
        .prepare(
          `SELECT * FROM service_transactions
           WHERE status = 'pending'
             AND provider_trans_id IS NOT NULL
             AND (next_check_at IS NULL OR next_check_at <= CURRENT_TIMESTAMP)
           ORDER BY id ASC`,
        )
        .all();
      for (const row of rows) {
        if (!cycles.has(row.id)) ensureStatusCycle(row);
      }
    } catch (err) {
      logger("poller", err);
    } finally {
      ticking = false;
    }
  };

  const startPoller = ({ intervalMs = POLL_INTERVAL_MS } = {}) => {
    if (poller) return;
    poller = setInterval(() => {
      tick().catch((err) => logger("poller", err));
    }, intervalMs);
    if (typeof poller.unref === "function") poller.unref();
    tick().catch((err) => logger("poller", err));
  };

  const stopPoller = () => {
    if (poller) clearInterval(poller);
    poller = null;
  };

  return {
    createRecharge,
    getFees,
    setFees,
    withFees,
    getTransaction,
    checkTransaction,
    pendingSummary,
    history,
    reconcileDate,
    recoverAmbiguous,
    startPoller,
    stopPoller,
    // expuesto para pruebas / mantenimiento
    _toUiRow: toUiRow,
    _recoverAmbiguous: recoverAmbiguous,
  };
};

module.exports = { createServiceTransactions };
