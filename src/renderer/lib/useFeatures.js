import { useCallback, useEffect, useState } from "react";
import { useDbChanges } from "./useDbChanges";

// Funciones de la tienda (Configuración → Funciones). Se guardan como
// settings "true"/"false" (se replican a las cajas como el resto de ajustes).
// Sin valor guardado = encendida: a una instalación existente no le
// desaparece nada al actualizar. Apagar sólo oculta; no borra datos.
export const FEATURE_KEYS = {
  customers: "feature_customers",
  credit: "feature_credit",
  services: "feature_services",
  expiry: "feature_expiry",
  // Promociones avanzadas (categoría/marca y paquetes). Es la excepción:
  // arranca APAGADA, porque al encenderla cambia lo que se cobra. La clave
  // es la que lee el main (`promos_advanced`).
  promos: "promos_advanced",
};

// Funciones que sin valor guardado arrancan apagadas.
const OFF_BY_DEFAULT = new Set(["promos"]);

const ALL_ON = {
  customers: true,
  credit: true,
  services: true,
  expiry: true,
  promos: false,
};

// El fiado depende de Clientes: sin clientes no hay a quién fiar.
export const resolveFeatures = (settings = {}) => {
  const on = (key) =>
    OFF_BY_DEFAULT.has(key)
      ? settings[FEATURE_KEYS[key]] === "true"
      : settings[FEATURE_KEYS[key]] !== "false";
  const customers = on("customers");
  return {
    customers,
    credit: customers && on("credit"),
    services: on("services"),
    expiry: on("expiry"),
    promos: on("promos"),
  };
};

// Aviso local tras guardar en Configuración (el `db-changed` de settings
// también llega, pero así el cambio se ve al instante en esta ventana).
export const FEATURES_EVENT = "features-changed";

let cache = null;

export function useFeatures() {
  const [features, setFeatures] = useState(cache || ALL_ON);

  const load = useCallback(async () => {
    try {
      const settings = await window.api.invoke("get-all-settings");
      cache = resolveFeatures(settings || {});
      setFeatures(cache);
    } catch {}
  }, []);

  useDbChanges(load, ["settings"]);

  useEffect(() => {
    load();
    window.addEventListener(FEATURES_EVENT, load);
    return () => window.removeEventListener(FEATURES_EVENT, load);
  }, [load]);

  return features;
}
