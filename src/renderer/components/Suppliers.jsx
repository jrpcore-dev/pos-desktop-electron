import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  PlusCircle, Search, Truck, Pencil, Trash2,
  Phone, Mail, User, MapPin, Loader2,
} from "lucide-react";
import { useToast } from "./ToastProvider";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "./ui/sheet";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { ConfirmDialog } from "./ui/confirm";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "./ui/table";
import { Skeleton } from "./ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "./ui/tooltip";
import { usePagination } from "../lib/usePagination";
import PaginationBar from "./PaginationBar";

const PAGE_SIZE = 10;

const supplierSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  contact: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  address: z.string().optional(),
});

const SupplierRow = memo(function SupplierRow({ supplier, onEdit, onDelete }) {
  return (
    <TableRow>
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Truck size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {supplier.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {supplier.address || "Sin dirección"}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <p className="text-sm font-semibold text-foreground">
          {supplier.contact || "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          {supplier.product_count || 0} productos
        </p>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate text-xs">{supplier.phone || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate text-xs">{supplier.email || "—"}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(supplier)}
                aria-label={`Editar proveedor ${supplier.name}`}
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
                onClick={() => onDelete(supplier)}
                aria-label={`Eliminar proveedor ${supplier.name}`}
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

const Suppliers = () => {
  const notify = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(supplierSchema),
    defaultValues: { name: "", contact: "", phone: "", email: "", address: "" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.invoke("get-suppliers");
      setSuppliers(result);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () =>
      searchTerm.trim()
        ? suppliers.filter(
            (s) =>
              s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (s.contact || "").toLowerCase().includes(searchTerm.toLowerCase()),
          )
        : suppliers,
    [searchTerm, suppliers]
  );

  const {
    pagedRows,
    page: currentPage,
    totalPages,
    pageStart,
    setPage,
    reset: resetPage,
  } = usePagination(filtered, { pageSize: PAGE_SIZE });

  const openAdd = useCallback(() => {
    setEditItem(null);
    reset({ name: "", contact: "", phone: "", email: "", address: "" });
    setSubmitError("");
    setModalOpen(true);
  }, [reset, setModalOpen]);

  useEffect(() => {
    const handler = () => openAdd();
    window.addEventListener("ctrl-p", handler);
    return () => window.removeEventListener("ctrl-p", handler);
  }, [openAdd]);

  const openEdit = useCallback((s) => {
    setEditItem(s);
    reset({
      name: s.name,
      contact: s.contact || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
    });
    setSubmitError("");
    setModalOpen(true);
  }, [reset, setModalOpen]);

  const onSubmit = useCallback(async (data) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError("");
    const result = editItem
      ? await window.api.invoke("update-supplier", editItem.id, data)
      : await window.api.invoke("add-supplier", data);
    if (result.success) {
      setModalOpen(false);
      load();
    } else {
      setSubmitError(result.error);
    }
    setIsSubmitting(false);
  }, [editItem, load, isSubmitting]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const result = await window.api.invoke(
      "delete-supplier",
      deleteConfirm.id,
    );
    if (result.success) {
      setDeleteConfirm(null);
      load();
    } else {
      notify(result.error, "error");
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, load, notify]);

  const SupplierForm = memo(function SupplierForm({ control, errors }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="supplier-name">Nombre del proveedor</Label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <div className="relative">
              <Truck
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="supplier-name"
                autoFocus
                aria-invalid={!!errors.name}
                placeholder="Ej: Distribuidora Central S.A."
                className="pl-9"
                {...field}
              />
            </div>
          )}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="supplier-contact">Persona de contacto</Label>
        <Controller
          name="contact"
          control={control}
          render={({ field }) => (
            <div className="relative">
              <User
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="supplier-contact"
                placeholder="Ej: Ricardo Gómez"
                className="pl-9"
                {...field}
              />
            </div>
          )}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="supplier-phone">Teléfono</Label>
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <div className="relative">
                <Phone
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="supplier-phone"
                  type="tel"
                  placeholder="Ej: +52 312 456 7890"
                  className="pl-9"
                  {...field}
                />
              </div>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="supplier-email">Email</Label>
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <div className="relative">
                <Mail
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="supplier-email"
                  type="email"
                  aria-invalid={!!errors.email}
                  placeholder="ventas@central.com"
                  className="pl-9"
                  {...field}
                />
              </div>
            )}
          />
          {errors.email && (
            <p className="text-xs text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="supplier-address">Dirección</Label>
        <Controller
          name="address"
          control={control}
          render={({ field }) => (
            <div className="relative">
              <MapPin
                size={16}
                className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
                aria-hidden="true"
              />
              <textarea
                id="supplier-address"
                rows={2}
                placeholder="Dirección del proveedor"
                className="flex min-h-[70px] w-full rounded-lg border border-input bg-transparent py-2.5 pl-9 pr-3.5 text-sm shadow-sm transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/50"
                {...field}
              />
            </div>
          )}
        />
      </div>
    </div>
  );
});

  return (
    <TooltipProvider delayDuration={200}>
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Proveedores
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestiona tus proveedores y datos de contacto
          </p>
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <PlusCircle className="h-4 w-4" />
          Nuevo Proveedor
          <KbdGroup className="ml-1">
            <Kbd className="h-[20px] rounded-[6px] border border-slate-200/60 bg-slate-300/35 px-2 font-sans text-[13px] font-bold leading-none text-slate-50 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
              Ctrl
            </Kbd>
            <Kbd className="h-[20px] rounded-[6px] border border-slate-200/60 bg-slate-300/35 px-2 font-sans text-[13px] font-bold leading-none text-slate-50 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
              P
            </Kbd>
          </KbdGroup>
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
          placeholder="Buscar proveedores..."
          className="h-10 pl-9"
          aria-label="Buscar proveedores"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              <TableHead className="px-4 font-semibold text-foreground/75">
                Proveedor
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Contacto Principal
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Comunicación
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
                      <Skeleton className="h-9 w-9 rounded-md" />
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="space-y-1">
                      <Skeleton className="h-3 w-36" />
                      <Skeleton className="h-3 w-40" />
                    </div>
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
                    <Truck size={32} className="opacity-40" />
                    <p className="text-sm">
                      {suppliers.length === 0
                        ? "No hay proveedores registrados"
                        : "No se encontraron proveedores con ese nombre"}
                    </p>
                    {suppliers.length === 0 && (
                      <Button size="sm" onClick={openAdd}>
                        <PlusCircle className="h-4 w-4" />
                        Nuevo proveedor
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((s) => (
                <SupplierRow
                  key={s.id}
                  supplier={s}
                  onEdit={openEdit}
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

      <Sheet open={modalOpen} onOpenChange={setModalOpen}>
        <SheetContent
          side="right"
          className="sm:max-w-lg"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleSubmit(onSubmit)();
          }}
        >
          <SheetHeader>
            <div className="flex items-center gap-3">
              <span
className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: "hsl(var(--slate-800))", color: "#fff" }}
              >
                <Truck size={18} color="#fff" />
              </span>
              <div>
                <SheetTitle className="text-base">
                  {editItem ? "Editar Proveedor" : "Nuevo Proveedor"}
                </SheetTitle>
                <SheetDescription>
                  {editItem
                    ? "Modifique la información del proveedor"
                    : "Complete la información del proveedor"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6">
            {submitError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            )}
            <SupplierForm control={control} errors={errors} />
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {isSubmitting
                ? "Guardando..."
                : editItem
                  ? "Actualizar"
                  : "Crear"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        title="Confirmar Eliminación"
        description={
          <>¿Eliminar el proveedor "<strong>{deleteConfirm?.name}</strong>"? Esta acción no se puede deshacer.</>
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

export default Suppliers;
