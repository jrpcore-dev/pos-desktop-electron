import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, User, UserPlus, Lock, Search, Loader2 } from "lucide-react";
import { useToast } from "./ToastProvider";
import { useDbChanges } from "../lib/useDbChanges";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBrandHeader,
  SheetDescription,
} from "./ui/sheet";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { InitialsAvatar } from "./ui/initials-avatar";
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

import PageHeader from "./PageHeader";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/utils/format";

// PIN nuevo o cambiado: mínimo 4 dígitos. Los de 3 que ya existían siguen
// sirviendo para entrar (el login y "sesión expirada" aceptan desde 3).
const PIN_NEW_MIN = 4;
const makeCashierSchema = (isCreate) =>
  z.object({
    name: z.string().min(1, "El nombre es requerido"),
    pin: z
      .string()
      .regex(/^\d*$/, "Solo números")
      .max(6, "Máximo 6 dígitos")
      .refine(
        (v) => (isCreate ? v.length >= PIN_NEW_MIN : v.length === 0 || v.length >= PIN_NEW_MIN),
        { message: `Mínimo ${PIN_NEW_MIN} dígitos` },
      ),
    active: z.boolean(),
  });

// Hora local de un DATETIME de SQLite (UTC): "8:02 a. m." → "8:02".
const fmtTime = (sqliteUtc) => {
  if (!sqliteUtc) return "";
  const d = new Date(String(sqliteUtc).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", hour12: false });
};
const inRegister = (c) => !!c.register_id;
// Caja abierta pero el Host no la ve conectada (apagada o sin red).
const offline = (c) => inRegister(c) && c.register_online === false;
// Con la letra si hay varias cajas con el mismo nombre: "Caja 2 (B)".
const boxLabel = (c) =>
  `${c.register_device || "otra caja"}${c.register_code ? ` (${c.register_code})` : ""}`;

// Avatar con el punto verde de quien tiene caja abierta.
const LiveAvatar = ({ cashier }) => (
  <span className={cn("relative shrink-0", !cashier.is_active && "opacity-55")}>
    <InitialsAvatar id={cashier.id} name={cashier.name} solid={cashier.role === "admin"} />
    {inRegister(cashier) && (
      <span
        className={cn(
          "absolute -right-px -bottom-px size-3 rounded-full border-2 border-card",
          offline(cashier) ? "bg-warning" : "bg-success",
        )}
        aria-hidden="true"
      />
    )}
  </span>
);

const LiveDot = () => (
  <span className="relative inline-flex size-[7px]" aria-hidden="true">
    <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
    <span className="relative size-[7px] rounded-full bg-current" />
  </span>
);

const StatusBadge = ({ cashier }) => {
  if (offline(cashier)) {
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-warning/12 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-warning/30 dark:text-warning"
        title="La caja quedó abierta pero no está conectada al Host"
      >
        <span className="size-[7px] rounded-full bg-warning" aria-hidden="true" />
        Caja abierta · {boxLabel(cashier)} sin conexión
      </span>
    );
  }
  if (inRegister(cashier)) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-semibold text-success ring-1 ring-success/25">
        <LiveDot />
        En caja · {boxLabel(cashier)}
      </span>
    );
  }
  if (!cashier.is_active) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
        Inactivo
      </span>
    );
  }
  const closed = fmtTime(cashier.closed_today_at);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      <span className="size-[7px] rounded-full bg-current" aria-hidden="true" />
      Activo{closed ? ` · cerró ${closed}` : ""}
    </span>
  );
};

const CashierRow = memo(function CashierRow({ cashier, onEdit, onDelete }) {
  const isAdmin = cashier.role === "admin";
  const count = Number(cashier.today_count || 0);
  return (
    <TableRow className={cn("group h-14 hover:bg-muted/40", !cashier.is_active && "text-muted-foreground")}>
      <TableCell className="px-4">
        <div className="flex min-w-0 items-center gap-3">
          <LiveAvatar cashier={cashier} />
          <span className="min-w-0 truncate text-sm">
            <span className={cn("font-semibold", cashier.is_active && "text-foreground")}>{cashier.name}</span>
            <span className="text-xs text-muted-foreground"> · {isAdmin ? "Propietario" : "Cajero"}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="px-4">
        <StatusBadge cashier={cashier} />
      </TableCell>
      <TableCell className="px-4">
        {count > 0 ? (
          <div className="leading-tight">
            <b className="text-sm font-semibold tabular-nums text-foreground">{fmtMoney(cashier.today_total)}</b>
            <span className="block text-[11px] text-muted-foreground">
              {count} {count === 1 ? "venta" : "ventas"}
            </span>
          </div>
        ) : (
          <div className="leading-tight text-muted-foreground">
            <b className="text-sm font-semibold">—</b>
            {cashier.is_active ? <span className="block text-[11px]">sin ventas</span> : null}
          </div>
        )}
      </TableCell>
      <TableCell className="px-4 text-right">
        {!isAdmin && (
          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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

// "En caja ahora": quien tiene una caja abierta, en cuál y desde qué hora.
const LiveCard = ({ cashier }) => {
  const count = Number(cashier.today_count || 0);
  const opened = fmtTime(cashier.register_opened_at);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 shadow-sm ring-[1.5px]",
        offline(cashier) ? "ring-warning/40" : "ring-success/30",
      )}
    >
      <LiveAvatar cashier={cashier} />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{cashier.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {boxLabel(cashier)}
          {opened ? ` · abrió ${opened}` : ""}
        </p>
        {offline(cashier) && (
          <p className="mt-0.5 text-[11px] font-semibold text-amber-700 dark:text-warning">
            Sin conexión · la caja quedó abierta
          </p>
        )}
      </div>
      <div className="ml-auto shrink-0 text-right text-xs text-muted-foreground">
        hoy
        <b className="block text-[15px] font-bold tabular-nums text-foreground">
          {count} {count === 1 ? "venta" : "ventas"}
        </b>
      </div>
    </div>
  );
};

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

  // `silent` → refresco en vivo sin parpadeo de skeletons (db-changed).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Con su día (caja abierta, ventas de hoy); si falla, la lista simple.
      let list = await window.api.invoke("get-cashiers-overview");
      if (!Array.isArray(list)) list = await window.api.invoke("get-cashiers");
      if (Array.isArray(list)) setCashiers(list);
    } catch {}
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Cualquier alta/baja/edición de cajero (en el Host o en la réplica de una
  // caja) recarga la lista al instante, sin recargar la pantalla.
  // También al abrir/cerrar una caja o vender: el estado "En caja" y lo de hoy.
  useDbChanges(() => load(true), ["cashiers", "cash_register", "sales"]);

  const [statusFilter, setStatusFilter] = useState("all");
  const live = useMemo(() => cashiers.filter(inRegister), [cashiers]);
  const offCount = live.filter(offline).length;
  const counts = useMemo(
    () => ({
      all: cashiers.length,
      live: live.length,
      active: cashiers.filter((c) => c.is_active).length,
      inactive: cashiers.filter((c) => !c.is_active).length,
    }),
    [cashiers, live],
  );
  const filterChips = [
    { value: "all", label: "Todos" },
    { value: "live", label: "En caja" },
    { value: "active", label: "Activos" },
    { value: "inactive", label: "Inactivos" },
  ];
  const term = searchTerm.trim().toLowerCase();
  const filtered = cashiers.filter((c) => {
    if (term && !c.name.toLowerCase().includes(term)) return false;
    if (statusFilter === "live") return inRegister(c);
    if (statusFilter === "active") return !!c.is_active;
    if (statusFilter === "inactive") return !c.is_active;
    return true;
  });
  const headerSummary = loading
    ? "Gestiona los usuarios del sistema"
    : [
        live.length - offCount ? `${live.length - offCount} en caja ahora` : null,
        offCount ? `${offCount} sin conexión` : null,
        `${counts.active} ${counts.active === 1 ? "activo" : "activos"}`,
        counts.inactive ? `${counts.inactive} ${counts.inactive === 1 ? "inactivo" : "inactivos"}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

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
    <div className="p-1">
      <PageHeader
        description={headerSummary}
        actions={
          <Button onClick={() => handleOpen()}>
            <Plus className="h-4 w-4" />
            Nuevo Cajero
          </Button>
        }
      />

      {!loading && live.length > 0 && (
        <section aria-label="En caja ahora" className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            En caja ahora
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {live.map((c) => (
              <LiveCard key={c.id} cashier={c} />
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
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
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-sidebar p-1" role="group" aria-label="Filtrar por estado">
          {filterChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
              aria-pressed={statusFilter === chip.value}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                statusFilter === chip.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              {chip.label}
              <span
                className={cn(
                  "rounded px-1 tabular-nums",
                  statusFilter === chip.value ? "bg-primary-foreground/20" : "bg-muted",
                )}
              >
                {counts[chip.value]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                Nombre
              </TableHead>
              <TableHead>
                Estado
              </TableHead>
              <TableHead>
                Hoy
              </TableHead>
              <TableHead className="w-28 text-right">
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
                        : "Ningún cajero coincide con la búsqueda o el filtro"}
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
          <SheetBrandHeader
            icon={<UserPlus />}
            title={<>{editing ? "Editar Cajero" : "Nuevo Cajero"}</>}
            description={<>{editing
                  ? "Modifica la información del cajero"
                  : "Ingresa la información del nuevo cajero"}</>}
          />

          <div className="flex-1 space-y-4 overflow-y-auto px-6">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
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
            <div className="space-y-2">
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
                      placeholder={editing ? "••••••" : `Mínimo ${PIN_NEW_MIN} dígitos`}
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
                  ? `Dejar vacío para mantener el actual · uno nuevo, mínimo ${PIN_NEW_MIN} dígitos`
                  : `Mínimo ${PIN_NEW_MIN} dígitos`}
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

          <div className="flex gap-2 border-t bg-muted/50 px-6 py-4 [&>button]:flex-1">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isSubmitting
                ? "Guardando..."
                : editing
                  ? "Guardar cambios"
                  : "Crear cajero"}
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


