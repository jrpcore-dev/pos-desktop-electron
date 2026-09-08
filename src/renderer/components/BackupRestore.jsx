import React, { useState, useEffect, useCallback } from "react";
import {
  ArchiveRestore,
  CalendarClock,
  Database,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CardSkeleton } from "./Skeletons";
import { ConfirmDialog } from "./ui/confirm";
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
} from "./ui";
import { cn } from "@/lib/utils";
import { formatMXDate, formatMXTime } from "../utils/dateUtils";

const BackupRestore = () => {
  const [backups, setBackups] = useState([]);
  const [restoreConfirm, setRestoreConfirm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    const result = await window.api.invoke("get-backups");
    setBackups(result);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  const createBackup = async () => {
    const result = await window.api.invoke("create-backup");
    if (result.success) {
      setMessage({ type: "success", text: `Respaldo creado: ${result.name} (${(result.size / 1024).toFixed(1)} KB)` });
      fetchBackups();
    } else {
      setMessage({ type: "error", text: result.error });
    }
  };

  const restoreBackup = async () => {
    if (!restoreConfirm) return;
    const result = await window.api.invoke("restore-backup", restoreConfirm.path);
    if (result.success) {
      setMessage({ type: "success", text: "Base de datos restaurada correctamente." });
      setRestoreConfirm(null);
      fetchBackups();
    } else {
      setMessage({ type: "error", text: result.error });
      setRestoreConfirm(null);
    }
  };

  const downloadBackup = async (b) => {
    const result = await window.api.invoke("download-backup", b.path);
    if (result.success) {
      setMessage({ type: "success", text: `Respaldo guardado en: ${result.path}` });
    } else if (!result.cancelled) {
      setMessage({ type: "error", text: result.error });
    }
  };

  const deleteBackup = async () => {
    if (!deleteConfirm) return;
    const result = await window.api.invoke("delete-backup", deleteConfirm.path);
    if (result.success) {
      setMessage({ type: "success", text: `Respaldo eliminado: ${deleteConfirm.name}` });
      setDeleteConfirm(null);
      fetchBackups();
    } else {
      setMessage({ type: "error", text: result.error });
      setDeleteConfirm(null);
    }
  };

  const importData = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const sel = await window.api.invoke("select-import-file");
      if (sel.cancelled) return;
      if (!sel.success) {
        setMessage({ type: "error", text: sel.error });
        return;
      }
      const result = await window.api.invoke("import-products-data", sel.path);
      if (result.success) {
        setImportResult(result);
      } else {
        setMessage({ type: "error", text: result.error });
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setImporting(false);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const totalSize = backups.reduce((acc, b) => acc + b.size, 0);
  const lastBackup = [...backups].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  const stats = [
    {
      label: "Total Respaldos",
      value: String(backups.length),
      icon: Database,
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      hover: "hover:border-amber-500/40",
    },
    {
      label: "Espacio Utilizado",
      value: totalSize ? formatSize(totalSize) : "0 B",
      icon: HardDrive,
      cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      hover: "hover:border-sky-500/40",
    },
    {
      label: "Último Respaldo",
      value: lastBackup ? formatMXDate(lastBackup.date) : "—",
      icon: CalendarClock,
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      hover: "hover:border-emerald-500/40",
    },
    {
      label: "Ubicación",
      value: "Documentos\\POSBackups",
      icon: FolderOpen,
      cls: "bg-primary/10 text-primary",
      hover: "hover:border-primary/40",
    },
  ];

  const iconAction = ({ icon: Icon, label, className, onSelect }) => (
    <TooltipProvider key={label}>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={className}
            onClick={onSelect}
            aria-label={label}
          >
            <Icon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div className="flex flex-col gap-4 p-1" style={{ animation: "fadeIn 0.4s ease-out" }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Respaldo y Restauración
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Crea, importa y administra copias de seguridad de la base de datos
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="warning"
            onClick={importData}
            disabled={importing}
          >
            <Upload size={16} />
            {importing ? "Importando..." : "Importar Datos"}
          </Button>
          <Button onClick={createBackup}>
            <DatabaseBackup size={16} />
            Crear Respaldo
          </Button>
        </div>
      </header>

      {message && (
        <div
          className={cnAlert(message.type)}
          role="alert"
        >
          <span className="basis-auto pt-0.5">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                message.type === "success" ? "bg-emerald-500" : "bg-destructive",
              )}
            />
          </span>
          <span className="min-w-0 flex-1 break-words text-sm">{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 cursor-pointer rounded-md p-1 opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <CardSkeleton count={4} />
      ) : (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${s.hover || ""}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                    {s.label}
                  </p>
                  <p className="mt-2 break-all font-mono text-sm font-semibold leading-tight text-foreground">
                    {s.value}
                  </p>
                </div>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.cls}`}>
                  <Icon size={18} />
                </span>
              </div>
            );
          })}
        </section>
      )}

      {loading && (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-5 w-44" />
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted/50">
                <TableHead>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
                <TableHead className="w-28 text-right">
                  <Skeleton className="ml-auto h-4 w-12" />
                </TableHead>
                <TableHead className="w-44">
                  <Skeleton className="h-4 w-16" />
                </TableHead>
                <TableHead className="w-40 text-center">
                  <Skeleton className="mx-auto h-4 w-14" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-b border-border">
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <Skeleton className="h-[15px] w-[15px] shrink-0 rounded" />
                      <Skeleton className="h-4 w-40" />
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-1 h-3 w-16" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {[0, 1, 2].map((b) => (
                        <Skeleton key={b} className="h-8 w-8 rounded-md" />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {!loading && backups.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Respaldos guardados
              <Badge variant="outline" className="ml-2 align-middle">
                {backups.length}
              </Badge>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border bg-muted/50">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-foreground/75">
                    Archivo
                  </TableHead>
                  <TableHead className="w-28 text-right text-xs font-semibold uppercase tracking-wide text-foreground/75">
                    Tamaño
                  </TableHead>
                  <TableHead className="w-44 text-xs font-semibold uppercase tracking-wide text-foreground/75">
                    Fecha
                  </TableHead>
                  <TableHead className="w-40 text-center text-xs font-semibold uppercase tracking-wide text-foreground/75">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((b) => (
                  <TableRow key={b.name} className="border-b border-border">
                    <TableCell className="font-mono text-[0.8rem] font-medium text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Database size={15} className="shrink-0 text-muted-foreground/60" />
                        <span className="break-all">{b.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="font-mono text-xs">
                        {formatSize(b.size)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="leading-tight text-foreground">{formatMXDate(b.date)}</div>
                      <div className="text-xs text-muted-foreground">{formatMXTime(b.date)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        {iconAction({
                          icon: Download,
                          label: "Descargar",
                          onSelect: () => downloadBackup(b),
                        })}
                        {iconAction({
                          icon: ArchiveRestore,
                          label: "Restaurar",
                          className: "text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400",
                          onSelect: () => setRestoreConfirm(b),
                        })}
                        {iconAction({
                          icon: Trash2,
                          label: "Eliminar",
                          className: "text-destructive hover:bg-destructive/10 hover:text-destructive",
                          onSelect: () => setDeleteConfirm(b),
                        })}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : (
        !loading && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-10 text-center shadow-sm">
            <Database size={28} className="text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No hay respaldos disponibles. Crea tu primer respaldo.
            </p>
            <Button onClick={createBackup} className="mt-1">
              <DatabaseBackup size={16} />
              Crear Respaldo Ahora
            </Button>
          </div>
        )
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        title="Eliminar Respaldo"
        description={
          <>
            ¿Eliminar el respaldo "{deleteConfirm?.name}"?
            <br /><br />
            Se quitará el archivo de la carpeta Documentos\POSBackups.
          </>
        }
        confirmLabel="Eliminar"
        variant="destructive"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={deleteBackup}
      />

      <ConfirmDialog
        open={!!restoreConfirm}
        onOpenChange={(v) => !v && setRestoreConfirm(null)}
        title="Restaurar Respaldo"
        iconColor="warning"
        confirmLabel="Restaurar"
        variant="warning"
        description={
          <>
            ¿Restaurar el respaldo "{restoreConfirm?.name}"?
            <br /><br />
            <strong>Advertencia:</strong> Esta acción reemplazará TODOS los datos actuales de la base de datos.
            Los datos existentes se perderán permanentemente. Se recomienda crear un respaldo antes de restaurar.
          </>
        }
        onCancel={() => setRestoreConfirm(null)}
        onConfirm={restoreBackup}
      />

      <Dialog open={!!importResult} onOpenChange={() => setImportResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importación completada</DialogTitle>
            <DialogDescription>
              Resultado del proceso de importación de productos.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">Productos importados</span>
              <strong>{importResult?.imported ?? 0}</strong>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Omitidos (duplicados o sin nombre)</span>
              <strong>{importResult?.skipped ?? 0}</strong>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Con errores</span>
              <strong>{importResult?.errors ?? 0}</strong>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Los productos con código de barras ya existente se omiten.
          </p>
          <DialogFooter>
            <Button variant="default" onClick={() => setImportResult(null)}>
              Aceptar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function cnAlert(type) {
  return type === "success"
    ? "flex w-full items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-700 dark:text-emerald-400"
    : "flex w-full items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive";
}

export default BackupRestore;