import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { getStatus } from "./serviceStatus";
import { ServiceStateGlyph } from "./serviceIcons";

/**
 * Badge de estado de una transacción de servicio.
 * Combina el color del estado (`serviceStatus.js`) con su glifo SVG.
 */
const ServiceStatusBadge = ({ status, className }) => {
  const s = getStatus(status);
  return (
    <Badge
      variant={s.badgeVariant}
      className={cn("gap-1.5 whitespace-nowrap", className)}
    >
      <ServiceStateGlyph status={status} />
      {s.label}
    </Badge>
  );
};

export default ServiceStatusBadge;