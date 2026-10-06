import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  PlusCircle,
  Search,
  Pencil,
  Trash2,
  Users,
  UserPlus,
  QrCode,
  BadgeCheck,
  Printer,
  Copy,
} from "lucide-react";
import QRCode from "qrcode";
import { useToast } from "./ToastProvider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "./ui/sheet";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { ConfirmDialog } from "./ui/confirm";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Skeleton } from "./ui/skeleton";

const PAGE_SIZE = 10;

const CustomerForm = ({ value, onChange }) => (
  <div className="space-y-4">
    <div className="space-y-1.5">
      <Label htmlFor="customer-name">Nombre</Label>
      <Input
        id="customer-name"
        type="text"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        placeholder="Nombre del cliente"
        className="h-12 text-base"
        autoFocus
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="customer-phone">Teléfono</Label>
      <Input
        id="customer-phone"
        type="tel"
        value={value.phone}
        onChange={(e) => onChange({ ...value, phone: e.target.value })}
        placeholder="55 0000 0000"
        className="h-12 text-base tabular-nums"
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="customer-tier">Nivel</Label>
      <Select
        value={value.tier_id ? String(value.tier_id) : "none"}
        onValueChange={(v) =>
          onChange({
            ...value,
            tier_id: v === "none" ? null : Number(v),
          })
        }
      >
        <SelectTrigger id="customer-tier" className="h-12">
          <BadgeCheck className="h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Seleccionar nivel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sin nivel (precio normal)</SelectItem>
          {value.tiers.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </div>
);

const ProductPicker = ({ onPick, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await window.api.invoke("search-products", q);
        if (!cancelled) setResults(rows || []);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="relative mb-2">
        <Search
          size={18}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto (mín. 3)..."
          className="h-12 pl-10 text-base"
          autoFocus
        />
      </div>
      <div className="max-h-56 overflow-auto">
        {results.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {p.name}
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-success">
              ${Number(p.price || 0).toFixed(2)}
            </span>
          </button>
        ))}
        {query.trim().length >= 3 && results.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            Sin resultados
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-11 w-full"
        onClick={onClose}
      >
        Cancelar
      </Button>
    </div>
  );
};

const QrDialog = ({ customer, open, onClose }) => {
  const notify = useToast();
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    if (!open || !customer?.qr_code) return;
    QRCode.toDataURL(customer.qr_code, { width: 320, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [open, customer]);

  const printQr = async () => {
    if (!dataUrl || !customer) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:sans-serif;text-align:center;margin:0;padding:8px 0;color:#000}
      img{width:200px;height:200px}
      .n{font-size:14px;font-weight:bold}
      .c{font-size:12px}
    </style></head><body>
      <div class="n">${customer.name}</div>
      <img src="${dataUrl}" />
      <div class="c">${customer.qr_code}</div>
    </body></html>`;
    try {
      const res = await window.api.invoke("print-receipt", html);
      if (res.success) notify("QR enviado a la impresora", "success");
      else notify(res.error || "No se pudo imprimir", "error");
    } catch {
      notify("No se pudo imprimir", "error");
    }
  };

  const copyCode = async () => {
    if (!customer) return;
    try {
      await navigator.clipboard.writeText(customer.qr_code);
      notify("Código copiado", "success");
    } catch {
      notify("No se pudo copiar", "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode size={20} />
            Código QR de {customer?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={`QR ${customer?.qr_code}`}
              className="h-64 w-64 rounded-lg border border-border bg-white p-2"
            />
          ) : (
            <Skeleton className="h-64 w-64 rounded-lg" />
          )}
          <span className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold tabular-nums text-foreground">
            {customer?.qr_code}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-12 flex-1" onClick={copyCode}>
            <Copy size={16} />
            Copiar
          </Button>
          <Button
            type="button"
            className="h-12 flex-1 bg-success text-white hover:bg-success/90"
            onClick={printQr}
          >
            <Printer size={16} />
            Imprimir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Customers = () => {
  const notify = useToast();
  const [customers, setCustomers] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", tier_id: null, tiers: [] });
  const [exceptions, setExceptions] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [newPrice, setNewPrice] = useState(null);
  const [qrCustomer, setQrCustomer] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const searchRef = useRef(null);

  const loadCustomers = async (q = "") => {
    setLoading(true);
    try {
      const rows = q.trim()
        ? await window.api.invoke("search-customers", q)
        : await window.api.invoke("search-customers", "");
      setCustomers(rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.api.invoke("get-tiers").then(setTiers).catch(() => {});
    loadCustomers();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadCustomers(searchTerm), 250);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: "", phone: "", tier_id: null, tiers });
    setExceptions([]);
    setShowPicker(false);
    setNewPrice(null);
    setSheetOpen(true);
  };

  const openEdit = async (c) => {
    setEditItem(c);
    setForm({ name: c.name, phone: c.phone || "", tier_id: c.tier_id, tiers });
    setShowPicker(false);
    setNewPrice(null);
    setSheetOpen(true);
    try {
      const rows = await window.api.invoke("get-customer-prices", c.id);
      setExceptions(rows || []);
    } catch {
      setExceptions([]);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      notify("El nombre es requerido", "error");
      return;
    }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      tier_id: form.tier_id,
    };
    if (editItem) {
      const res = await window.api.invoke("update-customer", editItem.id, payload);
      if (!res.success) {
        notify(res.error || "No se pudo guardar", "error");
        return;
      }
      notify("Cliente actualizado", "success");
    } else {
      const res = await window.api.invoke("add-customer", payload);
      if (!res.success) {
        notify(res.error || "No se pudo crear", "error");
        return;
      }
      notify("Cliente creado", "success");
    }
    setSheetOpen(false);
    loadCustomers(searchTerm);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await window.api.invoke("delete-customer", deleteConfirm.id);
    setDeleteConfirm(null);
    notify("Cliente eliminado", "success");
    loadCustomers(searchTerm);
  };

  const pickProduct = async (p) => {
    setShowPicker(false);
    setNewPrice({ product: p, value: "" });
  };

  const saveException = async () => {
    if (!editItem || !newPrice) return;
    const price = parseFloat(newPrice.value);
    if (!(price > 0)) {
      notify("Precio inválido", "error");
      return;
    }
    const res = await window.api.invoke(
      "set-customer-price",
      editItem.id,
      newPrice.product.id,
      price,
    );
    if (res.success) {
      setExceptions(await window.api.invoke("get-customer-prices", editItem.id));
      setNewPrice(null);
      notify("Excepción guardada", "success");
    }
  };

  const removeException = async (row) => {
    await window.api.invoke("delete-customer-price", row.id);
    setExceptions(exceptions.filter((e) => e.id !== row.id));
  };

  const list = useMemo(() => customers, [customers]);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="p-1">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Gestiona tus clientes, niveles y precios especiales
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <PlusCircle className="h-4 w-4" />
          Nuevo Cliente
        </Button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar clientes..."
          className="h-10 pl-9"
          aria-label="Buscar clientes"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-transparent">
              <TableHead className="px-4 font-semibold text-foreground/75">
                Cliente
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Teléfono
              </TableHead>
              <TableHead className="px-4 font-semibold text-foreground/75">
                Nivel
              </TableHead>
              <TableHead className="w-32 px-4 text-right font-semibold text-foreground/75">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
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
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell className="px-4">
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Skeleton className="h-9 w-9 rounded-md" />
                      <Skeleton className="h-9 w-9 rounded-md" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            {!loading && list.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-28 px-4 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Users size={32} className="opacity-40" />
                    <p className="text-sm">
                      {searchTerm
                        ? "No se encontraron clientes"
                        : "No hay clientes registrados"}
                    </p>
                    {!searchTerm && (
                      <Button size="sm" onClick={openCreate}>
                        <PlusCircle className="h-4 w-4" />
                        Nuevo Cliente
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary"
                        aria-hidden
                      >
                        <Users size={18} />
                      </span>
                      <p className="truncate text-sm font-semibold text-foreground">
                        {c.name}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                    {c.phone || "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {c.tier_name ? (
                      <Badge className="px-2 py-0.5 text-[11px] font-bold">
                        {c.tier_name}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Normal</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setQrCustomer(c)}
                            aria-label={`QR de ${c.name}`}
                          >
                            <QrCode className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Ver QR</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(c)}
                            aria-label={`Editar ${c.name}`}
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
                            onClick={() => setDeleteConfirm(c)}
                            aria-label={`Eliminar ${c.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Eliminar</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="flex flex-col sm:max-w-md"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.target.closest("[data-radix-select-trigger]")
            ) {
              e.preventDefault();
              if (showPicker) return;
              if (newPrice) saveException();
              else handleSave();
            }
          }}
        >
          <SheetHeader className="flex flex-row items-center gap-2.5 border-b px-6 py-4 text-left">
            <UserPlus size={30} className="shrink-0" />
            <div className="min-w-0">
              <SheetTitle className="text-base">
                {editItem ? "Editar Cliente" : "Nuevo Cliente"}
              </SheetTitle>
              <SheetDescription>
                {editItem
                  ? "Modifica la información del cliente"
                  : "Ingresa la información del nuevo cliente"}
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-auto px-6 py-4">
            <CustomerForm value={form} onChange={setForm} />

            {editItem && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                    Precios especiales
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      setShowPicker(true);
                      setNewPrice(null);
                    }}
                  >
                    <PlusCircle size={14} />
                    Agregar
                  </Button>
                </div>

                {showPicker && (
                  <div className="mb-3">
                    <ProductPicker onPick={pickProduct} onClose={() => setShowPicker(false)} />
                  </div>
                )}

                {newPrice && (
                  <div className="mb-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
                    <p className="mb-2 truncate text-sm font-semibold text-foreground">
                      {newPrice.product.name}
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={newPrice.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "" || /^\d*\.?\d{0,2}$/.test(v))
                            setNewPrice({ ...newPrice, value: v });
                        }}
                        placeholder="0.00"
                        className="h-11 flex-1 text-base tabular-nums"
                        autoFocus
                      />
                      <Button
                        type="button"
                        className="h-11 bg-success px-4 text-white hover:bg-success/90"
                        onClick={saveException}
                      >
                        Guardar
                      </Button>
                    </div>
                  </div>
                )}

                {exceptions.length === 0 && !showPicker && !newPrice && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Sin precios especiales
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  {exceptions.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5"
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {e.product_name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-bold tabular-nums text-success">
                          ${Number(e.price).toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeException(e)}
                          title="Quitar excepción"
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim()}>
              {editItem ? "Actualizar" : "Crear"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {qrCustomer && (
        <QrDialog customer={qrCustomer} open onClose={() => setQrCustomer(null)} />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Eliminar cliente"
        description={`Se eliminará "${deleteConfirm?.name}" y sus precios especiales. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
      />
    </div>
    </TooltipProvider>
  );
};

export default Customers;
