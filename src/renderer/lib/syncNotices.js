// Avisos de sincronización de la caja.
//
// Un aviso nace flotante (abajo a la derecha). Al cerrarlo con la X o al irse
// solo, pasa a la campana, sección "Sincronización". Uno por tema (`key`): el
// nuevo reemplaza al anterior del mismo tema, así una red que parpadea no
// llena la pantalla; la campana los agrupa con un contador.
//
// Vive en memoria y en localStorage (sólo comodidad de esta caja: si el
// navegador lo borra, no se pierde nada importante).

const STORE_KEY = "vendia.syncNotices.v1";
const KEEP = 30;

const read = () => {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
};
const write = (list) => {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, KEEP)));
  } catch (e) {}
};

let saved = read(); // en la campana
let floating = []; // en pantalla
const listeners = new Set();
const emit = () => {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {}
  }
};

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getFloating = () => floating;
export const getSaved = () => saved;
export const unreadCount = () => saved.filter((n) => n.unread).length;

const toBell = (notice) => {
  if (!notice || notice.silent) return;
  const prev = saved.find((n) => n.key === notice.key && !n.resolved);
  const entry = {
    ...notice,
    unread: true,
    times: prev ? (prev.times || 1) + 1 : 1,
    savedAt: Date.now(),
  };
  saved = [entry, ...saved.filter((n) => n !== prev)].slice(0, KEEP);
  write(saved);
};

// Muestra (o actualiza) el aviso flotante de un tema.
export const show = (notice) => {
  const n = { at: Date.now(), ...notice, id: `${notice.key}-${Date.now()}` };
  const old = floating.find((f) => f.key === n.key);
  // Mismo tema, mismo contenido: sólo se actualiza (avance de la subida).
  floating = old ? floating.map((f) => (f.key === n.key ? { ...n, id: old.id, at: old.at } : f)) : [n, ...floating].slice(0, 3);
  emit();
};

// Cerrar con la X o irse solo: a la campana.
export const dismiss = (key) => {
  const n = floating.find((f) => f.key === key);
  if (!n) return;
  floating = floating.filter((f) => f.key !== key);
  toBell(n);
  emit();
};

// El problema se arregló (volvió el Host, se puso el PIN): el aviso se quita
// de la pantalla y lo de la campana de ese tema queda como resuelto.
export const resolve = (key) => {
  const had = floating.some((f) => f.key === key);
  floating = floating.filter((f) => f.key !== key);
  let changed = had;
  saved = saved.map((n) => {
    if (n.key === key && !n.resolved) {
      changed = true;
      return { ...n, resolved: true };
    }
    return n;
  });
  if (changed) {
    write(saved);
    emit();
  }
};

export const markAllRead = () => {
  saved = saved.map((n) => ({ ...n, unread: false }));
  write(saved);
  emit();
};

export const clearSaved = () => {
  saved = [];
  write(saved);
  emit();
};
