// 3b · INERTE: este módulo todavía no está conectado a ningún flujo.
//
// Guarda el token de sesión SOLO si existe un almacén cifrado (safeStorage).
// Si no hay (hoy no se expone ningún puente), el token vive en memoria y se
// reporta que no se persistió: jamás se escribe en claro en localStorage.

let memoryToken = null;
let lastReport = { persisted: false, where: null, reason: "sin guardar" };

const bridge = () =>
  typeof window === "undefined" ? null : window.api || window.electronAPI || null;

const safeStorage = () => {
  const api = bridge();
  return api && api.safeStorage ? api.safeStorage : null;
};

export function saveSessionToken(token, meta = {}) {
  if (!token) {
    lastReport = { persisted: false, where: null, reason: "token vacío" };
    return lastReport;
  }
  const ss = safeStorage();
  if (ss && typeof ss.encryptString === "function" && typeof ss.decryptString === "function") {
    try {
      window.sessionStorage.setItem(
        "vendia:session-token",
        ss.encryptString(JSON.stringify({ token, meta })),
      );
      memoryToken = token;
      lastReport = { persisted: true, where: "safeStorage", reason: null };
      return lastReport;
    } catch (err) {
      lastReport = { persisted: false, where: "memory", reason: `safeStorage falló: ${err.message}` };
      memoryToken = token;
      return lastReport;
    }
  }
  // Sin safeStorage: NO se guarda en claro. Solo memoria.
  memoryToken = token;
  lastReport = {
    persisted: false,
    where: "memory",
    reason: "safeStorage no disponible; el token no se guarda en disco",
  };
  return lastReport;
}

export function getSessionToken() {
  if (memoryToken) return memoryToken;
  const ss = safeStorage();
  if (!ss || typeof ss.decryptString !== "function") return null;
  try {
    const raw = window.sessionStorage.getItem("vendia:session-token");
    if (!raw) return null;
    const parsed = JSON.parse(ss.decryptString(raw));
    memoryToken = parsed.token;
    return memoryToken;
  } catch (err) {
    return null;
  }
}

export function clearSessionToken() {
  memoryToken = null;
  try {
    window.sessionStorage.removeItem("vendia:session-token");
  } catch (err) {}
  lastReport = { persisted: false, where: null, reason: "sesión cerrada" };
}

export function sessionStatus() {
  return { ...lastReport, hasToken: Boolean(memoryToken) };
}
