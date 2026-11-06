// Al cerrar sesión se recuerda quién la cerró y en qué pantalla estaba. Si esa
// misma persona vuelve a entrar sigue donde iba; cualquier otra empieza en la
// terminal. Va en localStorage para sobrevivir a un reinicio de la app.
const KEY = "lastSessionRoute";
const HOME = "/";

export const rememberSessionRoute = (cashier, hash) => {
  try {
    if (!cashier?.id) return;
    const path = String(hash || "").replace(/^#/, "");
    if (!path.startsWith("/")) return;
    localStorage.setItem(KEY, JSON.stringify({ cashierId: cashier.id, path }));
  } catch {}
};

export const routeAfterLogin = (cashier) => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && String(saved.cashierId) === String(cashier?.id) && saved.path) {
      return saved.path;
    }
  } catch {}
  return HOME;
};
