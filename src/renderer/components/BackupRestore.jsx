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

import PageHeader from "./PageHeader";

const BackupRestore = () => {
  const [backups, setBackups] = useState([]);
  const [restoreConfirm, setRestoreConfirm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  // Bloque 6 · durabilidad: copia externa, caja receptora y promoción.
  const [role, setRole] = useState("host");
  const [config, setConfig] = useState({
    externalDir: "",
    receiverDeviceId: "",
    received: [],
  });
  const [devices, setDevices] = useState([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([
        window.api.invoke("get-backup-config"),
        window.api.invoke("get-server-status"),
      ]);
      setRole(status?.role === "client" ? "client" : "host");
      if (cfg?.success) {
        setConfig({
          externalDir: cfg.externalDir || "",
          receiverDeviceId: cfg.receiverDeviceId || "",
          received: Array.isArray(cfg.received) ? cfg.received : [],
        });
      }
      const act = await window.api.invoke("get-activation-status");
      setDevices(
        (act?.devices || []).filter((d) => d.deviceType === "desktop_box"),
      );
    } catch (err) {}
  }, []);

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await window.api.invoke("save-backup-config", {
        externalDir: config.externalDir,
        receiverDeviceId: config.receiverDeviceId,
      });
      if (res?.success) {
        setMessage({ type: "success", text: "Configuración de respaldos guardada." });
        await fetchConfig();
      } else {
        setMessage({ type: "error", text: res?.error || "No se pudo guardar" });
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const pullNow = async () => {
    setPulling(true);
    try {
      const res = await window.api.invoke("pull-backup-now");
      if (res?.success) {
        setMessage({
          type: "success",
          text: res.skipped
            ? res.reason || "No hay respaldo nuevo"
            : `Respaldo recibido y verificado: ${res.name}`,
        });
        await fetchConfig();
      } else {
        setMessage({ type: "error", text: res?.error || "No se pudo recibir" });
      }
    } finally {
      setPulling(false);
    }
  };

  const promote = async () => {
    const latest = config.received?.[0];
    if (!latest) {
      setMessage({
        type: "error",
        text: "Primero recibe un respaldo del Host.",
      });
      return;
    }
    if (
      !window.confirm(
        "Convertir esta caja en el Host restaura el último respaldo recibido y reinicia la app. Se conservan el código de activación, la identidad del negocio y las cajas emparejadas. ¿Continuar?",
      )
    )
      return;
    setPromoting(true);
    try {
      const res = await window.api.invoke("promote-to-host", {
        backupPath: latest.path,
        confirm: true,
      });
      if (res?.success) {
        const queued = res.pendingAbsorbed
          ? ` Se registraron ${res.pendingAbsorbed} venta(s) que estaban pendientes en esta caja.`
          : "";
        const review = res.pendingKept
          ? ` ${res.pendingKept} venta(s) quedaron por revisar en la cola.`
          : "";
        setMessage({
          type: "success",
          text: `Promoción lista.${queued}${review} La app se reiniciará como Host…`,
        });
      } else {
        setMessage({ type: "error", text: res?.error || "No se pudo promover" });
        setPromoting(false);
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message });
      setPromoting(false);
    }
  };

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    const result = await window.api.invoke("get-backups");
    setBackups(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBackups();
    fetchConfig();
  }, [fetchBackups, fetchConfig]);

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
      // Bloque 5 · si esta PC es caja, el archivo se lee AQUÍ y sólo el
      // contenido viaja al Host. En el Host se conserva el camino de siempre.
      const status = await window.api.invoke("get-server-status");
      let result;
      if (status?.role === "client") {
        const file = await window.api.invoke("read-import-file", sel.path);
        if (!file.success) {
          setMessage({ type: "error", text: file.error });
          return;
        }
        result = await window.api.invoke("import-products-content", {
          filename: file.fileName,
          contentBase64: file.contentBase64,
        });
      } else {
        result = await window.api.invoke("import-products-data", sel.path);
      }
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
      <PageHeader
        description="Crea, importa y administra copias de seguridad de la base de datos"
        actions={
          <>
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
          </>
        }
      />

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
                  <p className="mt-2 break-all text-sm font-semibold leading-tight text-foreground">
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

      {/* Bloque 6 · durabilidad: copia externa, caja designada y promoción */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Durabilidad</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Respaldos cada 15 min, al cerrar caja y diarios. Se conservan 24
              copias recientes y 8 diarias. Una copia viaja a la caja designada
              y, si configuras una carpeta externa, también se guarda ahí.
            </p>
          </div>
          <Badge variant={role === "client" ? "secondary" : "default"}>
            {role === "client" ? "Esta PC es caja" : "Esta PC es el Host"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-foreground">
              Carpeta externa (opcional)
            </span>
            <input
              type="text"
              value={config.externalDir}
              onChange={(e) =>
                setConfig((c) => ({ ...c, externalDir: e.target.value }))
              }
              placeholder="Ej. D:\\RespaldosVendia"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          {role === "host" && (
            <label className="block">
              <span className="text-xs font-medium text-foreground">
                Caja designada para recibir respaldos
              </span>
              <select
                value={config.receiverDeviceId}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, receiverDeviceId: e.target.value }))
                }
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Ninguna</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {(d.deviceCode || d.deviceName || d.deviceId) +
                      (d.deviceName && d.deviceCode ? ` · ${d.deviceName}` : "")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={saveConfig} disabled={savingConfig}>
            {savingConfig ? "Guardando…" : "Guardar configuración"}
          </Button>
          {role === "client" && (
            <>
              <Button size="sm" variant="secondary" onClick={pullNow} disabled={pulling}>
                {pulling ? "Buscando…" : "Buscar respaldo ahora"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={promote}
                disabled={promoting || !config.received?.length}
                title="Restaura el último respaldo recibido y convierte esta caja en Host"
              >
                {promoting ? "Promoviendo…" : "Promover esta caja a Host"}
              </Button>
            </>
          )}
        </div>

        {config.received?.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Respaldos recibidos
            </p>
            <ul className="mt-2 space-y-1.5">
              {config.received.slice(0, 8).map((r) => (
                <li
                  key={r.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="text-muted-foreground">
                    {formatMXDate(r.date)} {formatMXTime(r.date)}
                    {r.sha256 ? ` · sha256 ${r.sha256.slice(0, 12)}…` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

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
                    <TableCell className="text-[0.8rem] font-medium text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Database size={15} className="shrink-0 text-muted-foreground/60" />
                        <span className="break-all">{b.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="text-xs">
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


