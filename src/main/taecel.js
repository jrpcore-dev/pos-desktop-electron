"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Adaptador REST de Taecel (reemplaza por completo a Vendesaldo).
//
//   POST https://taecel.com/app/api/<metodo>
//   content-type: application/x-www-form-urlencoded
//   key=...&nip=...
//
// Reglas duras:
//   · El HTTP no es autoritativo: siempre se lee el JSON {success,error,...}.
//   · RequestTXN sólo devuelve transID. El resultado se consulta con StatusTXN.
//   · Si una solicitud es ambigua (timeout/red/8888), NUNCA se reenvía sola.
//   · Las credenciales se cifran con safeStorage y jamás salen al renderer.
//   · getProducts y getBalance se cachean (24 h / 5 min) para respetar el
//     límite de Taecel y evitar el 429.
// ─────────────────────────────────────────────────────────────────────────────

const {
  mapRequestError,
  mapStatusError,
  normalizeStatus,
  parseMoneyToCents,
  maskReference,
  normalizeReference,
  providerMessage,
} = require("./taecel-errors");

const DEFAULT_BASE_URL = "https://taecel.com/app/api";
const LOGO_BASE_URL = "https://app.taecel.com/";

const KEY_SETTING = "taecel_credentials_enc";
const KEY_AT_SETTING = "taecel_credentials_at";
const KEY_BY_SETTING = "taecel_credentials_by";
const BALANCE_SETTING = "taecel_balance_json";
const CATALOG_SETTING = "taecel_catalog_json";
const CATALOG_AT_SETTING = "taecel_catalog_at";
const LAST_ERROR_SETTING = "taecel_last_error";

const BALANCE_TTL_MS = 5 * 60 * 1000; // 5 min (doc: 5–10 min)
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // 1 vez al día
const CATALOG_COOLDOWN_MS = 60 * 60 * 1000; // refresco manual: 1/hora
const SALES_TTL_MS = 5 * 60 * 1000;

const CATEGORY_META = {
  1: { key: "telefonia", kind: "airtime", variant: "recarga", label: "Tiempo aire" },
  2: { key: "paquetes", kind: "package", variant: "paquete", label: "Paquete" },
  3: { key: "servicios", kind: "bill", variant: "servicio", label: "Pago de servicio" },
  4: { key: "tarjetas", kind: "giftcard", variant: "tarjeta", label: "Tarjeta" },
};

// Orden curado: los operadores que más se venden primero; el resto alfabético.
const CARRIER_ORDER = [
  "telcel",
  "movistar",
  "at&t",
  "att",
  "unefon",
  "virgin",
  "bait",
  "weex",
  "flash mobile",
  "oxxo",
  "soriana",
  "cierto",
  "maztiempo",
  "wimo",
  "pillo",
  "simpati",
  "gugacom",
  "freedompop",
  "dirimovil",
  "nextel",
  "iusacell",
];

const LOCAL_LOGO_KEYS = {
  telcel: "telcel",
  movistar: "movistar",
  "at&t": "att",
  att: "att",
  unefon: "unefon",
  virgin: "virgin",
  "virgin mobile": "virgin",
  bait: "bait",
  weex: "weex",
  "flash mobile": "flash",
  oxxo: "oxxo",
  soriana: "soriana",
  nextel: "nextel",
  iusacell: "iusacell",
  pillofon: "pillo",
  "pillo fon": "pillo",
  cfe: "cfe",
  telmex: "telmex",
  megacable: "megacable",
  naturgy: "naturgy",
  // Taecel agrupa marcas en un solo carrier ("Paquetes BAIT") que por prefijo
  // no se alcanza a casar; se listan a mano.
  "paquetes bait": "bait",
  "bait internet casa": "bait",
};

const safeJson = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
};

const timeoutSignal = (ms) => {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (timer && typeof timer.unref === "function") timer.unref();
  return controller.signal;
};

const maskKey = (key) => {
  const v = String(key || "");
  if (!v) return "";
  if (v.length <= 4) return "*".repeat(v.length);
  return `${"*".repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
};

const slug = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

// Nombre de marca -> llave del SVG local. El catálogo de Taecel trae
// variantes de la misma marca ("CFE Teit", "AT&T (Iusacell - Nextel)",
// "Telcel Internet Amigo", "Paquetes BAIT"): primero se intenta el nombre
// exacto y luego el prefijo, para que esas variantes caigan sobre el logo
// que ya existe en vez de un bloque de color con iniciales.
const localLogoKey = (name) => {
  const s = slug(name);
  if (LOCAL_LOGO_KEYS[s]) return LOCAL_LOGO_KEYS[s];

  // Prefijo: "cfe teit" -> "cfe", "telcel internet amigo" -> "telcel".
  const words = s.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const head = words.slice(0, n).join(" ");
    if (LOCAL_LOGO_KEYS[head]) return LOCAL_LOGO_KEYS[head];
  }

  // "AT&T (Iusacell - Nextel)" trae la marca entre paréntesis.
  const paren = s.match(/\(([^)]+)\)/);
  if (paren && LOCAL_LOGO_KEYS[paren[1].trim()]) {
    return LOCAL_LOGO_KEYS[paren[1].trim()];
  }

  // "FlashMobile" (sin espacio) debe caer sobre "flash mobile".
  const bare = s.replace(/[^a-z0-9]/g, "");
  for (const [key, value] of Object.entries(LOCAL_LOGO_KEYS)) {
    const keyBare = key.replace(/[^a-z0-9]/g, "");
    if (keyBare && bare.startsWith(keyBare)) return value;
  }

  return bare;
};

const absoluteLogo = (value) => {
  const v = String(value || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `${LOGO_BASE_URL.replace(/\/$/, "")}${v}`;
  return `${LOGO_BASE_URL}${v}`;
};

const carrierRank = (name) => {
  const n = slug(name);
  const i = CARRIER_ORDER.indexOf(n);
  return i === -1 ? 999 : i;
};

const normalizeBalance = (data) => {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  let airtimeCents = null;
  let servicesCents = null;
  let cfdiCents = null;
  for (const row of rows) {
    const id = String(row.ID ?? row.id ?? "");
    const name = slug(row.Bolsa ?? row.bolsa ?? "");
    const cents = parseMoneyToCents(row.Saldo ?? row.saldo);
    if (id === "1" || name.includes("tiempo aire") || name.includes("recarga")) {
      airtimeCents = cents;
    } else if (id === "2" || name.includes("servicio")) {
      servicesCents = cents;
    } else if (id === "3" || name.includes("timbre")) {
      cfdiCents = cents;
    }
  }
  return { airtimeCents, servicesCents, cfdiCents };
};

const getField = (data, names) => {
  const wanted = names.map((n) => n.toLowerCase().replace(/[\s_]/g, ""));
  for (const [key, value] of Object.entries(data || {})) {
    if (wanted.includes(key.toLowerCase().replace(/[\s_]/g, ""))) return value;
  }
  return undefined;
};

const normalizeStatusData = (data, message) => {
  const rawStatus = getField(data, ["Status", "status", "Estatus"]);
  const phone = getField(data, ["Telefono", "Teléfono", "referencia", "Referencia"]);
  const folio = getField(data, ["Folio", "folio"]);
  const transId = getField(data, ["TransID", "transID", "Transid"]);
  const amount = getField(data, ["Monto", "monto"]);
  const cargo = getField(data, ["Cargo", "cargo"]);
  const abono = getField(data, ["Abono", "abono"]);
  const saldoFinal = getField(data, ["Saldo Final", "saldo_final", "SaldoFinal"]);
  const comision = getField(data, ["Comision", "Comisión", "comision"]);
  const carrier = getField(data, ["Carrier", "carrier"]);
  const date = getField(data, ["Fecha", "fecha"]);
  const via = getField(data, ["Via", "Vía", "via"]);
  const region = getField(data, ["Región", "Region", "region"]);
  const bolsa = getField(data, ["Bolsa", "bolsa"]);
  const timeout = getField(data, ["Timeout", "timeout"]);
  const ip = getField(data, ["IP", "ip"]);

  const sanitized = {
    TransID: transId ?? null,
    Fecha: date ?? null,
    Carrier: carrier ?? null,
    Telefono: phone ? maskReference(phone) : null,
    Folio: folio ?? null,
    Status: rawStatus ?? null,
    Monto: amount ?? null,
    Cargo: cargo ?? null,
    Abono: abono ?? null,
    Via: via ?? null,
    "Región": region ?? null,
    Bolsa: bolsa ?? null,
    "Saldo Final": saldoFinal ?? null,
    Comision: comision ?? null,
  };

  return {
    rawStatus: rawStatus == null ? null : String(rawStatus),
    status: normalizeStatus(rawStatus),
    transId: transId == null ? null : String(transId),
    phone: phone == null ? null : normalizeReference(phone),
    folio: folio == null ? null : String(folio),
    amountCents: parseMoneyToCents(amount),
    cargoCents: parseMoneyToCents(cargo),
    abonoCents: parseMoneyToCents(abono),
    saldoFinalCents: parseMoneyToCents(saldoFinal),
    comisionCents: parseMoneyToCents(comision),
    carrier: carrier == null ? null : String(carrier),
    date: date == null ? null : String(date),
    via: via == null ? null : String(via),
    region: region == null ? null : String(region),
    bolsa: bolsa == null ? null : String(bolsa),
    timeout: timeout == null ? null : String(timeout),
    ip: ip == null ? null : String(ip),
    message: message == null ? null : String(message),
    sanitized,
  };
};

const normalizeSale = (row) => normalizeStatusData(row, null);

const normalizeCatalog = (data, fetchedAt = Date.now()) => {
  const payload = data && typeof data === "object" ? data : {};
  const categories = Array.isArray(payload.categorias) ? payload.categorias : [];
  const bolsas = Array.isArray(payload.bolsas) ? payload.bolsas : [];
  const carrierRows = Array.isArray(payload.carriers) ? payload.carriers : [];
  const productRows = Array.isArray(payload.productos) ? payload.productos : [];

  const allProducts = [];
  for (const raw of productRows) {
    const code = String(raw.Codigo ?? raw.codigo ?? "").trim();
    if (!code) continue;
    const categoryId = Number(raw.CategoriaID ?? raw.categoriaId ?? 0);
    const amountCents = parseMoneyToCents(raw.Monto ?? raw.monto);
    if (!Number.isFinite(amountCents) || amountCents <= 0) continue;
    allProducts.push({
      code,
      sku: code,
      name: String(raw.Descripcion || raw.Nombre || `Recarga $${(amountCents / 100).toFixed(2)}`).trim(),
      description: String(raw.Descripcion || "").trim(),
      vigencia: String(raw.Vigencia || "").trim(),
      amountCents,
      categoryId,
      carrierId: String(raw.CarrierID ?? raw.carrierId ?? ""),
      carrierName: String(raw.Carrier || raw.carrier || "").trim(),
      bolsaId: String(raw.BolsaID ?? ""),
    });
  }

  const carriers = [];
  for (const raw of carrierRows) {
    const id = String(raw.ID ?? raw.id ?? "").trim();
    if (!id) continue;
    const categoryId = Number(raw.CategoriaID ?? raw.categoriaId ?? 0);
    const meta = CATEGORY_META[categoryId] || {
      key: "otros",
      kind: "airtime",
      variant: "recarga",
      label: "Otros",
    };
    const fieldsRaw = Array.isArray(raw.Campos)
      ? raw.Campos
      : raw.Campos && typeof raw.Campos === "object"
        ? [raw.Campos]
        : [];
    const fields = fieldsRaw.map((f) => ({
      nombre: String(f.Nombre || "Número de teléfono").trim(),
      campo: String(f.Campo || "referencia").trim(),
      min: Number(f.Min) || 1,
      max: Number(f.Max) || 32,
      formato: String(f.Formato ?? "").trim(),
      numeric: String(f.Formato ?? "1") === "1",
      obligatorio: String(f.Obligatorio ?? "1") === "1",
      confirmar: String(f.Confirmar ?? "0") === "1",
      iniCero: String(f.iniCero ?? "0") === "1",
      raw: f,
    }));
    const referenceField =
      fields.find((f) => f.campo.toLowerCase() === "referencia") || fields[0] || null;
    const name = String(raw.Nombre || raw.nombre || "").trim() || `Carrier ${id}`;
    const carrierType = Number(raw.Tipo ?? 0) || 0;
    const commission = Array.isArray(raw.Comision) ? raw.Comision[0] : raw.Comision;
    const products = allProducts
      .filter((p) => p.carrierId === id)
      .sort((a, b) => a.amountCents - b.amountCents || a.name.localeCompare(b.name));

    // Todas las categorías del catálogo de la cuenta: tiempo aire (1), paquetes
    // (2), pago de servicios (3) y tarjetas de regalo (4). Los carriers sin
    // productos no aparecen en la rejilla.
    const sellable = products.filter((p) => Number(p.categoryId) > 0);
    if (!sellable.length) continue;

    carriers.push({
      id,
      key: id,
      name,
      logo: absoluteLogo(raw.Logotipo),
      logoKey: localLogoKey(name),
      categoryId,
      category: meta.key,
      kind: meta.kind,
      variant: meta.variant,
      type: carrierType,
      freeAmount: carrierType === 1,
      feeCents: 0,
      commission: commission
        ? {
            clienteCents: parseMoneyToCents(commission.ComisionCliente),
            cargoCents: parseMoneyToCents(commission.CargoTrans),
            abonoCents: parseMoneyToCents(commission.AbonoTrans),
            tipoCargo: String(commission.TipoCargo ?? ""),
            tipoAbono: String(commission.TipoAbono ?? ""),
          }
        : null,
      fields,
      input: referenceField
        ? {
            kind: referenceField.numeric ? "phone" : "contract",
            label: referenceField.nombre,
            placeholder: referenceField.numeric
              ? `${referenceField.min} dígitos`
              : "Dato de referencia",
            hint: referenceField.obligatorio ? "A nombre del titular" : "",
            numeric: referenceField.numeric,
            min: referenceField.min,
            max: referenceField.max,
            campo: referenceField.campo,
            confirmar: referenceField.confirmar,
            iniCero: referenceField.iniCero,
          }
        : {
            kind: "phone",
            label: "Número de teléfono",
            placeholder: "10 dígitos",
            hint: "A nombre del titular",
            numeric: true,
            min: 10,
            max: 10,
            campo: "referencia",
            confirmar: true,
            iniCero: false,
          },
      products: sellable.map((p) => ({
        sku: p.sku,
        code: p.code,
        name: p.name,
        description: p.description,
        vigencia: p.vigencia,
        amountCents: p.amountCents,
        categoryId: p.categoryId,
        carrierId: p.carrierId,
      })),
    });
  }

  carriers.sort((a, b) => carrierRank(a.name) - carrierRank(b.name) || a.name.localeCompare(b.name));

  return {
    fetchedAt,
    categories: categories.map((c) => ({
      id: String(c.ID ?? ""),
      name: String(c.Nombre ?? ""),
      icon: String(c.Icono ?? ""),
    })),
    bolsas: bolsas.map((b) => ({ id: String(b.ID ?? ""), name: String(b.Nombre ?? "") })),
    carriers,
    products: allProducts,
    // La rejilla de la UI consume exactamente esta forma.
    operators: carriers,
    meta: {
      fetchedAt,
      carrierCount: carriers.length,
      productCount: allProducts.length,
      sellableProducts: carriers.reduce((acc, c) => acc + c.products.length, 0),
    },
  };
};

const createTaecel = ({
  db,
  cipher,
  fetchImpl = globalThis.fetch,
  baseUrl = process.env.TAECEL_BASE_URL || DEFAULT_BASE_URL,
} = {}) => {
  if (!db) throw new Error("createTaecel requiere db");
  if (typeof fetchImpl !== "function") throw new Error("createTaecel requiere fetch");

  let catalogInFlight = null;
  const salesCache = new Map();

  const getSetting = (key) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : null;
  };
  const setSetting = (key, value) => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      key,
      String(value),
    );
  };
  const deleteSetting = (key) => {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  };

  const readCredentials = () => {
    const raw = getSetting(KEY_SETTING);
    if (!raw) return null;
    try {
      if (!cipher || typeof cipher.decryptString !== "function") return null;
      const json = JSON.parse(cipher.decryptString(Buffer.from(raw, "base64")));
      if (!json || !json.key || !json.nip) return null;
      return { key: String(json.key), nip: String(json.nip) };
    } catch (err) {
      return null;
    }
  };

  const credentialsReady = () => !!readCredentials();

  const saveCredentials = (key, nip, by = null) => {
    const k = String(key || "").trim();
    const n = String(nip || "").trim();
    if (!k || !n) {
      return {
        ok: false,
        code: "TAECEL_INVALID_CREDENTIALS",
        error: "La Key y el NIP son obligatorios",
      };
    }
    if (!cipher || typeof cipher.encryptString !== "function" || !cipher.isEncryptionAvailable?.()) {
      return {
        ok: false,
        code: "TAECEL_ENCRYPTION_UNAVAILABLE",
        error: "El sistema no tiene cifrado disponible; no se pueden guardar las credenciales",
      };
    }
    try {
      const enc = cipher.encryptString(JSON.stringify({ key: k, nip: n })).toString("base64");
      setSetting(KEY_SETTING, enc);
      setSetting(KEY_AT_SETTING, new Date().toISOString());
      if (by != null) setSetting(KEY_BY_SETTING, String(by));
      deleteSetting(BALANCE_SETTING); // el saldo es por cuenta
      deleteSetting(LAST_ERROR_SETTING);
      salesCache.clear();
      return { ok: true, configured: true, maskedKey: maskKey(k) };
    } catch (err) {
      return {
        ok: false,
        code: "TAECEL_ENCRYPTION_FAILED",
        error: `No se pudieron cifrar las credenciales: ${err.message}`,
      };
    }
  };

  const encryptReference = (value) => {
    const v = String(value || "").trim();
    if (!v) return null;
    try {
      if (!cipher || typeof cipher.encryptString !== "function" || !cipher.isEncryptionAvailable?.()) {
        return null;
      }
      return cipher.encryptString(v).toString("base64");
    } catch (err) {
      return null;
    }
  };

  const decryptReference = (enc) => {
    if (!enc) return null;
    try {
      return cipher.decryptString(Buffer.from(enc, "base64"));
    } catch (err) {
      return null;
    }
  };

  const setLastError = (method, mapped) => {
    try {
      setSetting(
        LAST_ERROR_SETTING,
        JSON.stringify({
          method,
          code: mapped.code || null,
          message: mapped.message || mapped.error || "Error de Taecel",
          at: new Date().toISOString(),
        }),
      );
    } catch (err) {}
  };

  const clearLastError = () => {
    try {
      deleteSetting(LAST_ERROR_SETTING);
    } catch (err) {}
  };

  const call = async (method, params, timeoutMs = 15000) => {
    const url = `${String(baseUrl).replace(/\/$/, "")}/${method}`;
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "user-agent": "Vendia/2.0 (Taecel)",
        },
        body: new URLSearchParams(params).toString(),
        signal: timeoutSignal(timeoutMs),
      });
    } catch (err) {
      const e = new Error(`No se pudo conectar con Taecel: ${err.message}`);
      e.code = "TAECEL_TRANSPORT";
      e.ambiguous = true;
      throw e;
    }
    let text = "";
    try {
      text = await res.text();
    } catch (err) {
      const e = new Error(`Taecel cortó la respuesta: ${err.message}`);
      e.code = "TAECEL_TRANSPORT";
      e.ambiguous = true;
      throw e;
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      const e = new Error(`Taecel respondió HTTP ${res.status} sin JSON`);
      e.code = "TAECEL_BAD_RESPONSE";
      e.ambiguous = true;
      e.httpStatus = res.status;
      throw e;
    }
    return { httpStatus: res.status, json };
  };

  const transportFailure = (err) => ({
    ok: false,
    kind: "unknown",
    code: "TAECEL_TRANSPORT",
    message: err.message || "No se pudo conectar con Taecel",
    retryable: false,
    ambiguous: true,
    httpStatus: err.httpStatus ?? null,
  });

  const getBalance = async ({ force = false } = {}) => {
    const creds = readCredentials();
    if (!creds) {
      return {
        ok: false,
        code: "TAECEL_NOT_CONFIGURED",
        error: "Taecel no está configurado",
      };
    }
    const cached = safeJson(getSetting(BALANCE_SETTING), null);
    const cachedAt = cached && Number(cached.at) ? Number(cached.at) : 0;
    if (!force && cached && Date.now() - cachedAt < BALANCE_TTL_MS) {
      return { ok: true, ...cached, cached: true, stale: false };
    }
    try {
      const { httpStatus, json } = await call("getBalance", creds, 15000);
      if (json.success && Number(json.error) === 0) {
        const balance = normalizeBalance(json.data);
        const next = { ...balance, at: Date.now(), source: "getBalance" };
        setSetting(BALANCE_SETTING, JSON.stringify(next));
        clearLastError();
        return { ok: true, ...next, cached: false, stale: false, httpStatus };
      }
      const mapped = mapRequestError(json.error, json.message, httpStatus);
      setLastError("getBalance", mapped);
      return { ok: false, ...mapped, error: mapped.message, cached: cached || null };
    } catch (err) {
      const mapped = transportFailure(err);
      setLastError("getBalance", mapped);
      return { ok: false, ...mapped, error: mapped.message, cached: cached || null };
    }
  };

  const normalizeAndStoreCatalog = (data) => {
    const catalog = normalizeCatalog(data, Date.now());
    setSetting(CATALOG_SETTING, JSON.stringify(catalog));
    setSetting(CATALOG_AT_SETTING, String(catalog.fetchedAt));
    return catalog;
  };

  const fetchCatalog = async () => {
    const creds = readCredentials();
    if (!creds) {
      return {
        ok: false,
        code: "TAECEL_NOT_CONFIGURED",
        error: "Taecel no está configurado",
      };
    }
    try {
      const { httpStatus, json } = await call("getProducts", creds, 30000);
      if (!json.success || Number(json.error) !== 0) {
        const mapped = mapRequestError(json.error, json.message, httpStatus);
        setLastError("getProducts", mapped);
        return { ok: false, ...mapped, error: mapped.message };
      }
      const catalog = normalizeAndStoreCatalog(json.data);
      clearLastError();
      return { ok: true, ...catalog, cached: false, stale: false, httpStatus };
    } catch (err) {
      const mapped = transportFailure(err);
      setLastError("getProducts", mapped);
      return { ok: false, ...mapped, error: mapped.message };
    }
  };

  // El cache guarda el logoKey ya calculado; si se mejora el mapeo de logos
  // (o Taecel renombra un carrier) hay que poder verlo sin esperar a que
  // venza la TTL de 24 h. Al servir desde cache se rederiva desde el nombre.
  const recomputeLogoKeys = (catalog) => ({
    ...catalog,
    operators: (catalog.operators || []).map((op) => ({
      ...op,
      logoKey: localLogoKey(op.name),
    })),
  });

  const getCatalog = async ({ force = false } = {}) => {
    const cached = safeJson(getSetting(CATALOG_SETTING), null);
    const cachedAt = cached && Number(cached.fetchedAt) ? Number(cached.fetchedAt) : 0;
    const fresh = cached && Date.now() - cachedAt < CATALOG_TTL_MS;

    if (!force && cached) {
      if (!fresh && !catalogInFlight) {
        // Stale-while-revalidate: se entrega el catálogo actual y se refresca
        // en segundo plano sin bloquear la venta.
        catalogInFlight = fetchCatalog()
          .catch(() => null)
          .finally(() => {
            catalogInFlight = null;
          });
      }
      return { ok: true, ...recomputeLogoKeys(cached), cached: true, stale: !fresh };
    }

    if (force && cached) {
      const last = Number(getSetting(CATALOG_AT_SETTING) || 0);
      if (Date.now() - last < CATALOG_COOLDOWN_MS) {
        return {
          ok: true,
          ...recomputeLogoKeys(cached),
          cached: true,
          stale: !fresh,
          cooldown: true,
          message: "El catálogo se actualizó hace menos de una hora",
        };
      }
    }

    if (catalogInFlight) return catalogInFlight;
    catalogInFlight = fetchCatalog().finally(() => {
      catalogInFlight = null;
    });
    const result = await catalogInFlight;
    if (!result.ok && cached) {
      return {
        ok: true,
        ...recomputeLogoKeys(cached),
        cached: true,
        stale: true,
        warning: result.error || result.message,
      };
    }
    return result;
  };

  const requestTxn = async ({ productCode, reference, amountCents = 0, refCte, freeAmount = false }) => {
    const creds = readCredentials();
    if (!creds) {
      return {
        ok: false,
        kind: "config",
        code: "TAECEL_NOT_CONFIGURED",
        message: "Taecel no está configurado",
        retryable: false,
      };
    }
    const params = {
      key: creds.key,
      nip: creds.nip,
      producto: String(productCode || "").trim(),
      referencia: normalizeReference(reference),
    };
    const amount = Number(amountCents);
    if (freeAmount && Number.isFinite(amount) && amount > 0) {
      params.monto = (amount / 100).toFixed(2);
    }
    const ref = String(refCte || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 45);
    if (ref) params.refCte = ref;

    try {
      const { httpStatus, json } = await call("RequestTXN", params, 25000);
      if (json.success && Number(json.error) === 0 && json.data && json.data.transID) {
        clearLastError();
        return {
          ok: true,
          transId: String(json.data.transID),
          envelope: json,
          httpStatus,
        };
      }
      if (json.success && Number(json.error) === 0) {
        const mapped = {
          ok: false,
          kind: "unknown",
          code: "TAECEL_NO_TRANSID",
          message: "Taecel aceptó la solicitud pero no devolvió transID",
          retryable: false,
          ambiguous: true,
          httpStatus,
          envelope: json,
        };
        setLastError("RequestTXN", mapped);
        return mapped;
      }
      const mapped = mapRequestError(json.error, json.message, httpStatus);
      setLastError("RequestTXN", mapped);
      return { ok: false, ...mapped, error: mapped.message, envelope: json, httpStatus };
    } catch (err) {
      const mapped = transportFailure(err);
      setLastError("RequestTXN", mapped);
      return { ok: false, ...mapped, error: mapped.message };
    }
  };

  const statusTxn = async (transId) => {
    const creds = readCredentials();
    if (!creds) {
      return {
        ok: false,
        kind: "config",
        code: "TAECEL_NOT_CONFIGURED",
        message: "Taecel no está configurado",
        retryable: false,
      };
    }
    try {
      const { httpStatus, json } = await call(
        "StatusTXN",
        { key: creds.key, nip: creds.nip, transID: String(transId || "").trim() },
        15000,
      );
      if (json.success && Number(json.error) === 0) {
        const data = json.data && typeof json.data === "object" ? json.data : {};
        const normalized = normalizeStatusData(data, json.message);
        clearLastError();
        return { ok: true, ...normalized, envelope: json, httpStatus };
      }
      const mapped = mapStatusError(json.error, json.message, httpStatus);
      setLastError("StatusTXN", mapped);
      return { ok: false, ...mapped, error: mapped.message, envelope: json, httpStatus };
    } catch (err) {
      const mapped = transportFailure(err);
      setLastError("StatusTXN", mapped);
      return { ok: false, ...mapped, error: mapped.message };
    }
  };

  const getSales = async ({ date, bolsa = 1 } = {}) => {
    const creds = readCredentials();
    if (!creds) {
      return {
        ok: false,
        code: "TAECEL_NOT_CONFIGURED",
        error: "Taecel no está configurado",
      };
    }
    const fecha = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return {
        ok: false,
        code: "TAECEL_INVALID_DATE",
        error: "La fecha debe tener formato YYYY-MM-DD",
      };
    }
    const b = String(bolsa) === "2" ? 2 : 1;
    const cacheKey = `${fecha}:${b}`;
    const cached = salesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SALES_TTL_MS) {
      return { ...cached.result, cached: true };
    }
    try {
      const { httpStatus, json } = await call(
        "getSales",
        { key: creds.key, nip: creds.nip, fecha, bolsa: b },
        20000,
      );
      if (json.success && Number(json.error) === 0) {
        const rows = Array.isArray(json.data) ? json.data : [];
        const result = {
          ok: true,
          sales: rows.map(normalizeSale),
          httpStatus,
          cached: false,
        };
        salesCache.set(cacheKey, { at: Date.now(), result });
        clearLastError();
        return result;
      }
      const mapped = mapRequestError(json.error, json.message, httpStatus);
      setLastError("getSales", mapped);
      return { ok: false, ...mapped, error: mapped.message, httpStatus };
    } catch (err) {
      const mapped = transportFailure(err);
      setLastError("getSales", mapped);
      return { ok: false, ...mapped, error: mapped.message };
    }
  };

  const testCredentials = async (key, nip) => {
    const k = String(key || "").trim();
    const n = String(nip || "").trim();
    if (!k || !n) {
      return { ok: false, code: "TAECEL_INVALID_CREDENTIALS", error: "La Key y el NIP son obligatorios" };
    }
    try {
      const { httpStatus, json } = await call("getBalance", { key: k, nip: n }, 15000);
      if (json.success && Number(json.error) === 0) {
        return {
          ok: true,
          balance: normalizeBalance(json.data),
          httpStatus,
        };
      }
      const mapped = mapRequestError(json.error, json.message, httpStatus);
      return { ok: false, ...mapped, error: mapped.message, httpStatus };
    } catch (err) {
      const mapped = transportFailure(err);
      return { ok: false, ...mapped, error: mapped.message };
    }
  };

  const getStatus = () => {
    const creds = readCredentials();
    const balance = safeJson(getSetting(BALANCE_SETTING), null);
    const lastError = safeJson(getSetting(LAST_ERROR_SETTING), null);
    const catalogAt = Number(getSetting(CATALOG_AT_SETTING) || 0) || null;
    return {
      ok: true,
      configured: !!creds,
      maskedKey: creds ? maskKey(creds.key) : null,
      credentialsAt: getSetting(KEY_AT_SETTING) || null,
      balance: balance || null,
      catalogAt,
      lastError: lastError || null,
    };
  };

  const rememberBalanceFromStatus = (categoryId, cents) => {
    const saldo = Number(cents);
    if (!Number.isFinite(saldo) || saldo < 0) return;
    const cached = safeJson(getSetting(BALANCE_SETTING), null) || {
      airtimeCents: null,
      servicesCents: null,
      cfdiCents: null,
    };
    const next = { ...cached, at: Date.now(), source: "StatusTXN" };
    if (Number(categoryId) === 3 || Number(categoryId) === 4) {
      next.servicesCents = saldo;
    } else {
      next.airtimeCents = saldo;
    }
    setSetting(BALANCE_SETTING, JSON.stringify(next));
  };

  const clearSalesCache = () => salesCache.clear();

  return {
    // credenciales
    credentialsReady,
    readCredentials,
    saveCredentials,
    testCredentials,
    getStatus,
    maskKey,
    encryptReference,
    decryptReference,
    // proveedor
    getBalance,
    getCatalog,
    requestTxn,
    statusTxn,
    getSales,
    rememberBalanceFromStatus,
    clearSalesCache,
    clearLastError,
    // helpers expuestos para pruebas
    _normalizeCatalog: normalizeCatalog,
    _normalizeBalance: normalizeBalance,
    _normalizeStatusData: normalizeStatusData,
    _normalizeSale: normalizeSale,
    _providerMessage: providerMessage,
  };
};

module.exports = {
  createTaecel,
  normalizeCatalog,
  normalizeBalance,
  normalizeStatusData,
  normalizeSale,
  maskKey,
  absoluteLogo,
  localLogoKey,
  DEFAULT_BASE_URL,
};
