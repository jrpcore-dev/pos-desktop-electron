import { version } from "../../../package.json";

export const installedVersion = version;

// Agrega las notas con la misma versión que se publicará en package.json.
export const releaseNotes = [
  {
    version: "2.1.5",
    revision: "aviso-compacto",
    changes: [
      {
        title: "Recargas en el carrito",
        description:
          "Agrega una recarga y cóbrala con los productos en una sola venta. Vendia te avisa cuando se aplica y guarda el estado por folio.",
      },
      {
        title: "Salidas de caja opcionales al agregar stock",
        description:
          "Al agregar stock, puedes registrar el pago de la mercancía si está habilitado en Configuración → Inventario.",
      },
      {
        title: "Aviso de posibles retiros duplicados",
        description:
          "Si ya hay un retiro similar en el turno, puedes elegir Solo sumar stock.",
      },
    ],
  },
];

export const currentRelease = releaseNotes.find(
  (release) => release.version === installedVersion,
);

const seenVersionKey = "vendia.seenReleaseVersion";
const seenRevisionKey = "vendia.seenReleaseRevision";
const versionOrder = new Intl.Collator("en", { numeric: true });
let seenThisSession;
let seenRevisionThisSession;

export const installedReleaseHistory = releaseNotes
  .filter(({ version }) => versionOrder.compare(version, installedVersion) <= 0)
  .sort((a, b) => versionOrder.compare(b.version, a.version));

function getSeenVersion() {
  if (seenThisSession) return seenThisSession;
  try {
    return localStorage.getItem(seenVersionKey);
  } catch {
    return null;
  }
}

export function hasUnseenRelease() {
  if (!currentRelease) return false;
  const seen = getSeenVersion();
  const order = seen ? versionOrder.compare(installedVersion, seen) : 1;
  if (order !== 0) return order > 0;
  if (!currentRelease.revision) return false;
  const revision = `${installedVersion}:${currentRelease.revision}`;
  if (seenRevisionThisSession === revision) return false;
  try {
    return localStorage.getItem(seenRevisionKey) !== revision;
  } catch {
    return true;
  }
}

export function markReleaseSeen() {
  const seen = getSeenVersion();
  if (!seen || versionOrder.compare(installedVersion, seen) > 0) {
    seenThisSession = installedVersion;
    try {
      localStorage.setItem(seenVersionKey, installedVersion);
    } catch {}
  }
  if (currentRelease?.revision) {
    seenRevisionThisSession = `${installedVersion}:${currentRelease.revision}`;
    try {
      localStorage.setItem(seenRevisionKey, seenRevisionThisSession);
    } catch {}
  }
}
