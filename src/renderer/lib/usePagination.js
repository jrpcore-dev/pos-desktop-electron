import { useState, useCallback, useMemo } from "react";

export function usePagination(items, { pageSize = 10 } = {}) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * pageSize;
  const pagedRows = useMemo(
    () => items.slice(pageStart, pageStart + pageSize),
    [items, pageStart, pageSize],
  );
  const reset = useCallback(() => setPage(0), []);

  return {
    pagedRows,
    page: currentPage,
    totalPages,
    pageStart,
    setPage,
    reset,
    totalItems: items.length,
    pageSize,
  };
}
