import { useEffect, useRef } from "react";

// 3d · suscripción al aviso de cambios de BD que emite el proceso main.
//
// El main coalescencia (≈150 ms) y avisa con { tables, ids, at }. Aquí sólo se
// traduce a un callback estable: NO se reescribe ninguna pantalla, se usa
// únicamente donde ya existía un refetch por temporizador (se conserva como
// respaldo) para que el dato llegue en el momento.
//
//   useDbChanges(() => loadLowStock(), ["products"]);
//
// `tables` es opcional: si se pasa, el callback sólo se invoca si el aviso
// toca alguna de esas tablas.
export function useDbChanges(callback, tables) {
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  });

  const key = tables && tables.length ? tables.join(",") : "";
  useEffect(() => {
    if (!window.api || typeof window.api.on !== "function") return undefined;
    const wanted = key ? new Set(key.split(",")) : null;
    const off = window.api.on("db-changed", (payload) => {
      const changed = payload && Array.isArray(payload.tables) ? payload.tables : [];
      if (wanted && !changed.some((t) => wanted.has(t))) return;
      try {
        cbRef.current(payload);
      } catch (err) {
        // Un fallo del callback no debe romper la suscripción.
      }
    });
    return typeof off === "function" ? off : undefined;
  }, [key]);
}
