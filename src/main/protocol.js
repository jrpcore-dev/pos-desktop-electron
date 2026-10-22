"use strict";

// Bloque 5 · versión del protocolo Host ↔ caja.
//
// `PROTOCOL_VERSION` es la que habla este build; `MIN_SUPPORTED` es la más
// antigua que sigue aceptando. La comparación de ESCRITURA es por número
// MAYOR: una caja con mayor (por ejemplo 3.x) o con menor (1.x) queda en
// PROTOCOL_MISMATCH y no escribe. Distinto MINOR solo avisa (se puede seguir
// operando mientras el Host se actualiza primero). Los clientes que no
// declaran versión son anteriores y se aceptan (migración transparente).
const PROTOCOL_VERSION = "2.1";
const MIN_SUPPORTED = "2.0";

const majorOf = (v) => {
  const n = Number.parseInt(String(v || "").split(".")[0], 10);
  return Number.isFinite(n) ? n : null;
};

const minorOf = (v) => {
  const n = Number.parseInt(String(v || "").split(".")[1], 10);
  return Number.isFinite(n) ? n : 0;
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
      error: `El Host habla el protocolo ${PROTOCOL_VERSION} y el dispositivo declara ${clientVersion}. Actualiza el Host primero.`,
    };
  }
  if (client < min) {
    return {
      ok: false,
      code: "PROTOCOL_MISMATCH",
      error: `Este Host acepta desde el protocolo ${MIN_SUPPORTED} y el dispositivo declara ${clientVersion}. Actualiza la caja.`,
    };
  }
  const minorMismatch =
    minorOf(clientVersion) !== minorOf(PROTOCOL_VERSION);
  return {
    ok: true,
    clientVersion,
    minorMismatch,
    warning: minorMismatch
      ? `El Host habla el protocolo ${PROTOCOL_VERSION} y la caja ${clientVersion}. Se puede operar; actualiza el Host primero y luego la caja.`
      : null,
  };
};

module.exports = {
  PROTOCOL_VERSION,
  MIN_SUPPORTED,
  majorOf,
  minorOf,
  checkProtocol,
};
