// Adaptador SOAP del proveedor Vendesaldo.
//
// SOAP 1.2 RPC, sin WSDL. El envelope lleva una sola función por petición y un
// único parámetro <xml> con el XML interno de esa función:
//
//   <PDV><Tipo>1</Tipo><Usuario>…</Usuario><Password>…</Password></PDV>
//
// Las credenciales se leen de la tabla settings (`vendesaldo_user` /
// `vendesaldo_pass`) o de las variables de entorno `VENDIA_VD_USER` y
// `VENDIA_VD_PASS`. No se escriben en el repositorio.
const https = require("https");
const { URL } = require("url");

const ENDPOINT = "https://vendesaldo.mx/api/index.php";
const TO_TIMEOUT = 90 * 1000;

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
const htmldecode = (s) =>
  String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const PDV_TAGS = { Tipo: "1", Usuario: "", Password: "" };

const PRETTY = {
  ABIB: "Abib",
  AXIOS: "Axios",
  BAIT: "Bait",
  BIENESTAR: "Bienestar",
  CFE: "CFE",
  FLASH: "Flash",
  IUSACELL_ATT: "AT&T",
  JESNER: "Jesner",
  MIMOVIL: "Mi Móvil",
  MOVISTAR: "Movistar",
  NEWWW: "Newww",
  NEXTEL: "Nextel",
  OUI: "Oui",
  PILLOFON: "Pillofón",
  TELCEL: "Telcel",
  TELCEL_INTERNET_AMIGO: "Telcel Internet Amigo",
  TELCEL_SIN_LIMITE: "Telcel Sin Límite",
  TURBOCEL: "Turbocel",
  ULTRACEL: "Ultracel",
  UNEFON: "Unefon",
  VALOR_TELECOMM: "Valor Telecom",
  VIRGIN: "Virgin",
  WIMO_TELECOM: "Wimo Telecom",
};

const LOGO = {
  TELCEL: "telcel",
  TELCEL_INTERNET_AMIGO: "telcel",
  TELCEL_SIN_LIMITE: "telcel",
  MOVISTAR: "movistar",
  IUSACELL_ATT: "att",
  VIRGIN: "virgin",
  CFE: "cfe",
};

const PAQUETES = new Set(["TELCEL_SIN_LIMITE", "TELCEL_INTERNET_AMIGO"]);

// El SKU de los paquetes codifica precio*1000+variante (10007 = $10). Para las
// recargas simples el SKU es el propio monto. El precio nominal viaja en el
// nombre, por eso se prefiere el "$" del nombre cuando existe.
const priceCents = (sku, name) => {
  const $ = String(name || "").match(/\$(\d{1,5}(?:\.\d{1,2})?)/);
  if ($) return Math.round(parseFloat($[1]) * 100);
  const s = parseInt(sku, 10);
  if (s > 999) return Math.floor(s / 1000) * 100;
  return s * 100;
};

const call = (fn, innerXml) =>
  new Promise((resolve, reject) => {
    const envelope = [
      '<soapenv:Envelope xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"',
      ' xmlns:api="' + ENDPOINT + '">',
      "<soapenv:Header/>",
      "<soapenv:Body>",
      "<api:" + fn + "><api:xml>" + esc(innerXml) + "</api:xml></api:" + fn + ">",
      "</soapenv:Body>",
      "</soapenv:Envelope>",
    ].join("");

    const url = new URL(ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(envelope),
          "User-Agent": "Vendia/2.0",
          Accept: "application/soap+xml",
        },
        timeout: TO_TIMEOUT,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          const m = body.match(
            /<return[^>]*>([\s\S]*?)<\/return>/,
          );
          if (!m) return reject(new Error("Respuesta sin <return>: " + body.slice(0, 400)));
          try {
            resolve(htmldecode(m[1]));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timeout del proveedor (90s)")));
    req.on("error", (e) => reject(e));
    req.write(envelope);
    req.end();
  });

const readCredentials = (db) => {
  let user = process.env.VENDIA_VD_USER;
  let pass = process.env.VENDIA_VD_PASS;
  let apiKey = process.env.VENDIA_VD_APIKEY;
  if (db) {
    const row = (k) => {
      try {
        return db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
      } catch (e) {
        return null;
      }
    };
    user = (row("vendesaldo_user") || {}).value || user;
    pass = (row("vendesaldo_pass") || {}).value || pass;
    apiKey = (row("vendesaldo_apikey") || {}).value || apiKey;
  }
  return {
    user: (user || "").trim(),
    pass: (pass || "").trim(),
    apiKey: (apiKey || "").trim(),
  };
};

const credentialsReady = (db) => {
  const c = readCredentials(db);
  return !!(c.user && c.pass);
};

const pdv = (db) => {
  const c = readCredentials(db);
  return (
    "<PDV><Tipo>" +
    PDV_TAGS.Tipo +
    "</Tipo><Usuario>" +
    esc(c.user) +
    "</Usuario><Password>" +
    esc(c.pass) +
    "</Password></PDV>"
  );
};

const saldo = async (db) => {
  if (!credentialsReady(db)) {
    return { ok: false, error: "Sin credenciales de Vendesaldo configuradas" };
  }
  const xml = await call("obtenerSaldo", pdv(db));
  const m = xml.match(/<Saldo><Resultado>([\s\S]*?)<\/Resultado><\/Saldo>/);
  if (!m) return { ok: false, error: "Respuesta de saldo inesperada" };
  const field = (tag) => {
    const f = m[1].match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">"));
    return f ? f[1] : "";
  };
  const err = field("Error");
  if (err) return { ok: false, error: err };
  return { ok: true, recargas: field("SaldoRecargas"), servicios: field("SaldoServicios") };
};

const normalizeCatalog = (xml) => {
  const ops = [];
  const cre = /<Carrier id="([^"]+)" nombre="([^"]+)">([\s\S]*?)<\/Carrier>/g;
  let cm;
  while ((cm = cre.exec(xml))) {
    const id = cm[1];
    const isPack = PAQUETES.has(id);
    const isBill = id === "CFE";
    const products = [];
    const pre = /<Producto[^>]*>([\s\S]*?)<\/Producto>/g;
    let pm;
    while ((pm = pre.exec(cm[3]))) {
      const nm = pm[1].match(/<Nombre>([\s\S]*?)<\/Nombre>/);
      const mo = pm[1].match(/<Monto>([\s\S]*?)<\/Monto>/);
      const name = (nm ? nm[1] : "").trim();
      const sku = (mo ? mo[1] : "").trim();
      products.push({ sku, name, amountCents: priceCents(sku, name) });
    }
    ops.push({
      key: id,
      name: PRETTY[id] || cm[2],
      logo: LOGO[id] || null,
      category: isBill ? "servicios" : isPack ? "paquetes" : "telefonia",
      kind: isBill ? "bill" : "airtime",
      variant: isBill ? "bill" : isPack ? "paquete" : "recarga",
      input: isBill ? "contract" : "phone",
      feeCents: 0,
      products,
    });
  }
  return ops;
};

const catalog = async (db) => {
  if (!credentialsReady(db)) {
    return { ok: false, error: "Sin credenciales de Vendesaldo configuradas" };
  }
  const xml = await call("obtenerProductos", pdv(db));
  const err = xml.match(/<Error>([^<]*)<\/Error>/);
  if (err) return { ok: false, error: err[1] };
  const ops = normalizeCatalog(xml);
  if (!ops.length) return { ok: false, error: "Catálogo vacío" };
  return {
    ok: true,
    operators: ops,
    syncedAt: new Date().toISOString(),
    rawLength: xml.length,
  };
};

// XML interno de realizarRecarga según el manual del proveedor. El ApiKey es
// opcional (solo si el usuario lo generó); sin él el WebService usa la IP.
const rechargeXml = (db, payload) => {
  const c = readCredentials(db);
  const parts = ["<Tipo>" + PDV_TAGS.Tipo + "</Tipo>"];
  if (c.apiKey) parts.push("<ApiKey>" + esc(c.apiKey) + "</ApiKey>");
  parts.push(
    "<Usuario>" + esc(c.user) + "</Usuario>",
    "<Password>" + esc(c.pass) + "</Password>",
    "<Carrier>" + esc(payload.operatorName) + "</Carrier>",
    "<Monto>" + esc(String(payload.sku)) + "</Monto>",
    "<Phone>" + esc(String(payload.phone)) + "</Phone>",
  );
  return "<Recarga>" + parts.join("") + "</Recarga>";
};

const recharge = async (db, payload) => {
  if (!payload || !payload.sku || !payload.phone) {
    return { ok: false, error: "Faltan datos de la recarga (operador, SKU, teléfono)" };
  }
  if (!credentialsReady(db)) {
    return { ok: false, error: "Sin credenciales de Vendesaldo configuradas" };
  }
  const xml = await call("realizarRecarga", rechargeXml(db, payload));
  const m = xml.match(/<Recarga><Resultado>([\s\S]*?)<\/Resultado><\/Recarga>/);
  if (!m) return { ok: false, error: "Respuesta de recarga inesperada" };
  const field = (tag) => {
    const f = m[1].match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">"));
    return f ? f[1] : "";
  };
  const err = field("Error");
  if (err) return { ok: false, error: err };
  return {
    ok: true,
    providerRef: field("Venta") || field("Autorizacion"),
    autorizacion: field("Autorizacion"),
    nuevoSaldo: field("NuevoSaldo"),
    message: field("Exito") || "Recarga aplicada por el proveedor",
  };
};

const saveCredentials = (db, user, pass) => {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  upsert.run("vendesaldo_user", String(user || "").trim());
  upsert.run("vendesaldo_pass", String(pass || ""));
  return { ok: true };
};

module.exports = { call, saldo, catalog, recharge, saveCredentials, credentialsReady, normalizeCatalog, htmldecode };