import { cn } from "@/lib/utils";

const Spinner = ({ className, size = 16, strokeWidth, ...props }) => {
  const sw = strokeWidth ?? Math.max(2.5, (size * 3) / 24);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
      className={cn("animate-spin", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth={sw}
      />
      <path
        d="M2 12a10 10 0 0 1 10-10"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
};

export { Spinner };