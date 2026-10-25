// Configuración de la báscula guardada en esta PC (cada caja tiene la suya).
// Los valores coinciden con PROFILES / FORMATS de src/main/scale.js.
import { useEffect, useState } from "react";

export const SCALE_PROFILES = [
  { value: "auto", label: "No sé / detectar automáticamente" },
  { value: "torrey", label: "Torrey o Rhino" },
  { value: "w", label: "Toledo (8213) o CAS" },
  { value: "enq", label: "CAS ER o Avery" },
  { value: "sics", label: "Mettler Toledo" },
  { value: "continuous", label: "Otra (envía el peso sola)" },
];

export const SCALE_FORMATS = [
  { value: "8N1", label: "Estándar (8N1)" },
  { value: "7E1", label: "Toledo (7E1)" },
  { value: "7O1", label: "Alterno (7O1)" },
];

export const SCALE_BAUDS = ["2400", "4800", "9600", "19200", "38400", "57600", "115200"];

// ── ¿Esta caja usa báscula? ─────────────────────────────────────────────
// Apagado: no se abre el puerto, no hay reconexión automática y la báscula
// no aparece en la interfaz. Si nunca se eligió, se asume "sí" sólo cuando
// ya había un puerto guardado (instalaciones que ya la usaban).
const ENABLED_KEY = "scaleEnabled";
const ENABLED_EVENT = "scale-enabled-change";

export const isScaleEnabled = () => {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    return !!localStorage.getItem("scalePort");
  } catch {
    return false;
  }
};

export const setScaleEnabled = (enabled) => {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent(ENABLED_EVENT, { detail: !!enabled }));
};

export const useScaleEnabled = () => {
  const [enabled, setEnabled] = useState(isScaleEnabled);
  useEffect(() => {
    const onChange = () => setEnabled(isScaleEnabled());
    window.addEventListener(ENABLED_EVENT, onChange);
    return () => window.removeEventListener(ENABLED_EVENT, onChange);
  }, []);
  return enabled;
};

// Abre el diálogo de la báscula (vive en Layout) desde cualquier pantalla.
export const OPEN_SCALE_EVENT = "open-scale-dialog";
export const openScaleDialog = () =>
  window.dispatchEvent(new CustomEvent(OPEN_SCALE_EVENT));

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

export const getScaleConfig = () => ({
  port: read("scalePort", ""),
  baudRate: parseInt(read("scaleBaud", "9600"), 10) || 9600,
  profile: read("scaleProfile", "auto"),
  format: read("scaleFormat", "8N1"),
});

export const toDriverConfig = ({ baudRate, profile, format }) => ({
  baudRate: parseInt(baudRate, 10) || 9600,
  profile,
  format,
});
