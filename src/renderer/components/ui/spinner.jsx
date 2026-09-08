import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const Spinner = ({ className, size = 16, ...props }) => (
  <Loader2
    role="status"
    aria-label="Loading"
    className={cn("animate-spin", className)}
    style={{ width: size, height: size }}
    {...props}
  />
);

export { Spinner };
