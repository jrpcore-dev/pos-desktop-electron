/**
 * Lectura de la descripción de un producto Taecel.
 *
 * El catálogo trae todo en un solo texto libre y cada carrier lo escribe a
 * su manera ("Vigencia 7 Días, 600 MB Para navegar , Facebook Sin límite…",
 * "Datos internacionales:50MB -- Whatsapp:Ilimitado…", "INCLUYE : 150 MB").
 * Aquí se sacan las piezas que el cajero necesita para responder rápido
 * (datos, redes, minutos, vigencia, extras) y se descarta el texto legal.
 * Lo que no se reconoce no se inventa: queda fuera y la tarjeta muestra
 * sólo lo que sí se pudo leer.
 */

export const normalizeText = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const UNIT_DAYS = { hora: 1 / 24, dia: 1, mes: 30, ano: 365 };

const unitOf = (raw) => {
  const u = raw.replace(/s$/, "").replace(/e$/, "");
  if (u.startsWith("h")) return "hora";
  if (u.startsWith("d")) return "dia";
  if (u.startsWith("m")) return "mes";
  return "ano";
};

const UNIT_LABEL = {
  hora: ["hora", "horas"],
  dia: ["día", "días"],
  mes: ["mes", "meses"],
  ano: ["año", "años"],
};

export const vigenciaFrom = (n, unit) => ({
  value: n,
  unit,
  days: n * UNIT_DAYS[unit],
  label: `${n} ${UNIT_LABEL[unit][n === 1 ? 0 : 1]}`,
});

const VIG_RE = /(\d+)\s*(horas?|dias?|meses|mes|anos?)\b/;

const parseVigencia = (product, text) => {
  const fromField = normalizeText(product?.vigencia).match(VIG_RE);
  const fromText =
    text.match(/vigencia(?: total)?\s*:?\s*(\d+)\s*(horas?|dias?|meses|mes|anos?)\b/) ||
    null;
  const m = fromField || fromText;
  if (!m) return null;
  return vigenciaFrom(Number(m[1]), unitOf(m[2]));
};

const fmtSize = (num, unit) => {
  const n = String(num).replace(/\s/g, "");
  return `${n} ${unit.toUpperCase()}`;
};

const SIZE = "(\\d[\\d.,]*)\\s*([mg]b)";

const parseData = (text) => {
  if (/datos ilimitados|ilimitados? para navegar/.test(text)) return "Ilimitado";
  const patterns = [
    new RegExp(`datos internacionales\\s*:\\s*${SIZE}`),
    new RegExp(`${SIZE}\\s*(?:para navegar|libres|internet)`),
    new RegExp(`incluye\\s*:\\s*${SIZE}`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return fmtSize(m[1], m[2]);
  }
  return null;
};

const APPS = [
  { key: "wa", label: "WhatsApp", re: /whatsapp|\bwa\b/ },
  { key: "fb", label: "Facebook", re: /facebook|\bfb\b/ },
  { key: "ms", label: "Messenger", re: /messenger|\bmsng\b/ },
  { key: "x", label: "X", re: /(^|[\s,:(])x(?=[\s,:]|$)/ },
  { key: "ig", label: "Instagram", re: /instagram/ },
  { key: "sc", label: "Snapchat", re: /snapchat/ },
  { key: "tg", label: "Telegram", re: /telegram/ },
];

const parseSocial = (text) => {
  const apps = APPS.filter((a) => a.re.test(text)).map((a) => a.label);
  const unlimited =
    /(facebook|fb)\s*:?\s*(sin limite|ilimitado)|rrss ilimitadas|ilimitadas \d* ?rrss|mb il[i]?mitados para/.test(
      text,
    );
  const waUnlimited = /whatsapp\s*:?\s*(ilimitado|sin limite)/.test(text);
  const amount =
    text.match(new RegExp(`apps\\s*:\\s*${SIZE}`)) ||
    text.match(new RegExp(`${SIZE}\\s*redes sociales`)) ||
    text.match(new RegExp(`(?:whatsapp|wa)\\s*:\\s*${SIZE}`)) ||
    text.match(new RegExp(`facebook\\s*${SIZE}`));
  if (unlimited) return { label: "Redes ilimitadas", apps };
  if (amount) {
    const size = fmtSize(amount[1], amount[2]);
    const onlyWa = apps.length === 1 && apps[0] === "WhatsApp";
    return {
      label: onlyWa ? `WhatsApp ${size}` : `Redes ${size}`,
      apps,
      waUnlimited,
    };
  }
  if (waUnlimited) return { label: "WhatsApp ilimitado", apps: ["WhatsApp"] };
  return null;
};

const parseCalls = (text) => {
  if (/minutos y mensajes\s*:\s*ilimitados/.test(text)) return "Min y SMS ilimitados";
  const m = text.match(/(\d[\d,]*)\s*min y (\d[\d,]*)\s*sms/);
  if (m) return `${m[1]} min · ${m[2]} SMS`;
  if (/minutos incluidos/.test(text)) return "Min y SMS incluidos";
  return null;
};

const parseExtras = (text) => {
  const out = [];
  const gift = text.match(/saldo de regalo\s*:\s*\$\s*([\d.,]+)/);
  if (gift) out.push(`Regalo $${gift[1]}`);
  if (/amazon\s*:?\s*$|suscripcion amazon|amazon prime/.test(text)) {
    out.push(/prime basico/.test(text) ? "Prime Básico" : "Amazon Prime");
  }
  if (/claro musica/.test(text)) out.push("Claro Música");
  if (/hotspot|si comparte internet/.test(text)) out.push("Comparte internet");
  if (/mex-eu-ca|mexico, estados unidos y canada/.test(text)) out.push("MX · EU · CA");
  const months = String(text).match(/\((\d+) meses\)/);
  if (months) out.push(`${months[1]} meses`);
  return out;
};

const parseNotes = (text) => {
  const out = [];
  if (/debe contar con saldo vigente/.test(text)) out.push("La línea debe tener saldo vigente");
  if (/uso exclusivo para modem/.test(text)) out.push("Solo para módem portátil");
  return out;
};

const cache = new WeakMap();

/** Piezas legibles de un producto. Memoizado por objeto de producto. */
export const parsePackage = (product) => {
  if (!product) return null;
  if (cache.has(product)) return cache.get(product);
  const text = normalizeText(`${product.name} ${product.description || ""}`);
  const vigenciaText = normalizeText(product.vigencia);
  const info = {
    data: parseData(text),
    social: parseSocial(text),
    calls: parseCalls(text),
    vigencia: parseVigencia(product, text),
    extras: parseExtras(`${text} ${vigenciaText}`),
    notes: parseNotes(text),
  };
  info.empty =
    !info.data && !info.social && !info.calls && !info.vigencia && !info.extras.length;
  // Texto de búsqueda: el original más etiquetas sinónimas, para que
  // "internet", "redes" o "llamadas" encuentren el paquete aunque el
  // carrier haya escrito "navegar", "RRSS" o "minutos".
  const tags = [
    info.data && "internet datos navegar",
    info.data === "Ilimitado" && "ilimitado",
    info.social && "redes sociales whatsapp",
    info.calls && "llamadas minutos sms",
  ]
    .filter(Boolean)
    .join(" ");
  info.searchText = `${text} ${vigenciaText} ${tags}`;
  cache.set(product, info);
  return info;
};

/** Rangos de vigencia para filtrar paquetes; sólo se muestran los que existen. */
export const VIGENCIA_BUCKETS = [
  { key: "short", label: "Horas a 3 días", test: (d) => d <= 3 },
  { key: "week", label: "Hasta 7 días", test: (d) => d > 3 && d <= 7 },
  { key: "half", label: "8 a 15 días", test: (d) => d > 7 && d <= 15 },
  { key: "month", label: "16 a 30 días", test: (d) => d > 15 && d <= 30 },
  { key: "long", label: "Más de 30 días", test: (d) => d > 30 },
];

export const bucketOf = (product) => {
  const d = parsePackage(product)?.vigencia?.days;
  if (d == null) return null;
  return VIGENCIA_BUCKETS.find((b) => b.test(d))?.key || null;
};
