import { cn } from "@/lib/utils";
import { OPERATOR_LOGOS } from "./operatorLogos";

/**
 * Los logos oficiales vienen con proporciones muy distintas (Netflix es 1:1,
 * Megacable 6:1). Por eso el alto y el ancho van en auto con max-*: el
 * navegador encaja la imagen sin deformarla.
 */
const MAX_H = {
  sm: "max-h-8",
  md: "max-h-12",
  lg: "max-h-16",
  xl: "max-h-20",
};

export function OperatorIcon({ id, name, size = "md", className }) {
  const src = OPERATOR_LOGOS[id];
  if (!src) {
    return (
      <span
        className={cn(
          "flex items-center text-lg font-bold text-muted-foreground",
          className,
        )}
      >
        {name.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className={cn("h-auto w-auto max-w-full object-contain", MAX_H[size], className)}
    />
  );
}