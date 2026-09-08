import React from "react";
import { Skeleton } from "../ui/skeleton";

const DetailSkeleton = () => (
  <div className="space-y-6 rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-2">
      <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
    <Skeleton className="h-[180px] w-full rounded-lg" />
    <div className="space-y-1.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  </div>
);

export default DetailSkeleton;