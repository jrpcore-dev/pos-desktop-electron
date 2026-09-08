import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, User, Lock, Search, Loader2 } from "lucide-react";
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
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
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

const makeCashierSchema = (isCreate) =>
  z.object({
    name: z.string().min(1, "El nombre es requerido"),
    pin: z
      .string()
      .regex(/^\d*$/, "Solo números")
      .max(6, "Máximo 6 dígitos")
      .refine(
        (v) => (isCreate ? v.length >= 3 : v.length === 0 || v.length >= 3),
        { message: "Mínimo 3 dígitos" },
      ),
    active: z.boolean(),
  });

const CashierRow = memo(function CashierRow({ cashier, onEdit, onDelete }) {
  const isAdmin = cashier.role === "admin";
  return (
    <TableRow>
      <TableCell className="px-4">
        <div className="flex items-center gap-2.5">
          {isAdmin ? (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "hsl(var(--brand))", color: "#fff" }}
              aria-hidden="true"
            >
              <User size={16} />
            </span>
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <User size={16} />
            </span>
          )}
          <span className="truncate text-sm font-semibold text-foreground">
            {cashier.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="px-4">
        <Badge variant={isAdmin ? "default" : "outline"}>
          {isAdmin ? "Propietario" : "Cajero"}
        </Badge>
      </TableCell>
      <TableCell className="px-4">
        <Badge variant={cashier.is_active ? "success" : "outline"}>
          {cashier.is_active ? "Activo" : "Inactivo"}
        </Badge>
      </TableCell>
      <TableCell className="px-4 text-right">
        {!isAdmin && (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(cashier)}
                  aria-label={`Editar cajero ${cashier.name}`}
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
                  onClick={() => onDelete(cashier)}
                  aria-label={`Eliminar cajero ${cashier.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Eliminar</TooltipContent>
            </Tooltip>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
});

const Cashiers = () => {
  const [cashiers, setCashiers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const notify = useToast();

  const isCreate = !editing;

  const cashierSchema = useMemo(() => makeCashierSchema(isCreate), [isCreate]);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(cashierSchema),
    defaultValues: { name: "", pin: "", active: true },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.api.invoke("get-cashiers");
      setCashiers(list);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, []);

  const filtered = searchTerm.trim()
    ? cashiers.filter((c) =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : cashiers;

  const handleOpen = (cashier = null) => {
    setEditing(cashier);
    reset(
      cashier
        ? { name: cashier.name, pin: "", active: cashier.is_active === 1 }
        : { name: "", pin: "", active: true },
    );
    setError("");
    setDialogOpen(true);
  };

  const onValid = async (data) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (editing) {
        await window.api.invoke("update-cashier", editing.id, {
          name: data.name.trim(),
          pin: data.pin,
          role: "cashier",
          is_active: editing.role === "admin" ? 1 : data.active ? 1 : 0,
        });
      } else {
        await window.api.invoke("add-cashier", {
          name: data.name.trim(),
          pin: data.pin,
          role: "cashier",
        });
      }
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSave = handleSubmit(onValid);

  const handleDelete = async (id) => {
    try {
      await window.api.invoke("delete-cashier", id);
      setDeleteConfirm(null);
      load();
    } catch {}
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Cajeros
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los usuarios del sistema
          </p>
        </div>
        <Button onClick={() => handleOpen()}>
          <Plus className="h-4 w-4" />
          Nuevo Cajero
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
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar cajeros por nombre..."
          className="h-10 pl-9"
          aria-label="Buscar cajeros por nombre"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              <TableHead className="px-4 font-semibold text-foreground/75">
                Nombre
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Rol
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Estado
              </TableHead>
              <TableHead className="w-28 px-4 text-right font-semibold text-foreground/75">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4">
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell className="px-4">
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <Skeleton className="ml-auto h-6 w-16" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-28 px-4 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <User size={32} className="opacity-40" />
                    <p className="text-sm">
                      {cashiers.length === 0
                        ? "No hay cajeros registrados"
                        : "No se encontraron cajeros con ese nombre"}
                    </p>
                    {cashiers.length === 0 && (
                      <Button size="sm" onClick={() => handleOpen()}>
                        <Plus className="h-4 w-4" />
                        Nuevo cajero
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <CashierRow
                  key={c.id}
                  cashier={c}
                  onEdit={handleOpen}
                  onDelete={setDeleteConfirm}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
        <SheetContent
          side="right"
          className="sm:max-w-lg"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleSave();
          }}
        >
          <SheetHeader>
            <div className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg"
style={{ backgroundColor: "hsl(var(--brand))", color: "#fff" }}
              >
                <User size={18} color="#fff" />
              </span>
              <div>
                <SheetTitle className="text-base">
                  {editing ? "Editar Cajero" : "Nuevo Cajero"}
                </SheetTitle>
                <SheetDescription>
                  {editing
                    ? "Actualiza los datos del cajero"
                    : "Registra un nuevo cajero"}
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
                    placeholder="Ej: Juan Pérez"
                    autoFocus
                    aria-invalid={!!errors.name}
                    {...field}
                  />
                )}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>PIN de acceso</Label>
              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Controller
                  name="pin"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="password"
                      inputMode="numeric"
                      aria-invalid={!!errors.pin}
                      placeholder={editing ? "••••••" : "Mínimo 3 dígitos"}
                      className="pl-9"
                      maxLength={6}
                      onChange={(e) =>
                        field.onChange(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      value={field.value}
                    />
                  )}
                />
              </div>
              {errors.pin && (
                <p className="text-xs text-destructive">{errors.pin.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "Dejar vacío para mantener el actual"
                  : "Mínimo 3 dígitos"}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
              <Controller
                name="active"
                control={control}
                render={({ field }) => (
                  <>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {field.value ? "Usuario activo" : "Usuario inactivo"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {field.value
                          ? "Podrá iniciar sesión en la app móvil"
                          : "Bloqueado: no podrá acceder desde la app móvil"}
                      </p>
                    </div>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={editing?.role === "admin"}
                      aria-label="Activar usuario"
                    />
                  </>
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
        title="Eliminar Cajero"
        description={<>¿Eliminar a <strong>{deleteConfirm?.name}</strong>?</>}
        confirmLabel="Eliminar"
        variant="destructive"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => handleDelete(deleteConfirm.id)}
      />
    </div>
    </TooltipProvider>
  );
};

export default Cashiers;
