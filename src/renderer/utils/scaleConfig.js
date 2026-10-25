// Configuración de la báscula guardada en esta PC (cada caja tiene la suya).
// Los valores coinciden con PROFILES / FORMATS de src/main/scale.js.

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
