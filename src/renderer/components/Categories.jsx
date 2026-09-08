import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Shapes, Search, Loader2 } from "lucide-react";
import { useToast } from "./ToastProvider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Skeleton } from "./ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { usePagination } from "../lib/usePagination";
import PaginationBar from "./PaginationBar";

const CAT_COLORS = [
  "hsl(var(--category-1))",
  "hsl(var(--sky))",
  "hsl(var(--category-2))",
  "hsl(var(--category-3))",
  "hsl(var(--category-4))",
  "hsl(var(--category-5))",
];

const PAGE_SIZE = 10;

const categorySchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional(),
});

const CategoryRow = memo(function CategoryRow({ category, colorIndex, onEdit, onDelete }) {
  const col = CAT_COLORS[colorIndex % CAT_COLORS.length];
  return (
    <TableRow>
      <TableCell className="px-4">
        <div className="flex items-center gap-2.5">
          <span
            className="h-4 w-4 shrink-0 rounded-sm border border-black/5"
            style={{ backgroundColor: col }}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold text-foreground">
            {category.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="max-w-md px-4">
        <span className="block truncate text-sm text-muted-foreground">
          {category.description || "Sin descripción"}
        </span>
      </TableCell>
      <TableCell className="px-4 text-sm tabular-nums text-foreground">
        {category.product_count || 0}
      </TableCell>
      <TableCell className="px-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(category)}
                aria-label={`Editar categoría ${category.name}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Editar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(category)}
                aria-label={`Eliminar categoría ${category.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Eliminar</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
});

const Categories = () => {
  const [categories, setCategories] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const notify = useToast();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", description: "" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.api.invoke("get-categories");
      setCategories(list);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

const filtered = useMemo(
    () =>
      searchTerm.trim()
        ? categories.filter((c) =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase())
          )
        : categories,
    [searchTerm, categories]
  );

  const {
    pagedRows,
    page: currentPage,
    totalPages,
    pageStart,
    setPage,
    reset: resetPage,
  } = usePagination(filtered, { pageSize: PAGE_SIZE });

  const colorIndexMap = useMemo(() => {
    const m = new Map();
    filtered.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [filtered]);

  const displayRows = pagedRows.map((c) => ({
    category: c,
    colorIndex: colorIndexMap.get(c.id) ?? 0,
  }));

  const handleOpen = useCallback((cat = null) => {
    setEditing(cat);
    reset(
      cat
        ? { name: cat.name, description: cat.description || "" }
        : { name: "", description: "" },
    );
    setError("");
    setDialogOpen(true);
  }, [reset, setDialogOpen]);

  const onValid = useCallback(async (data) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (editing) {
        await window.api.invoke("update-category", editing.id, {
          name: data.name.trim(),
          description: data.description?.trim() || "",
        });
      } else {
        await window.api.invoke("add-category", {
          name: data.name.trim(),
          description: data.description?.trim() || "",
        });
      }
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [editing, load, setDialogOpen, setError, isSubmitting]);

  const handleSave = handleSubmit(onValid);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      const result = await window.api.invoke(
        "delete-category",
        deleteConfirm.id,
      );
      if (result.success) {
        setDeleteConfirm(null);
        load();
      } else {
        notify(result.error, "error");
        setDeleteConfirm(null);
      }
    } catch {}
  }, [deleteConfirm, load, notify]);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Categorías
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestiona las categorías de productos
          </p>
        </div>
        <Button onClick={() => handleOpen()}>
          <Plus className="h-4 w-4" />
          Nueva Categoría
        </Button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            resetPage();
          }}
          placeholder="Buscar categorías por nombre..."
          className="h-10 pl-9"
          aria-label="Buscar categorías por nombre"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              <TableHead className="px-4 font-semibold text-foreground/75">
                Categoría
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Descripción
              </TableHead>
              <TableHead className="w-24 px-4 font-semibold text-foreground/75">
                Productos
              </TableHead>
              <TableHead className="w-28 px-4 text-right font-semibold text-foreground/75">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="h-4 w-4 rounded-sm" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <Skeleton className="h-4 w-48 max-w-full" />
                  </TableCell>
                  <TableCell className="px-4">
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Skeleton className="h-9 w-9 rounded-md" />
                      <Skeleton className="h-9 w-9 rounded-md" />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-28 px-4 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Shapes size={32} className="opacity-40" />
                    <p className="text-sm">
                      {categories.length === 0
                        ? "No hay categorías registradas"
                        : "No se encontraron categorías con ese nombre"}
                    </p>
                    {categories.length === 0 && (
                      <Button size="sm" onClick={() => handleOpen()}>
                        <Plus className="h-4 w-4" />
                        Nueva categoría
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              displayRows.map(({ category, colorIndex }) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  colorIndex={colorIndex}
                  onEdit={handleOpen}
                  onDelete={setDeleteConfirm}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && filtered.length > 0 && totalPages > 1 && (
        <PaginationBar
          pageStart={pageStart}
          pageSize={PAGE_SIZE}
          totalItems={filtered.length}
          page={currentPage}
          totalPages={totalPages}
          setPage={setPage}
        />
      )}

      <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: "hsl(var(--slate-800))", color: "#fff" }}
              >
                <Shapes size={18} color="#fff" />
              </span>
              <div>
                <SheetTitle className="text-base">
                  {editing ? "Editar Categoría" : "Nueva Categoría"}
                </SheetTitle>
                <SheetDescription>
                  {editing
                    ? "Actualiza los datos de la categoría"
                    : "Registra una nueva categoría de productos"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nombre</Label>
<Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <Input
                    placeholder="Ej: Bebidas"
                    autoFocus
                    aria-invalid={!!errors.name}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) handleSave();
                    }}
                    {...field}
                  />
                )}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Descripción (opcional)</Label>
              <Controller
                name="description"
                control={control}
                render={({ field }) => (
                  <textarea
                    className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-3.5 py-2.5 text-sm shadow-sm transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/50"
                    placeholder="Describa la categoría"
                    rows={2}
                    {...field}
                  />
                )}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isSubmitting
                ? "Guardando..."
                : editing
                  ? "Guardar"
                  : "Agregar"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        title="Eliminar Categoría"
        description={
          <>¿Eliminar <strong>{deleteConfirm?.name}</strong>? No se puede eliminar si tiene productos asociados.</>
        }
        confirmLabel="Eliminar"
        variant="destructive"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
      />
    </div>
    </TooltipProvider>
  );
};

export default Categories;
