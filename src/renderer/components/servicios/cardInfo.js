/**
 * Lectura de tarjetas de regalo (cat 4) y pagos de servicio (cat 3).
 *
 * Una tarjeta de regalo en Taecel es un PIN: el cajero captura el celular
 * del cliente, Taecel le manda el código por SMS y el cliente lo canjea en
 * la tienda de la marca. La descripción del catálogo es un texto de
 * marketing largo; aquí se saca lo que el cajero necesita decir en caja:
 * qué es (si la marca vende varias cosas), dónde se canjea y cuánto dura.
 *
 * Los servicios son, en esta cuenta, tags de autopista (IAVE, Televía…) e
 * internet (Netwey): referencia alfanumérica + importe fijo o monto libre.
 */

import { normalizeText } from "./packageInfo";

const URL_RE = /https?:\/\/[^\s,)]+|www\.[^\s,)]+/i;

// Dominio corto para decir en caja. La ruta sólo se conserva cuando es la
// página de canje ("netflix.com/mx/redeem"); si no, basta el dominio.
const shortUrl = (raw) => {
  const clean = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[./]+$/, "");
  const [host, ...path] = clean.split("/");
  const domain = host.replace(/:\d+$/, "");
  const route = path.join("/");
  return /redeem|canje|reload/i.test(route) ? `${domain}/${route}`.slice(0, 40) : domain;
};

const EMPTY_VIG = /^(0|no (establecida|especificada|definida)|sin definir|vigencia no definida)\.?$/i;

// "A partir del Canje: 1 año para agotar el saldo" → "1 año tras canjear".
const cleanVigencia = (raw) => {
  const v = String(raw || "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (!v || EMPTY_VIG.test(v) || /^importante/i.test(v)) return null;
  const n = normalizeText(v);
  if (/hasta agotar|no tiene vencimiento|indefinido/.test(n)) return "Sin vencimiento";
  if (/uso inmediato/.test(n)) return "Uso inmediato";
  if (/dentro del mes de compra/.test(n)) return "Canjear en el mes de compra";
  if (/minecoins/.test(n)) return null; // lo trae el título
  const after = v.match(/a partir del canje\s*:?\s*(.+)/i);
  if (after) {
    const span = after[1].replace(/para agotar el saldo/i, "").trim().toLowerCase();
    return `${span.replace(/^un /, "1 ")} tras canjear`;
  }
  const since = v.match(/(\d+\s*(?:d[ií]as?|mes(?:es)?|a[ñn]os?))\s*a partir de (?:su )?(compra|activaci[oó]n)/i);
  if (since) return `${since[1].toLowerCase()} desde la ${since[2].toLowerCase().startsWith("c") ? "compra" : "activación"}`;
  return v.length > 34 ? `${v.slice(0, 32)}…` : v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
};

// Lo que distingue a un producto de otro de la misma marca.
const variantOf = (product, brand) => {
  const name = String(product.name || "");
  const n = normalizeText(`${name} ${product.vigencia || ""}`);
  const coins = n.match(/(\d[\d,.]*)\s*(minecoins|diamantes|robux|v-?bucks|uc\b|monedas)/);
  if (coins) return `${coins[1]} ${coins[2].replace(/^\w/, (c) => c.toUpperCase())}`;
  const usd = name.match(/\$?\s*(\d+)\s*usd/i);
  if (usd) return `${usd[1]} USD`;
  const combo = name.match(/combo\s+([^.\-–]+?)(?:\.|\s+funciona|\s+--|$)/i);
  if (combo) return `Combo ${combo[1].trim().toLowerCase()}`;
  const boleto = n.match(/(\d+)\s*(boletos?|entradas?)\b/);
  if (boleto) return `${boleto[1]} ${boleto[2]}`;
  const plan = n.match(/365 (personal|family|business)/);
  if (plan) return `365 ${plan[1].replace(/^\w/, (c) => c.toUpperCase())}`;
  // Meses sólo del nombre corto ("Prime Video 1 Mes", "12MS"): en los textos
  // largos suele ser la vigencia, no el producto.
  const months = name.length < 80 && normalizeText(name).match(/(\d+)\s*(mes|meses|ms|m)\b/);
  if (months) return `${months[1]} ${months[1] === "1" ? "mes" : "meses"}`;
  const sala = name.match(/^(cinemex\s+\w+)\s*:/i);
  if (sala) return sala[1].replace(/\b\w/g, (c) => c.toUpperCase());
  if (/switch online/.test(n)) return "Switch Online";
  if (/eshop/.test(n)) return "eShop";
  const pcs = n.match(/(\d+)\s*pc\b/);
  if (pcs) return `${pcs[1]} PC`;
  void brand;
  return null;
};

const redeemOf = (product) => {
  const text = `${product.name || ""} ${product.description || ""}`;
  const url = text.match(URL_RE);
  if (url) return shortUrl(url[0]);
  const n = normalizeText(text);
  if (/taquilla/.test(n)) return "En taquilla";
  if (/sucursal/.test(n)) return "En sucursal";
  return null;
};

const NOISE = [
  /producto sujeto a cambios[^.\-]*/gi,
  /oferta comercial:[^-]*/gi,
  /descripci[oó]n general:\s*/gi,
  /instrucciones de (uso|canje):\s*/gi,
  URL_RE,
];

// Primera frase útil, para el detalle de la tarjeta elegida.
const blurbOf = (product) => {
  let t = String(product.description || product.name || "");
  for (const re of NOISE) t = t.replace(new RegExp(re.source, "gi"), " ");
  t = t.replace(/\s*(--|\/\/\/?)\s*/g, ". ").replace(/\s+/g, " ").trim();
  t = t.replace(/^[.\s]+/, "");
  const first = t.split(/(?<=\.)\s/)[0] || t;
  if (!first || first.length < 12 || /^visita\b/i.test(first)) return null;
  return first.length > 140 ? `${first.slice(0, 138).trimEnd()}…` : first;
};

const notesOf = (product) => {
  const n = normalizeText(`${product.vigencia || ""} ${product.description || ""}`);
  const out = [];
  if (/no llega via sms|codigo no llega/.test(n))
    out.push("Si el código no llega por SMS en 24 h, repórtalo a soporte");
  if (/no valida en compras en tienda fisica|unicamente en compras realizadas en linea/.test(n))
    out.push("Solo para compras en línea");
  if (/valida unicamente para el servicio de netflix en mexico/.test(n)) out.push("Solo cuentas de México");
  return out;
};

const cache = new WeakMap();

export const parseGiftcard = (product, brand = "") => {
  if (!product) return null;
  if (cache.has(product)) return cache.get(product);
  const info = {
    variant: variantOf(product, brand),
    redeem: redeemOf(product),
    vigencia: cleanVigencia(product.vigencia),
    blurb: blurbOf(product),
    notes: notesOf(product),
  };
  cache.set(product, info);
  return info;
};

// ─── Servicios ──────────────────────────────────────────────────────

// Taecel a veces manda el EJEMPLO como nombre del campo ("CPFI000000000",
// "Ej. OHML00000000"). Se separa: etiqueta legible + ejemplo como placeholder.
export const referenceSpec = (operator) => {
  const spec = operator?.input;
  if (!spec) return spec;
  const raw = String(spec.label || "").trim();
  const looksLikeExample = /^ej\.?\s/i.test(raw) || /[A-Z]{2,}\d{4,}/.test(raw) || /^\d{6,}$/.test(raw);
  const n = normalizeText(operator.name);
  const isTag = /iave|televia|pase|viapass|tag/.test(n);
  if (operator.category === "tarjetas") {
    return {
      ...spec,
      label: "Celular del cliente",
      hint: "Aquí llega el código de la tarjeta por SMS",
    };
  }
  if (operator.category !== "servicios") return spec;
  const example = looksLikeExample ? raw.replace(/^ej\.?\s*/i, "") : "";
  return {
    ...spec,
    label: looksLikeExample ? (isTag ? "Número de tag" : "Referencia") : titleField(raw),
    placeholder: example ? `Ej. ${example}` : spec.placeholder,
    hint: isTag
      ? "Viene impreso en el tag, con su dígito verificador"
      : spec.numeric
        ? spec.hint
        : "Tal como aparece en el recibo",
    alnum: !spec.numeric,
  };
};

const titleField = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Referencia";

// Un servicio cuyos productos sólo difieren en el importe (IAVE: "Ejemplo con
// dígito verificador…" en todos) se cobra con pastillas de monto; si los
// nombres dicen algo distinto (Netwey: planes) va como lista de planes.
export const servicePlansAreAmounts = (operator) => {
  const names = new Set((operator?.products || []).map((p) => normalizeText(p.name)));
  return names.size <= 1;
};

// "Internet Hogar Prepago Netwey Semanal 20 GB" → título sin la marca.
export const planTitle = (product, operator) => {
  const brandWords = new Set(normalizeText(operator?.name).split(" "));
  const words = String(product.name || "")
    .split(/\s+/)
    .filter((w) => !brandWords.has(normalizeText(w)));
  const t = words.join(" ").trim() || product.name;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase().replace(/\b(\d+)\s*gb?\b/gi, "$1 GB");
};

export const planData = (product) => {
  const m = String(product.name || "").match(/(\d[\d.,]*)\s*(gb?|mb)\b/i);
  if (!m) return null;
  const unit = m[2].toUpperCase().startsWith("G") ? "GB" : "MB";
  return `${m[1]} ${unit}`;
};
