// Limpieza de nombres del catálogo precargado. Los nombres vienen de un POS
// viejo: todo en mayúsculas, cortados a 25 caracteres y llenos de
// abreviaturas ("HAR. TRIGO GLOBO", "SH.SEDAL", "PZA.ARIEL LIQ C/T DOWNY").
// Aquí se expanden las abreviaturas conocidas, se normalizan unidades y se
// pasa a tipo título respetando marcas y siglas.
//
// Debe ser idempotente: limpiar un nombre ya limpio no lo cambia (la
// migración de instalaciones viejas parte de `cat_name` ya procesado).

// Abreviatura escrita con punto ("HAR.") → palabra.
const ABBR_DOT = {
  SH: "Shampoo", SHAM: "Shampoo", SHAMP: "Shampoo",
  DET: "Detergente", DT: "Detergente",
  AD: "Aderezo",
  JAB: "Jabón",
  HAR: "Harina",
  LIQ: "Líquido",
  HIG: "Higiénico",
  FRIJ: "Frijol",
  YOG: "Yogurt",
  NAT: "Natural",
  MAY: "Mayonesa", MAYONES: "Mayonesa",
  MED: "Mediano",
  AER: "Aerosol",
  NEC: "Néctar",
  CR: "Crema", CRE: "Crema", CREM: "Crema",
  MANTEQ: "Mantequilla",
  GDE: "Grande",
  ACOND: "Acondicionador", ACON: "Acondicionador",
  REF: "Refresco", REFR: "Refresco", REFRES: "Refresco",
  DISP: "Exhibidor", EXH: "Exhibidor", EXHIB: "Exhibidor",
  GERB: "Gerber",
  PROF: "Profesional",
  LIMP: "Limpiador",
  CHOC: "Chocolate", CHOCOL: "Chocolate",
  PROT: "Protector",
  CEP: "Cepillo",
  LIM: "Limón",
  BIB: "Biberón",
  ENT: "Entero",
  PAL: "Paleta",
  SURT: "Surtido",
  MERM: "Mermelada",
  CAJ: "Caja",
  EX: "Extra",
  PLAST: "Plástico", PLAS: "Plástico",
  REG: "Regular",
  VEL: "Veladora",
  RECA: "Recarga",
  CACAH: "Cacahuate",
  PAQ: "Paquete",
  GEL: "Gelatina", GELAT: "Gelatina", GELATI: "Gelatina",
  JALAP: "Jalapeño", JAL: "Jalapeño",
  BOT: "Botella",
  TERM: "Térmico",
  TOALL: "Toalla", TOA: "Toalla",
  INST: "Instantáneo",
  BCO: "Blanco", BCA: "Blanca",
  MZA: "Manzana",
  FRES: "Fresa",
  INV: "Invisible",
  DES: "Desodorante", DESOD: "Desodorante",
  TEQ: "Tequila",
  TRAT: "Tratamiento",
  PROM: "Promoción",
  CARAM: "Caramelo",
  VAIN: "Vainilla", VAINI: "Vainilla", VAINIL: "Vainilla",
  ULTR: "Ultra",
  ENJ: "Enjuague",
  BLANQ: "Blanqueador",
  AMAR: "Amarillo",
  NEG: "Negro",
  ELAS: "Elástico",
  HID: "Hidratante",
  RUB: "Rubio",
  NAR: "Naranja",
  SERV: "Servilleta",
  SALS: "Salsa",
  CAF: "Café",
  CHIL: "Chile",
  ESM: "Esmalte",
  TROP: "Tropical",
  LAV: "Lavanda",
  ET: "Etapa", ETAP: "Etapa",
  PZA: "Pieza",
  LEC: "Leche",
  PIM: "Pimiento",
  RELL: "Rellena",
  ANTIBAC: "Antibacterial",
  POLV: "Polvo", PVO: "Polvo",
  SAB: "Sabor",
  CONCENTR: "Concentrado",
  DESINFEC: "Desinfectante",
  ARR: "Arroz",
  SUAV: "Suavizante",
};

// Abreviaturas que se expanden también sin punto: no chocan con palabras
// reales ni con marcas.
const ABBR_BARE = new Set([
  "SH", "SHAM", "SHAMP", "DET", "DT", "JAB", "LIQ", "HIG", "FRIJ", "YOG",
  "GDE", "ACOND", "ACON", "DESOD", "MZA", "SURT", "MERM", "CACAH", "JALAP",
  "TOALL", "BCO", "NAT", "AER", "EXH", "CEP", "PROM", "REFR", "NEC", "CHOC",
  "PAQ", "GELAT", "GELATI", "CHOCOL", "VAINI", "VAIN", "PZA", "CREM", "MANTEQ",
]);

// Marcas o nombres con escritura propia. Clave: palabra en mayúsculas sin
// acentos ni apóstrofos.
const BRAND_CASE = {
  MCCORMICK: "McCormick", DGARI: "D'Gari", KELLOGGS: "Kellogg's",
  KELLOGG: "Kellogg's", HELLMANNS: "Hellmann's", HELLMANS: "Hellmann's",
  LOREAL: "L'Oréal", PONDS: "Pond's", HERSHEYS: "Hershey's",
  NESCAFE: "Nescafé", NESTLE: "Nestlé", TRESEMME: "TRESemmé",
  JOHNSONS: "Johnson's", LAYS: "Lay's", MMS: "M&M's", BIC: "BIC",
  KBB: "KBB", VO5: "VO5", FUD: "FUD", OXXO: "OXXO", BBQ: "BBQ",
  UHT: "UHT", PET: "PET", LED: "LED", USB: "USB", SPF: "SPF", TV: "TV",
  XL: "XL", XXL: "XXL", XXXL: "XXXL", II: "II", III: "III", IV: "IV",
  HD: "HD", "3M": "3M", WD40: "WD-40", MAS: "Más",
};

// Palabras frecuentes que en el origen perdieron el acento.
const ACCENTS = {
  LIMON: "limón", JABON: "jabón", JAMON: "jamón", ATUN: "atún",
  AZUCAR: "azúcar", CAFE: "café", TE: "té", MAIZ: "maíz", PLATANO: "plátano",
  MELON: "melón", ALGODON: "algodón", LIQUIDO: "líquido", LIQUIDA: "líquida",
  HIGIENICO: "higiénico", CHAMPINON: "champiñón", CHAMPINONES: "champiñones",
  ANIS: "anís", ACIDO: "ácido", ACIDA: "ácida", BEBE: "bebé",
  CAMARON: "camarón", CARBON: "carbón", CORAZON: "corazón",
  ELECTRICO: "eléctrico", ELECTRICA: "eléctrica", ECOLOGICO: "ecológico",
  ECOLOGICA: "ecológica", ECONOMICO: "económico", ECONOMICA: "económica",
  PLASTICO: "plástico", PLASTICA: "plástica", METALICO: "metálico",
  METALICA: "metálica", TERMICO: "térmico", TERMICA: "térmica",
  CLASICO: "clásico", CLASICA: "clásica", JALAPENO: "jalapeño",
  JALAPENOS: "jalapeños", NINO: "niño", NINA: "niña", NINOS: "niños",
  ARANDANO: "arándano", PANAL: "pañal", PANALES: "pañales",
  PANUELO: "pañuelo", PANUELOS: "pañuelos", BANO: "baño", CAJON: "cajón",
  GALON: "galón", RAPIDO: "rápido", RAPIDA: "rápida", MAGICO: "mágico",
  MAGICA: "mágica", AUTENTICO: "auténtico", ORGANICO: "orgánico",
  ORGANICA: "orgánica", MEXICO: "México", CAPSULA: "cápsula",
  CAPSULAS: "cápsulas", OREGANO: "orégano", CHICHARRON: "chicharrón",
  SALMON: "salmón", SANDIA: "sandía", GUANABANA: "guanábana",
  MARACUYA: "maracuyá", LAPIZ: "lápiz", LAPICES: "lápices",
  BOLIGRAFO: "bolígrafo", BOLIGRAFOS: "bolígrafos", BATERIA: "batería",
  TELEFONICA: "telefónica", CONSOME: "consomé", CANTARO: "cántaro",
  TAZON: "tazón", JARDIN: "jardín", CITRICO: "cítrico", CITRICA: "cítrica",
  CITRICOS: "cítricos", CHICHARO: "chícharo", CHICHAROS: "chícharos",
  NECTAR: "néctar", LACTEO: "lácteo", SABILA: "sábila", OXIGENO: "oxígeno",
  ELASTICO: "elástico", ELASTICA: "elástica", SANDWICH: "sándwich",
  ANATOMICA: "anatómica", ANATOMICO: "anatómico", BIOLOGICO: "biológico",
  DERMATOLOGICO: "dermatológico", HIPOALERGENICO: "hipoalergénico",
  TRIANGULO: "triángulo", PRACTICO: "práctico", PRACTICA: "práctica",
  CREMOSISIMO: "cremosísimo", MAXIMO: "máximo", MAXIMA: "máxima",
  INSTANTANEO: "instantáneo", INSTANTANEA: "instantánea", MOVIL: "móvil",
  ESPANOLA: "española", COSTENA: "costeña", CANA: "caña", PINA: "piña",
  NORTENA: "norteña", ACRILICO: "acrílico", VINILICO: "vinílico",
  FOSFORO: "fósforo", FOSFOROS: "fósforos", TAMANO: "tamaño",
  ENERGETICA: "energética", ENERGETICO: "energético", PURISIMA: "purísima",
  MANI: "maní", PAPAYA: "papaya", HUMEDO: "húmedo", HUMEDA: "húmeda",
  HUMEDAS: "húmedas", ULTIMATE: "ultimate",
};

// Preposiciones y conjunciones que van en minúscula salvo al inicio. Los
// artículos (La, El…) se quedan en mayúscula porque suelen ser parte de la
// marca (La Costeña, El Yuca).
const LOWER_WORDS = new Set(["de", "del", "y", "con", "sin", "para", "en", "al", "por", "a", "o", "x"]);

// Unidades tras un número.
const UNITS = {
  G: "g", GR: "g", GRS: "g", GRM: "g", GRAMOS: "g",
  KG: "kg", KGS: "kg", K: "kg", KILO: "kg", KILOS: "kg",
  ML: "ml", MLS: "ml", MLT: "ml",
  L: "L", LT: "L", LTS: "L", LTR: "L", LITRO: "L", LITROS: "L",
  OZ: "oz", MG: "mg", CM: "cm", MM: "mm", MTS: "m", MT: "m",
  PZ: "pzas", PZS: "pzas", PZA: "pzas", PZAS: "pzas", PIEZAS: "pzas",
  M: "m",
};
const UNIT_GLUE = new RegExp(
  `(\\d)\\s+(${Object.keys(UNITS).sort((a, b) => b.length - a.length).join("|")})(?=$|[\\s+\\/.])`,
  "g",
);

const LOOSE_UNITS = new Set(["ML", "MLS", "KG", "KGS", "LTS", "MG", "PZAS"]);

// Marcas y frases con puntuación propia que el resto del proceso partiría.
// Se sustituyen por un marcador y se restauran al final.
const PHRASES = [
  [/\bL\.?\s*A\.?\s*CETTO\b/g, "L.A. Cetto"],
  [/\bM\.?\s*C\.?\s*CORMICK\b/g, "McCormick"],
  [/\bM\.C\.(?=\s|$)/g, "McCormick"],
  [/\bD\s*['.´]?\s*GARI\b/g, "D'Gari"],
  [/\bLUZ\s+E\./g, "Luz Eterna"],
  [/^L\.\s*E\.(?=\s|\d)/g, "Luz Eterna"],
  [/\bD\.\s*CHONITA\b/g, "Doña Chonita"],
  [/\bH\s*&\s*S\b/g, "H&S"],
  [/\bM\s*&\s*M'?S\b/g, "M&M's"],
  [/\bST\.?\s*IVES\b/g, "St. Ives"],
  [/\bJELL-?O\b/g, "Jell-O"],
  [/\bM\.\s*LIMPIO\b/g, "Maestro Limpio"],
  [/\bCOCA[\s-]?COLA\b/g, "Coca-Cola"],
  [/\b7[\s-]?UP\b/g, "7Up"],
  [/\b1-2-3\b/g, "1-2-3"],
  [/\bPURE (?=DE\b|D\/)/g, "PURÉ "],
  [/\bWD-?40\b/g, "WD-40"],
  [/\bS\.\s*(?=(MARCOS|RAFAEL|SALVADOR|LUIS|JUAN|MIGUEL|ANTONIO|JOSE|PEDRO|PABLO|ISIDRO)(?![A-ZÑ]))/g, "San "],
];

const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const hasVowel = (s) => /[AEIOUÁÉÍÓÚÜY]/.test(s);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Una palabra alfabética (sin números) → su forma final.
function word(raw, { dotted, first, index }) {
  const up = raw.toUpperCase();
  const key = stripAccents(up).replace(/'/g, "");
  if (up === "AC" && (dotted || index > 0)) return index === 0 ? "Aceite" : "Acondicionador";
  if (dotted && ABBR_DOT[key]) return { text: ABBR_DOT[key], dropDot: true };
  if (!dotted && ABBR_BARE.has(key)) return ABBR_DOT[key];
  if (BRAND_CASE[key]) return BRAND_CASE[key];
  // unidad suelta sin número. "GR." no entra: sin cantidad suele ser granel,
  // grano o grasa.
  if (LOOSE_UNITS.has(key)) return UNITS[key];
  const lower = up.toLowerCase();
  if (!first && LOWER_WORDS.has(lower)) return lower;
  // Siglas: sin vocales y cortas (KBB, MSS, DDH) o una sola letra.
  if (up.length === 1 || (up.length <= 4 && !hasVowel(up))) return up;
  if (ACCENTS[key]) return cap(ACCENTS[key]);
  if (/CION$/.test(key)) return cap(lower.replace(/cion$/, "ción"));
  if (/SION$/.test(key) && key.length > 5) return cap(lower.replace(/sion$/, "sión"));
  return cap(lower);
}

// Una pieza sin espacios, p. ej. "C/ALMEND", "500GRS", "VERD/POLLO/ARR.".
function piece(tok, ctx) {
  // C/ S/ P/ D/ al inicio → con / sin / para / de. Con una sola letra detrás
  // es otra sigla (S/A = sin alas) y se deja igual.
  const pref = tok.match(/^([CSPD])\/(.+)$/);
  if (pref && /^(\d|[A-ZÑÁÉÍÓÚ]{2,})/.test(pref[2])) {
    const w = { C: "con", S: "sin", P: "para", D: "de" }[pref[1]];
    return `${w} ${piece(pref[2], { ...ctx, first: false, index: ctx.index + 1 })}`;
  }
  for (const sep of ["/", "+"]) {
    if (tok.includes(sep) && !/^\d+\/\d+$/.test(tok)) {
      return tok.split(sep).map((p, i) => (p ? piece(p, { ...ctx, first: ctx.first && i === 0 }) : p)).join(sep);
    }
  }
  if (tok.includes("-") && /[A-Z]/.test(tok) && !/^\d/.test(tok)) {
    return tok.split("-").map((p, i) => (p ? piece(p, { ...ctx, first: ctx.first && i === 0 }) : p)).join("-");
  }
  // número + unidad pegados: 500GRS, 1.5LTS, 3.78L
  const nu = tok.match(/^(\d+(?:\.\d+)?)([A-Z]+)\.?$/);
  if (nu && UNITS[nu[2]]) return `${nu[1]} ${UNITS[nu[2]]}`;
  if (/\d/.test(tok)) return tok.toUpperCase();
  const dotted = tok.endsWith(".");
  const core = tok.replace(/\.+$/, "");
  if (!core) return tok;
  if (!/^[A-ZÑÁÉÍÓÚÜ']+$/.test(core)) return tok;
  const r = word(core, { ...ctx, dotted });
  if (typeof r === "object") return r.text;
  return dotted ? `${r}.` : r;
}

function cleanCatalogName(input) {
  if (input == null) return "";
  let s = String(input).trim();
  if (!s) return "";

  s = s
    .toUpperCase()
    .replace(/(?<=[A-ZÑ])#(?=[A-ZÑ]|$)/g, "Ñ") // NI#O → NIÑO
    .replace(/§/g, "°")
    .replace(/[´`']{2}/g, '"')
    .replace(/[´`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[\s\-\/,:;]+$/, "")
    .trim();

  // "PZA." al inicio: el producto se vende por pieza.
  let byPiece = false;
  s = s.replace(/^(PZA?\.\s*|PZA\s+)(?=\S)/, () => {
    byPiece = true;
    return "";
  });
  if (/\s\((PIEZA|PZA)\)$/.test(s)) {
    byPiece = true;
    s = s.replace(/\s\((PIEZA|PZA)\)$/, "");
  }

  const saved = [];
  const keep = (text) => {
    saved.push(text);
    return `\u0001${saved.length - 1}\u0001`;
  };
  for (const [re, text] of PHRASES) s = s.replace(re, () => (text.endsWith(" ") ? text : `${keep(text)} `));

  // Separar palabras pegadas por punto: "SH.SEDAL" → "SH. SEDAL",
  // "E.7" → "E. 7"; los decimales (3.78) se respetan.
  s = s
    .replace(/([A-ZÑÁÉÍÓÚ])\.(?=[A-ZÑÁÉÍÓÚ0-9\u0001])/g, "$1. ")
    .replace(/(\d)\.(?=[A-ZÑÁÉÍÓÚ])/g, "$1. ")
    // "COCO900" → "COCO 900", "28NEGRO" → "28 NEGRO"; solo con 3+ letras para
    // no partir "E12", "VO5" o "2N1"
    .replace(/([A-ZÑÁÉÍÓÚ]{3,})(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[A-ZÑÁÉÍÓÚ]{3,})/g, "$1 ")
    // y cada cantidad se vuelve a pegar a su unidad ("600 MLS" → "600MLS")
    // para que `piece` la normalice de una sola forma
    .replace(UNIT_GLUE, "$1$2")
    .replace(/\s+/g, " ")
    .trim();

  const toks = s.split(" ");
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (/^\u0001\d+\u0001$/.test(tok)) {
      out.push(tok);
      continue;
    }
    out.push(piece(tok, { first: out.length === 0, index: out.length }));
  }

  let res = out
    .join(" ")
    .replace(/\u0001(\d+)\u0001/g, (m, n) => saved[+n])
    .replace(/\s+/g, " ")
    .replace(/[\s\-\/,:;]+$/, "")
    .trim();
  if (byPiece) res += " (pieza)";
  return cap(res);
}

module.exports = { cleanCatalogName };
