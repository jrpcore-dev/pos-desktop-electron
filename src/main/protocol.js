"use strict";

// 3c · versión del protocolo Host ↔ caja.
//
// `PROTOCOL_VERSION` es la que habla este build; `MIN_SUPPORTED` es la más
// antigua que sigue aceptando. La comparación es por número MAYOR: una caja
// con mayor (por ejemplo 3.x) o con menor (1.x) queda en PROTOCOL_MISMATCH y
// no se empareja. Los clientes que no declaran versión son anteriores a 3c y
// se aceptan sin más (migración transparente del set móvil actual).
const PROTOCOL_VERSION = "2.0";
const MIN_SUPPORTED = "2.0";

const majorOf = (v) => {
  const n = Number.parseInt(String(v || "").split(".")[0], 10);
  return Number.isFinite(n) ? n : null;
};

const checkProtocol = (clientVersion) => {
  const client = majorOf(clientVersion);
  const host = majorOf(PROTOCOL_VERSION);
  const min = majorOf(MIN_SUPPORTED);
  if (client === null) return { ok: true, clientVersion: clientVersion || null };
  if (client > host) {
    return {
      ok: false,
      code: "PROTOCOL_MISMATCH",
      error: `El Host habla el protocolo ${PROTOCOL_VERSION} y el dispositivo declara ${clientVersion}`,
    };
  }
  if (client < min) {
    return {
      ok: false,
      code: "PROTOCOL_MISMATCH",
      error: `Este Host acepta desde el protocolo ${MIN_SUPPORTED} y el dispositivo declara ${clientVersion}`,
    };
  }
  return { ok: true, clientVersion };
};

module.exports = { PROTOCOL_VERSION, MIN_SUPPORTED, majorOf, checkProtocol };
