import { cn } from "@/lib/utils";
import { Spinner } from "../ui/spinner";

/**
 * Iconografia de estado de los servicios.
 *
 * Todo hereda `currentColor`, asi el SVG sigue al tema claro/oscuro sin
 * necesitar dos juegos de assets. Los paths son de lucide, que ya es
 * dependencia del proyecto.
 */

const GLYPHS = {
  pending: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  applied: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5.2" />
    </>
  ),
  failed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  unknown: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.4-2.5 2.4" />
      <path d="M12 16.4h.01" strokeWidth="2.4" />
    </>
  ),
  reversed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M16 12a4 4 0 1 1-1.2-2.85" />
      <path d="M16 6.6V9h-2.4" />
    </>
  ),
};

/** Glifo de 24x24 para badges, listas y tablas. */
export const ServiceStateGlyph = ({ status, className, ...props }) => {
  if (status === "pending") {
    return (
      <Spinner
        size={14}
        className={cn("text-current", className)}
        {...props}
      />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      {GLYPHS[status] || GLYPHS.unknown}
    </svg>
  );
};

/**
 * Arte del panel de resultado: circulo con el glifo dentro.
 * El halo lo pinta el estado con una clase de fondo translucida, para que el
 * SVG nunca lleve color fijo.
 */
export const ServiceResultArt = ({ status, className, ringClassName }) => (
  <div
    className={cn(
      "flex h-24 w-24 items-center justify-center rounded-full",
      ringClassName,
      className,
    )}
  >
    {status === "pending" ? (
      <Spinner size={40} className="text-current" />
    ) : (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="size-10"
      >
        {GLYPHS[status] || GLYPHS.unknown}
      </svg>
    )}
  </div>
);

/** Ilustracion de pantalla vacia para el historial sin movimientos. */
export const ServicesEmptyArt = ({ className }) => (
  <svg
    viewBox="0 0 120 96"
    fill="none"
    aria-hidden
    className={cn("h-24 w-32 text-muted-foreground/45", className)}
  >
    <rect
      x="14"
      y="18"
      width="92"
      height="66"
      rx="8"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path d="M14 34h92" stroke="currentColor" strokeWidth="2" />
    <circle cx="24" cy="26" r="2.4" fill="currentColor" />
    <circle cx="33" cy="26" r="2.4" fill="currentColor" />
    <rect x="24" y="44" width="26" height="6" rx="3" fill="currentColor" />
    <rect x="24" y="58" width="48" height="6" rx="3" fill="currentColor" />
    <rect
      x="78"
      y="44"
      width="18"
      height="20"
      rx="4"
      fill="currentColor"
      opacity="0.5"
    />
  </svg>
);