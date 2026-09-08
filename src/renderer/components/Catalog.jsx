import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Library,
  ScrollText,
} from "lucide-react";
import AddProductModal from "./AddProductModal";
import { useToast } from "./ToastProvider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Pagination,
  PaginationInfo,
  PaginationControls,
  PaginationLabel,
  PaginationButton,
} from "./ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { ConfirmDialog } from "./ui/confirm";
import { Skeleton } from "./ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

const PAGE_SIZES = [25, 50, 100];

const money = (v) =>
  (v || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/* ─── Subcomponentes memoizados (patrón Inventory.jsx) ───
   El estado vive en `Catalog` (búsqueda, página, categoría). Cada keystroke
   cambia `search` y re-renderiza `Catalog`; estos hijos con React.memo solo
   se re-renderizan si SUS props cambian, no cuando re-renderiza el padre. */

const CatalogHeader = memo(function CatalogHeader() {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ScrollText size={18} />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Catálogo de referencia
          </h1>
          <p className="text-sm text-muted-foreground">
            Base de datos de productos para autocompletar al escanear — no es tu
            inventario activo
          </p>
        </div>
      </div>
    </div>
  );
});
CatalogHeader.displayName = "CatalogHeader";

const CatalogSearchInput = memo(function CatalogSearchInput({
  value,
  onChange,
}) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={onChange}
        placeholder="Buscar en catálogo (nombre o código)..."
        className="h-10 pl-9"
        aria-label="Buscar en catálogo"
      />
    </div>
  );
});
CatalogSearchInput.displayName = "CatalogSearchInput";

const CatalogFilter = memo(function CatalogFilter({
  value,
  onValueChange,
  categories,
  uncategorized,
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-10 w-full sm:w-[240px]">
        <SelectValue placeholder="Todas las categorías" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">Todas las categorías</SelectItem>
        <SelectItem value="uncategorized">
          Sin clasificar ({uncategorized})
        </SelectItem>
        <SelectSeparator />
        {categories.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name} ({c.cnt})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
CatalogFilter.displayName = "CatalogFilter";

const CatalogTableHeader = memo(function CatalogTableHeader() {
  return (
    <TableHeader>
      <TableRow className="bg-primary/[0.05] hover:bg-transparent">
        <TableHead className="px-4 font-semibold text-primary/80">
          Producto
        </TableHead>
        <TableHead className="px-4 font-semibold text-primary/80">
          Categoría
        </TableHead>
        <TableHead className="px-4 font-semibold text-primary/80">
          Código
        </TableHead>
        <TableHead className="px-4 text-right font-semibold text-primary/80">
          Costo ref.
        </TableHead>
        <TableHead className="px-4 text-center font-semibold text-primary/80">
          Estado
        </TableHead>
        <TableHead className="w-40 px-4 text-right font-semibold text-primary/80">
          Acciones
        </TableHead>
      </TableRow>
    </TableHeader>
  );
});
CatalogTableHeader.displayName = "CatalogTableHeader";

const CatalogStatusBadge = memo(function CatalogStatusBadge({ pendiente }) {
  return pendiente ? (
    <Badge variant="outline" className="gap-1 whitespace-nowrap">
      <Plus size={12} className="text-primary" />
      Disponible para agregar
    </Badge>
  ) : (
    <Badge variant="success" className="gap-1 whitespace-nowrap">
      <CheckCircle2 size={12} />
      En tu inventario
    </Badge>
  );
});
CatalogStatusBadge.displayName = "CatalogStatusBadge";

const CatalogRow = memo(function CatalogRow({
  product,
  onRegister,
  onRename,
  onDelete,
}) {
  const pendiente = product.is_active !== 1;
  const showInvHint =
    !pendiente && product.inv_name && product.inv_name !== product.cat_name;
  return (
    <TableRow className="hover:bg-primary/[0.03]">
      <TableCell className="px-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">{product.cat_name}</span>
          <div className="flex items-center gap-2">
            {product.ref_unit && (
              <span className="text-xs text-muted-foreground">
                {product.ref_unit}
              </span>
            )}
            {product.sale_unit && (
              <Badge variant="outline" className="h-4 px-1.5 text-[0.65rem]">
                {product.sale_unit}
              </Badge>
            )}
            {showInvHint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground">
                    (inv.: {product.inv_name})
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  En inventario se muestra como: {product.inv_name}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="px-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
          <span className="text-sm text-foreground">
            {product.category_name || "Sin clasificar"}
          </span>
        </div>
      </TableCell>
      <TableCell className="px-4">
        <span className="font-mono text-xs text-muted-foreground">
          {product.barcode || "—"}
        </span>
      </TableCell>
      <TableCell className="px-4 text-right">
        <span className="text-xs tabular-nums text-muted-foreground">
          {money(product.cost_price)}
        </span>
      </TableCell>
      <TableCell className="px-4 text-center">
        <CatalogStatusBadge pendiente={pendiente} />
      </TableCell>
      <TableCell className="px-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {pendiente ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" onClick={() => onRegister(product)}>
                  <Plus className="h-4 w-4" />
                  Registrar
                </Button>
              </TooltipTrigger>
              <TooltipContent>Registrar en inventario</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" disabled>
                  En inventario
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ya registrado en inventario</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRename(product)}
                aria-label="Corregir nombre en catálogo"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Corregir nombre en catálogo</TooltipContent>
          </Tooltip>
          {pendiente && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(product)}
                  aria-label="Quitar del catálogo"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Quitar del catálogo</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});
CatalogRow.displayName = "CatalogRow";

const CatalogPagination = memo(function CatalogPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Pagination className="border-t px-4 py-3">
      <PaginationInfo>
        {total === 0
          ? "0 resultados"
          : `${from.toLocaleString()}–${to.toLocaleString()} de ${total.toLocaleString()}`}
      </PaginationInfo>
      <PaginationControls>
        <Select value={String(pageSize)} onValueChange={onPageSizeChange}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PaginationButton
          label="Anterior"
          icon="prev"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        />
        <PaginationLabel>
          {page + 1} / {totalPages}
        </PaginationLabel>
        <PaginationButton
          label="Siguiente"
          icon="next"
          disabled={page + 1 >= totalPages}
          onClick={() => onPageChange(page + 1)}
        />
      </PaginationControls>
    </Pagination>
  );
});
CatalogPagination.displayName = "CatalogPagination";

const Catalog = () => {
  const notify = useToast();

  const [categories, setCategories] = useState([]);
  const [uncategorized, setUncategorized] = useState(0);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(true);

  const [registerProduct, setRegisterProduct] = useState(null);
  const [renameProduct, setRenameProduct] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteProduct, setDeleteProduct] = useState(null);

  const searchRef = useRef("");
  searchRef.current = search;

  const loadCategories = useCallback(async () => {
    const res = await window.api.invoke("get-catalog-categories");
    if (res.success) {
      setCategories(res.categories);
      setUncategorized(res.uncategorized);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.api.invoke("get-catalog-products", {
        search: searchRef.current,
        categoryId,
        page: page + 1,
        pageSize,
      });
      if (res.success) {
        setRows(res.rows);
        setTotal(res.total);
      } else {
        setRows([]);
        setTotal(0);
      }
    } catch {
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [categoryId, page, pageSize]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      loadProducts();
    }, 350);
    return () => clearTimeout(t);
  }, [search, categoryId, pageSize, loadProducts]);

  useEffect(() => {
    setPage(0);
  }, [search, categoryId]);

  /* Handlers estables + reload memoizado (React.memo solo funciona si las
     props de las filas no cambian de referencia entre renders). */
  const reload = useCallback(async () => {
    await Promise.all([loadCategories(), loadProducts()]);
  }, [loadCategories, loadProducts]);

  const handleSearchChange = useCallback((e) => setSearch(e.target.value), []);
  const handleCategoryChange = useCallback((v) => setCategoryId(v), []);
  const handleOpenRegister = useCallback((p) => setRegisterProduct(p), []);
  const handleCloseRegister = useCallback(() => setRegisterProduct(null), []);
  const handleOpenRename = useCallback((p) => {
    setRenameProduct(p);
    setRenameValue(p.cat_name || p.inv_name || "");
  }, []);
  const handleCloseRename = useCallback(() => setRenameProduct(null), []);
  const handleOpenDelete = useCallback((p) => setDeleteProduct(p), []);
  const handleCloseDelete = useCallback((v) => !v && setDeleteProduct(null), []);
  const handlePageChange = useCallback((p) => setPage(Math.max(0, p)), []);
  const handlePageSizeChange = useCallback(
    (v) => setPageSize(parseInt(v, 10)),
    [],
  );

  const handleRenameSave = useCallback(async () => {
    if (!renameProduct) return;
    const res = await window.api.invoke(
      "update-catalog-name",
      renameProduct.id,
      renameValue,
    );
    if (res.success) {
      setRenameProduct(null);
      notify("Nombre del catálogo actualizado", "success");
    } else {
      notify(res.error, "error");
    }
    await reload();
  }, [renameProduct, renameValue, reload, notify]);

  const handleDelete = useCallback(async () => {
    if (!deleteProduct) return;
    const res = await window.api.invoke(
      "delete-catalog-product",
      deleteProduct.id,
    );
    if (res.success) {
      notify("Producto eliminado del catálogo", "success");
    } else {
      notify(res.error, "error");
    }
    setDeleteProduct(null);
    await reload();
  }, [deleteProduct, reload, notify]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="p-4 md:p-6">
        <CatalogHeader />

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <CatalogSearchInput value={search} onChange={handleSearchChange} />
          <CatalogFilter
            value={categoryId}
            onValueChange={handleCategoryChange}
            categories={categories}
            uncategorized={uncategorized}
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="h-[3px] w-full bg-gradient-to-r from-primary/50 via-primary/20 to-transparent" />
          <div className="w-full overflow-x-auto">
            <Table>
              <CatalogTableHeader />
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-4">
                        <div className="flex flex-col gap-1.5">
                          <Skeleton className="h-4 w-44" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </TableCell>
                      <TableCell className="px-4">
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell className="px-4">
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell className="px-4 text-right">
                        <Skeleton className="ml-auto h-4 w-16" />
                      </TableCell>
                      <TableCell className="px-4 text-center">
                        <Skeleton className="mx-auto h-5 w-28" />
                      </TableCell>
                      <TableCell className="px-4 text-right">
                        <Skeleton className="ml-auto h-6 w-24" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 px-4 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Library size={32} className="opacity-40" />
                        <p className="text-sm">
                          {search || categoryId
                            ? "Sin resultados. Ajusta la búsqueda."
                            : "Aún no hay productos en el catálogo."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((p) => (
                    <CatalogRow
                      key={p.id}
                      product={p}
                      onRegister={handleOpenRegister}
                      onRename={handleOpenRename}
                      onDelete={handleOpenDelete}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <CatalogPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>

        <AddProductModal
          key={registerProduct ? `c-${registerProduct.id}` : "closed"}
          open={!!registerProduct}
          onClose={handleCloseRegister}
          onProductAdded={reload}
          catalogProduct={registerProduct}
        />

        <Dialog open={!!renameProduct} onOpenChange={handleCloseRename}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Corregir nombre en catálogo</DialogTitle>
              <DialogDescription>
                Solo cambia el nombre que se muestra en el catálogo. No afecta el
                nombre del inventario.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) handleRenameSave();
              }}
              aria-label="Nuevo nombre en catálogo"
            />
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseRename}>
                Cancelar
              </Button>
              <Button onClick={handleRenameSave} disabled={!renameValue.trim()}>
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={!!deleteProduct}
          onOpenChange={handleCloseDelete}
          title="Quitar del catálogo"
          description={
            <>
              ¿Quitar <strong>{deleteProduct?.cat_name}</strong> del catálogo?
              Solo es posible si aún no está registrado en inventario.
            </>
          }
          confirmLabel="Quitar"
          variant="destructive"
          onCancel={() => setDeleteProduct(null)}
          onConfirm={handleDelete}
        />
      </div>
    </TooltipProvider>
  );
};

export default Catalog;