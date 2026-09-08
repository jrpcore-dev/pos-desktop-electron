import React from "react";
import { Skeleton } from "../ui/skeleton";

const CardSkeleton = ({ count = 1 }) => (
  <div className="flex flex-wrap gap-3">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="flex flex-1 basis-[200px] items-start justify-between gap-3 rounded-md border border-border bg-card p-3"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-10" />
      </div>
    ))}
  </div>
);

export default CardSkeleton;
