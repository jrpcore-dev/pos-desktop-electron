import * as React from "react";

import { cn } from "@/lib/utils";

// Avatar con iniciales ("Doña Mary" → "DM") y un tono estable por id, siempre
// dentro de la paleta de marca (primary y chart-1/2/3). `solid` lo pinta con
// primary sólido (p. ej. el propietario en Cajeros).

const TONES = ["--primary", "--chart-1", "--chart-2", "--chart-3"];

export const initialsOf = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase() || "?";

function InitialsAvatar({ id, name, solid = false, className }) {
  const tone = TONES[Math.abs(Number(id) || 0) % TONES.length];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        solid && "bg-primary text-primary-foreground",
        className,
      )}
      style={
        solid
          ? undefined
          : { background: `hsl(var(${tone}) / 0.12)`, color: `hsl(var(${tone}))` }
      }
    >
      {initialsOf(name)}
    </span>
  );
}

export { InitialsAvatar };
