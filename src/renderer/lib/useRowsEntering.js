import { useLayoutEffect, useState } from "react";

// Cascada de filas al terminar una carga: devuelve la clase para el <tbody>, que
// además debe llevar `key={loading ? "cargando" : "lista"}`. La clase se quita
// enseguida para que las filas que entran después (al desplazarse en una lista
// virtual o por un refresco en vivo) no se animen. Va en layout effect para
// activarse antes de pintar y no enseñar un cuadro suelto.
export function useRowsEntering(loading) {
  const [entering, setEntering] = useState(false);
  useLayoutEffect(() => {
    if (loading) return undefined;
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), 800);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return entering ? "vt-rows" : undefined;
}
