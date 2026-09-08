import React from "react";
import { Skeleton } from "../ui/skeleton";

const TableSkeleton = ({ rows = 5, columns = 4, height = 40 }) => (
  <div className="overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex">
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="flex-1 px-4 py-3">
          <Skeleton className="h-5 w-4/5" />
        </div>
      ))}
    </div>
    <div className="border-t border-border">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex border-b border-border last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="flex-1 px-4 py-3">
              <Skeleton
                className={
                  c === 0
                    ? "w-3/5"
                    : c === columns - 1
                      ? "w-2/5"
                      : "w-4/5"
                }
                style={{ height: Math.max(16, height - 16) }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default TableSkeleton;