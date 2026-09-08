import React from "react";
import {
  Pagination,
  PaginationInfo,
  PaginationControls,
  PaginationLabel,
  PaginationButton,
} from "./ui/pagination";

const PaginationBar = ({
  pageStart,
  pageSize,
  totalItems,
  page,
  totalPages,
  setPage,
}) => {
  if (totalPages <= 1) return null;

  return (
    <Pagination className="mt-4">
      <PaginationInfo>
        Mostrando {pageStart + 1}–
        {Math.min(pageStart + pageSize, totalItems)} de {totalItems}
      </PaginationInfo>
      <PaginationControls>
        <PaginationLabel>
          Página {page + 1} de {totalPages}
        </PaginationLabel>
        <PaginationButton
          icon="prev"
          label="Anterior"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        />
        <PaginationButton
          icon="next"
          label="Siguiente"
          disabled={page >= totalPages - 1}
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        />
      </PaginationControls>
    </Pagination>
  );
};

export default PaginationBar;
