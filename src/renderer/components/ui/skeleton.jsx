import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("vt-skeleton rounded-lg bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
