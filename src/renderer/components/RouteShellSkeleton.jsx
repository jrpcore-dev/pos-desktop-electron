import { Skeleton } from "./ui/skeleton";

const RouteShellSkeleton = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton
          key={i}
          className="h-24 rounded-md border border-border bg-card p-3"
        />
      ))}
    </div>
    <Skeleton className="h-64 rounded-lg border border-border bg-card" />
  </div>
);

export default RouteShellSkeleton;
