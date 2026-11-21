import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useDbChanges } from "../lib/useDbChanges";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CircleCheck,
  CreditCard,
  Download,
  Info,
  Landmark,
  HandCoins,
  Minus,
  PackagePlus,
  PackageX,
  Plus,
  Printer,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  TriangleAlert,
  Truck,
  Wallet,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { fmtMoney, fmtMoneyAbs, fmtMoneySigned } from "@/utils/format";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBrandFooter,
  DialogBrandHeader,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetBrandHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui";
import { StatCard } from "./ui/stat-card";

import CancelButton from "./CancelButton";
import OpenRegisterCard from "./OpenRegisterCard";
import { CardSkeleton } from "./Skeletons";

import {
  formatMXDateTime,
  formatMXTime,
  mxToday,
  toUTC,
} from "../utils/dateUtils";

import { useCashier } from "../contexts/CashierContext";

import { loadPdfToolchain } from "@/utils/pdfToolchain";
import { printDocument } from "../utils/printPdf";


const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
    {children}
  </span>
);

const methodLabels = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  credit: "Fiado",
};

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const fmtKg = (n) => String(round3(n));

// Cantidad de un producto en un texto corto: kilo con su unidad (gramos si es
// menos de 1 kg), piezas con "x2" sólo si es más de una.
const qtyLabel = (p) => {
  const q = round3(p?.qty);
  if (p?.weight) return q < 1 ? ` ${Math.round(q * 1000)} g` : ` ${fmtKg(q)} kg`;
  return q > 1 ? ` x${q}` : "";
};

// Devolución parcial: lo escrito en el cuadro se guarda tal cual (se puede
// borrar todo y volver a escribir) y sólo se valida al confirmar.
const cleanQtyText = (raw, isWeight) => {
  const t = String(raw ?? "").replace(",", ".");
  if (!isWeight) return t.replace(/\D/g, "").slice(0, 6);
  const [int = "", ...rest] = t.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${int.slice(0, 5)}.${rest.join("").slice(0, 3)}` : int.slice(0, 5);
};
const cancelQtyError = (d) => {
  if (!d) return null;
  const q = d.qty;
  if (!Number.isFinite(q) || q <= 0) return d.isWeightItem ? "Escribe cuántos kg" : "Escribe cuántas unidades";
  if (q > d.itemQty + 1e-9) {
    return `Máximo ${d.isWeightItem ? `${fmtKg(d.itemQty)} kg` : d.itemQty}`;
  }
  if (!d.isWeightItem && !Number.isInteger(q)) return "Sólo unidades completas";
  return null;
};
// Motivo opcional de la devolución (va a la nota del movimiento de stock).
const CANCEL_REASONS = ["Error al cobrar", "Producto dañado", "El cliente no lo quiso", "Otro"];
// Cambia la cantidad desde los botones (− + "1" "todas"): el cuadro la muestra.
const withQty = (p, qty) => (p ? { ...p, qty, qtyText: undefined } : p);

// Error mostrado DENTRO del modal abierto: el aviso de la página queda
// detrás del modal y no se ve.
const ModalError = ({ text, onClose }) =>
  text ? (
    <Alert
      variant="destructive"
      className="flex items-center gap-3 border-red-500/30 bg-[rgba(239,68,68,.12)] py-2.5 pr-2 [&>svg]:static! [&>svg]:shrink-0 [&>svg~*]:pl-0! [&>svg+div]:translate-y-0!"
    >
      <TriangleAlert size={18} />
      <AlertDescription className="min-w-0 flex-1 font-semibold leading-snug">
        {text}
      </AlertDescription>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={onClose}
        className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
      >
        <X size={15} />
      </button>
    </Alert>
  ) : null;

const purchaseParts = (expense) => {
  const raw = String(expense.reason || "")
    .replace(/^Compra de inventario:\s*/, "")
    .replace(/^Compra de\s+/, "");
  const [name, supplier] = raw.split(" — ");
  return { name: (name || "").trim(), supplier: (supplier || "").trim() };
};
const purchaseName = (expense) => purchaseParts(expense).name || null;
// Debajo del nombre: "24 piezas · FEMSA".
const purchaseDetail = (expense) => {
  const { supplier } = purchaseParts(expense);
  const qty = Number(expense.quantity || 0);
  return [qty > 0 ? `${qty} ${qty === 1 ? "pieza" : "piezas"}` : null, supplier]
    .filter(Boolean)
    .join(" · ");
};

const TurnoRow = memo(function TurnoRow({
  item,
  idx,
  selected,
  canManageRegister,
  onSelect,
  onDetail,
  onRequestCancelExpense,
}) {
  const isCancelled = item.status === "cancelado";
  const isSale = item.type === "sale";
  // Entrada de dinero: suma como ingreso, pero se cancela como un gasto.
  const isInflow = isSale || item.type === "cash_in";
  // Mismo diseño Ingreso/Egreso; el ícono dice qué movimiento es.
  const TypeIcon = isSale
    ? ShoppingCart
    : item.type === "cash_in"
      ? ArrowUpRight
      : item.subtype === "supplier"
        ? Truck
        : item.subtype === "purchase"
          ? PackagePlus
          : ArrowDownRight;
  const typeLabel = isSale
    ? "Venta"
    : item.type === "cash_in"
      ? "Entrada"
      : item.subtype === "supplier"
        ? "Pago de mercancía"
        : item.subtype === "purchase"
          ? "Compra"
          : "Salida";
  const canCancel = isSale ? !isCancelled && !item.pending : true;

  return (
    <TableRow
      data-turno-idx={idx}
      onClick={() => onSelect(idx)}
      className={cn(
        "group cursor-pointer",
        isCancelled && "opacity-70",
        selected &&
          "bg-blue-100/70 hover:bg-blue-100/70 dark:bg-blue-500/15 dark:hover:bg-blue-500/15",
      )}
    >
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {formatMXTime(item.time)}
      </TableCell>

      <TableCell>
        <p
          className={cn(
            "text-sm font-semibold",
            isCancelled && "text-muted-foreground line-through",
          )}
        >
          {item.title}
        </p>

        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {isCancelled && (
            <span className="rounded-md bg-destructive/10 px-1.5 py-px text-[11px] font-bold text-destructive">
              Cancelada
            </span>
          )}
          {item.pending && (
            <span className="rounded-md bg-warning/15 px-1.5 py-px text-[11px] font-semibold text-foreground">
              {item.pending === "conflict" ? "En revisión" : "Por subir"}
            </span>
          )}
        </div>

        {item.desc && (
          <p className="max-w-[480px] truncate text-xs text-muted-foreground">
            {item.desc}
          </p>
        )}
      </TableCell>

      <TableCell>
        <Badge variant={isInflow ? "soft-success" : "soft-destructive"}>
          <TypeIcon />
          {typeLabel}
        </Badge>
      </TableCell>

      <TableCell
        className={cn(
          "whitespace-nowrap text-right font-bold tabular-nums",
          isCancelled
            ? "text-muted-foreground line-through"
            : isInflow
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive",
        )}
      >
        {isInflow ? "+" : "-"}
        {fmtMoneyAbs(item.amount)}
      </TableCell>

      {canManageRegister && (
        <TableCell
          className={cn(
            "whitespace-nowrap text-center transition-opacity",
            // Cancelar solo aparece en la fila elegida o al pasar el mouse.
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          {isSale && canCancel && (
            <CancelButton
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDetail(item);
              }}
            >
              Cancelar
            </CancelButton>
          )}

          {!isSale && canCancel && (
            <CancelButton
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onRequestCancelExpense(item);
              }}
            >
              Cancelar
            </CancelButton>
          )}
        </TableCell>
      )}
    </TableRow>
  );
});

const EndOfDay = () => {
  const { cashier } = useCashier();

  const [sales, setSales] = useState([]);
  const [totalSales, setTotalSales] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [register, setRegister] = useState(null);
  const [prevRegister, setPrevRegister] = useState(null);

  const [openRegisterModal, setOpenRegisterModal] = useState(false);
  const [closeRegisterModal, setCloseRegisterModal] = useState(false);
  const [servicePending, setServicePending] = useState(null);

  const [openingBalance, setOpeningBalance] = useState("");
  const [declaredClose, setDeclaredClose] = useState("");
  const [expenses, setExpenses] = useState("");
  const [registerName, setRegisterName] = useState("");

  const [registerMessage, setRegisterMessage] = useState(null);
  // Error del modal abierto (abrir/cerrar caja, entrada/salida, detalle de venta).
  const [modalError, setModalError] = useState(null);

  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  // Abrir/cerrar caja: spinner y candado contra el doble envío (Enter repetido
  // o doble clic mientras el Host contesta).
  const [openLoading, setOpenLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  // El mismo diálogo registra salidas ("out") y entradas ("in") de dinero.
  const [moneyMode, setMoneyMode] = useState("out");
  const isMoneyIn = moneyMode === "in";
  // Tipo de salida: "supplier" (pago a proveedor/mercancía) u "other" (otro
  // gasto). Se recuerda el último usado en esta caja.
  const [cashOutCategory, setCashOutCategory] = useState(() => {
    try {
      return localStorage.getItem("cashOutCategory") === "other" ? "other" : "supplier";
    } catch {
      return "supplier";
    }
  });
  const isSupplierPay = !isMoneyIn && cashOutCategory === "supplier";
  // Sugerencias de producto/proveedor: ayudan a escribir, nunca obligan.
  const [reasonSuggestions, setReasonSuggestions] = useState([]);
  const [suggestIdx, setSuggestIdx] = useState(-1);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suppliersRef = useRef(null);

  const [expensesList, setExpensesList] = useState([]);

  const [turnoFilter, setTurnoFilter] = useState("todos");
  const [selectedTurnoIdx, setSelectedTurnoIdx] = useState(-1);
  const turnoTableRef = useRef(null);

  const [cancelSaleData, setCancelSaleData] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const [saleDetailData, setSaleDetailData] = useState(null);
  const [cancelItemData, setCancelItemData] = useState(null);
  const [cancelItemLoading, setCancelItemLoading] = useState(false);

  const [cancelExpenseData, setCancelExpenseData] = useState(null);
  const [cancelExpenseLoading, setCancelExpenseLoading] = useState(false);

  const [outsideSales, setOutsideSales] = useState([]);
  const [outsideDialogOpen, setOutsideDialogOpen] = useState(false);

  const [turnoSearch, setTurnoSearch] = useState("");
  const turnoSearchRef = useRef(null);

  // `silent` → refresco vivo sin skeleton (reglas 1 y 5).
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);

    try {
      const regResult = await window.api.invoke("get-cash-register-status", {
        cashierId: cashier?.id,
        role: cashier?.role,
      });

      const reg = regResult.success ? regResult.register : null;
      setRegister(reg);

      const isOpenReg = reg?.status === "open";

      const [salesResult, outsideResult, prevResult, expResult] =
        await Promise.all([
          window.api.invoke("get-sales-for-today", {
            date: mxToday(),
            registerId: reg?.id || null,
          }),
          isOpenReg
            ? Promise.resolve({ success: true, sales: [] })
            : window.api.invoke("get-outside-register-sales"),
          isOpenReg
            ? Promise.resolve({ success: true, register: null })
            : window.api.invoke("get-previous-register-today"),
          isOpenReg
            ? window.api.invoke("get-cash-register-expenses", {
                cashierId: cashier?.id,
                role: cashier?.role,
              })
            : Promise.resolve({ success: true, expenses: [] }),
        ]);

      if (salesResult.success) {
        const fetchedSales = salesResult.sales || [];

        setSales(fetchedSales);

        const active = fetchedSales.filter(
          (sale) => sale.status !== "cancelado",
        );

        const total = active.reduce(
          (sum, sale) => sum + Number(sale.total || 0),
          0,
        );

        setTotalSales(total);
        setSalesCount(active.length);
      } else {
        // Antes esto fallaba en silencio: si el backend regresaba
        // success:false (p.ej. no encontró el registerId, error de query,
        // etc.) la pantalla se quedaba en $0.00 sin avisar nada.
        setSales([]);
        setTotalSales(0);
        setSalesCount(0);

        setRegisterMessage({
          type: "error",
          text:
            "No se pudieron cargar las ventas: " +
            (salesResult.error || "respuesta vacía del backend"),
        });
      }

      setOutsideSales(outsideResult.success ? outsideResult.sales || [] : []);

      setPrevRegister(prevResult.success ? prevResult.register : null);

      if (expResult.success) {
        setExpensesList(expResult.expenses || []);
      }
    } catch (error) {
      console.error("[EOD] Error loading data:", error);

      setRegisterMessage({
        type: "error",
        text: "No se pudo cargar la información de caja.",
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cashier?.id, cashier?.role]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // In vivo: un cierre/apertura de caja (también el del encabezado) refresca
  // el corte sola. Eventos raros → refresco directo y silencioso, sin chip.
  useDbChanges(() => fetchData(true), ["cash_register", "sales", "cash_register_expenses"]);

  useEffect(() => {
    const handleSaleRegistered = () => fetchData();
    window.addEventListener("sale-registered", handleSaleRegistered);
    return () =>
      window.removeEventListener("sale-registered", handleSaleRegistered);
  }, [fetchData]);

  // Un solo pase O(n) sobre las ventas para los 3 métodos de pago
  // (antes eran 3 useMemo que filtraban la lista completa por cada render).
  // Fiado: lo que pagó al momento suma a su método; la parte fiada va en
  // su propia línea y NO entra al cajón (igual que en el backend).
  const { totalCash, totalCard, totalTransfer, totalCredit } = useMemo(() => {
    let cash = 0;
    let card = 0;
    let transfer = 0;
    let creditPart = 0;

    for (const sale of sales) {
      if (sale.status === "cancelado") continue;

      const amount = Number(sale.total || 0);

      if (sale.payment_method === "cash") cash += amount;
      else if (sale.payment_method === "card") card += amount;
      else if (sale.payment_method === "transfer") transfer += amount;
      else if (sale.payment_method === "credit") {
        creditPart += Number(sale.credit_amount || 0);
        const paid = Number(sale.credit_paid || 0);
        if (sale.credit_paid_method === "cash") cash += paid;
        else if (sale.credit_paid_method === "card") card += paid;
        else if (sale.credit_paid_method === "transfer") transfer += paid;
      }
    }

    return {
      totalCash: cash,
      totalCard: card,
      totalTransfer: transfer,
      totalCredit: creditPart,
    };
  }, [sales]);

  // Cobranza de fiado (abonos desde Clientes) de esta caja, por método. La
  // de efectivo entra al cierre esperado.
  const collectedCash = Number(register?.credit?.collected?.cash || 0);
  const collectedOther =
    Number(register?.credit?.collected?.card || 0) +
    Number(register?.credit?.collected?.transfer || 0);

  const totalExpenses = useMemo(
    () =>
      expensesList.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0,
      ),
    [expensesList],
  );

  const isOpen = register?.status === "open";

  const isAdmin = cashier?.role === "admin";

  const canManageRegister = useMemo(() => {
    if (!isOpen || !register) return false;

    const openerIsAdmin = register.opener_role === "admin";

    const isOwn =
      String(register.opened_by) === String(cashier?.id) ||
      String(register.cashier_id) === String(cashier?.id);

    return isOwn || openerIsAdmin || cashier?.role === "admin";
  }, [isOpen, register, cashier?.id, cashier?.role]);

  // El "cierre esperado" es efectivo FÍSICO: apertura + ventas en EFECTIVO
  // (no todas las ventas, tarjeta/transferencia nunca entran al cajón) - gastos.
  const expectedClose = useMemo(() => {
    if (!register) return 0;

    return (
      Number(register.opening_balance || 0) +
      totalCash +
      collectedCash +
      Number(register.cash_in || 0) -
      Number(register.expenses || 0)
    );
  }, [register, totalCash, collectedCash]);

  const cashInRegister = expectedClose;

  const handleOpenRegister = async () => {
    if (openLoading) return;
    setOpenLoading(true);
    let result;
    try {
      result = await window.api.invoke("open-cash-register", {
        openingBalance: parseFloat(openingBalance) || 0,
        cashierId: cashier?.id,
        role: cashier?.role,
      });
    } catch (e) {
      result = { success: false, error: e?.message || "No se pudo abrir la caja" };
    } finally {
      setOpenLoading(false);
    }

    if (result?.success) {
      setOpenRegisterModal(false);
      setOpeningBalance("");

      await fetchData();

      setRegisterMessage({
        type: "success",
        text: "Caja abierta exitosamente.",
      });
    } else {
      // Se relee el estado real: la pantalla nunca se queda con una caja
      // distinta de la que tiene el Host.
      await fetchData();
      setModalError(result?.error || "No se pudo abrir la caja.");
    }
  };

  // Los avisos de éxito e informativos se quitan solos; los errores y las
  // advertencias se quedan hasta que el cajero los cierra.
  useEffect(() => {
    if (!registerMessage) return;
    if (registerMessage.type !== "success" && registerMessage.type !== "info") return;
    const t = setTimeout(() => setRegisterMessage(null), 5000);
    return () => clearTimeout(t);
  }, [registerMessage]);

  // Sugerencias del campo Producto / proveedor (solo en Pago a proveedor).
  useEffect(() => {
    if (!withdrawDialogOpen || !isSupplierPay) {
      setReasonSuggestions([]);
      return;
    }
    const q = withdrawReason.trim().toLowerCase();
    if (q.length < 2) {
      setReasonSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!suppliersRef.current) {
        try {
          const rows = await window.api.invoke("get-suppliers");
          suppliersRef.current = Array.isArray(rows) ? rows.map((r) => r.name).filter(Boolean) : [];
        } catch {
          suppliersRef.current = [];
        }
      }
      let products = [];
      try {
        const rows = await window.api.invoke("search-products", q);
        products = Array.isArray(rows) ? rows.slice(0, 5).map((p) => p.name) : [];
      } catch {
        products = [];
      }
      if (cancelled) return;
      const past = expensesList
        .filter((e) => e.category === "supplier" && e.reason)
        .map((e) => e.reason);
      const seen = new Set();
      const list = [];
      const add = (label, kind) => {
        const key = String(label).toLowerCase();
        if (!label || seen.has(key) || key === q) return;
        if (kind !== "Producto" && !key.includes(q)) return;
        seen.add(key);
        list.push({ label, kind });
      };
      suppliersRef.current.forEach((n) => add(n, "Proveedor"));
      past.forEach((n) => add(n, "Usado antes"));
      products.forEach((n) => add(n, "Producto"));
      setReasonSuggestions(list.slice(0, 7));
      setSuggestIdx(-1);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [withdrawReason, withdrawDialogOpen, isSupplierPay, expensesList]);

  // Un modal nuevo (o uno que se cierra) no arrastra el error del anterior.
  useEffect(() => {
    setModalError(null);
  }, [openRegisterModal, closeRegisterModal, withdrawDialogOpen, saleDetailData]);

  useEffect(() => {
    setServicePending(null);
  }, [closeRegisterModal, register?.id]);

  const handleCloseRegister = async (confirmServicePending = false) => {
    if (closeLoading) return;
    setModalError(null);
    setCloseLoading(true);
    let result;
    try {
      result = await window.api.invoke("close-cash-register", {
        declaredClose: parseFloat(declaredClose) || 0,

        expenses: parseFloat(expenses) || 0,

        name: registerName.trim() || register?.opener_name || "Cierre sin nombre",

        cashierId: cashier?.id,
        role: cashier?.role,
        registerId: register?.id,
        confirmServicePending,
      });
    } catch (e) {
      result = { success: false, error: e?.message || "No se pudo cerrar la caja" };
    } finally {
      setCloseLoading(false);
    }

    if (result?.success) {
      setCloseRegisterModal(false);
      setRegisterName("");
      setDeclaredClose("");
      setExpenses("");

      await fetchData();

      setRegisterMessage({
        type: "success",
        text:
          `Caja cerrada. Esperado: ${fmtMoney(result.expectedClose)}, ` +
          `Diferencia: ${fmtMoney(result.difference)}`,
      });
    } else if (result?.code === "SERVICE_PENDING") {
      setServicePending(result.pending);
    } else {
      await fetchData();
      setModalError(result?.error || "No se pudo cerrar la caja.");
    }
  };

  const handleRegisterExpense = async () => {
    const amount = parseFloat(withdrawAmount);

    if (!amount || amount <= 0) {
      setModalError("Ingresa un monto válido.");
      return;
    }

    // Salida: el motivo es obligatorio (es por donde se pierde el dinero).
    // Entrada: si no lo ponen, se guarda como "Sin motivo".
    const motive = withdrawReason.trim() || (isMoneyIn ? "Sin motivo" : "");
    if (!motive) {
      setModalError(
        isSupplierPay ? "Escribe el producto o el proveedor." : "Ingresa el motivo.",
      );
      return;
    }

    if (withdrawLoading) return;
    setWithdrawLoading(true);

    try {
      const payload = {
        amount,
        reason: motive,
        category: isSupplierPay ? "supplier" : undefined,
        cashierId: cashier?.id,
        role: cashier?.role,
      };
      const result = isMoneyIn
        ? await window.api.invoke("register-cash-income", payload)
        : await window.api.invoke("register-cash-expense", payload);

      if (result.success) {
        setWithdrawDialogOpen(false);
        setWithdrawAmount("");
        setWithdrawReason("");

        await fetchData();

        window.api
          .invoke("open-cash-drawer")
          .catch((error) => console.error("[DRAWER]", error));

        setRegisterMessage({
          type: "success",
          text:
            (isMoneyIn
              ? `Entrada de ${fmtMoney(amount)} registrada: `
              : isSupplierPay
                ? `Pago de mercancía de ${fmtMoney(amount)} registrado: `
                : `Salida de ${fmtMoney(amount)} registrada: `) + motive,
        });
      } else {
        await fetchData();
        setModalError(result.error || "No se pudo registrar.");
      }
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleCancelSale = async () => {
    if (!cancelSaleData) return;

    setCancelLoading(true);

    try {
      const result = await window.api.invoke("cancel-sale", {
        saleId: cancelSaleData.id,
        cashierName: cashier?.name,
        role: cashier?.role,
        cashierId: cashier?.id,
      });

      const saleId = cancelSaleData.id;

      setCancelSaleData(null);

      if (result.success) {
        await fetchData();

        setRegisterMessage({
          type: "success",
          text: `Venta #${saleId} cancelada. ` + "Se revirtió el stock.",
        });
      } else {
        setRegisterMessage({
          type: "error",
          text: result.error,
        });
      }
    } finally {
      setCancelLoading(false);
    }
  };

  const handleCancelSaleDirect = async (saleId) => {
    if (!saleId) return;

    setCancelLoading(true);

    try {
      const result = await window.api.invoke("cancel-sale", {
        saleId,
        cashierName: cashier?.name,
        role: cashier?.role,
        cashierId: cashier?.id,
      });

      setCancelItemData(null);
      setSaleDetailData(null);

      if (result.success) {
        await fetchData();

        setRegisterMessage({
          type: "success",
          text: `Venta #${saleId} cancelada. ` + "Se revirtió el stock.",
        });
      } else {
        setRegisterMessage({
          type: "error",
          text: result.error,
        });
      }
    } finally {
      setCancelLoading(false);
    }
  };

  const handleCancelSaleItem = async () => {
    if (!cancelItemData) return;
    if (cancelQtyError(cancelItemData)) return;

    setCancelItemLoading(true);

    try {
      const result = await window.api.invoke("cancel-sale-item", {
        saleId: cancelItemData.saleId,
        itemId: cancelItemData.itemId,
        quantity: cancelItemData.qty,
        reason: cancelItemData.reason || "",
        cashierName: cashier?.name,
        role: cashier?.role,
        cashierId: cashier?.id,
      });

      const { itemName, isWeightItem } = cancelItemData;

      setCancelItemData(null);

      if (result.success) {
        await fetchData();

        if (result.saleCancelled) {
          setSaleDetailData(null);
        }

        const refundText = fmtMoneyAbs(result.refundAmount);
        const cancelledQty = result.cancelledQty;
        const qtyText = isWeightItem
          ? fmtKg(cancelledQty)
          : String(Math.round(cancelledQty));
        const isOne = cancelledQty === 1;
        const unit = isWeightItem ? "kg" : isOne ? "unidad" : "unidades";
        const verb = isOne ? "canceló" : "cancelaron";

        setRegisterMessage({
          type: "success",
          text: result.saleCancelled
            ? `Venta #${cancelItemData.saleId} cancelada por completo.`
            : result.isPartial
              ? `Se ${verb} ${qtyText} ${unit} de "${itemName}" (−${refundText}). El resto sigue en la venta.`
              : `"${itemName}" cancelado (−${refundText}). Se revirtió el stock.`,
        });
      } else {
        setModalError(result.error || "No se pudo cancelar el artículo.");
      }
    } finally {
      setCancelItemLoading(false);
    }
  };

  const handleCancelExpense = async () => {
    if (!cancelExpenseData) return;

    setCancelExpenseLoading(true);

    try {
      const result = await window.api.invoke("delete-cash-expense", {
        expenseId: cancelExpenseData.id,
        cashierId: cashier?.id,
        role: cashier?.role,
      });

      setCancelExpenseData(null);

      if (result.success) {
        await fetchData();

        setRegisterMessage({
          type: "success",
          text: cancelExpenseData?.isCashIn
            ? "Entrada cancelada correctamente."
            : "Gasto cancelado correctamente.",
        });
      } else {
        setRegisterMessage({
          type: "error",
          text: result.error,
        });
      }
    } finally {
      setCancelExpenseLoading(false);
    }
  };

  const buildDailyPDF = async () => {
    const store = await window.api.invoke("get-setting", "store_name");

    const storeName = store || "MI TIENDA POS";

    const { jsPDF, interFontInline } = await loadPdfToolchain();
    const doc = new jsPDF();

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const margin = 18;

    // ── FUENTE INTER (embebida desde asset del proyecto) ──
    let fontName = "helvetica";
    if (typeof interFontInline === "string" && interFontInline.includes(",")) {
      try {
        const b64 = interFontInline.split(",")[1];
        doc.addFileToVFS("Inter.ttf", b64);
        doc.addFont("Inter.ttf", "Inter", "normal");
        doc.addFont("Inter.ttf", "Inter", "bold");
        doc.setFont("Inter", "normal");
        fontName = "Inter";
      } catch (e) {
        fontName = "helvetica";
      }
    }

    // ── PALETA PROFESIONAL (neutros + acento de marca) ──
    const C = {
      ink: [15, 23, 42],
      body: [51, 65, 85],
      muted: [100, 116, 139],
      line: [226, 232, 240],
      grid: [148, 163, 184],
      head: [241, 245, 249],
      band: [248, 250, 252],
      brand: [30, 64, 175],
      white: [255, 255, 255],
    };

    // ── ENCABEZADO (nombre de tienda centrado) ──────────
    doc.setFontSize(18);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);

    doc.text(storeName.toUpperCase(), pageW / 2, 22, { align: "center" });

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...C.muted);

    doc.text(
      `Reporte Diario — ${new Date().toLocaleDateString("es-MX")}`,
      pageW / 2,
      29,
      { align: "center" },
    );

    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.8);

    doc.line(margin, 33, pageW - margin, 33);

    // ── FRANJA DE RESUMEN FINAL (GANANCIA DESTACADA) ────
    const bandLeft = margin;
    const bandRight = pageW - margin;
    const bandW = bandRight - bandLeft;
    const bandY = 40;
    const showRegister = !!register;

    const gainBaseline = bandY + 33;
    const bandBottom = showRegister ? bandY + 61 : bandY + 41;

    doc.setFillColor(...C.band);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.roundedRect(bandLeft, bandY, bandW, bandBottom - bandY, 1.2, 1.2, "FD");

    doc.setFontSize(9.5);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.muted);
    doc.text("RESUMEN FINAL", bandLeft + 4, bandY + 8);

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...C.body);
    doc.text("Ventas Totales", bandLeft + 4, bandY + 17);
    doc.text(fmtMoney(totalSales), bandRight - 4, bandY + 17, {
      align: "right",
    });
    doc.text("Total Gastos", bandLeft + 4, bandY + 23.5);
    doc.text(`-${fmtMoneyAbs(totalExpenses)}`, bandRight - 4, bandY + 23.5, {
      align: "right",
    });

    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.4);
    doc.line(bandLeft + 4, gainBaseline - 7, bandRight - 4, gainBaseline - 7);
    doc.setFillColor(...C.white);
    doc.rect(bandLeft + 4, gainBaseline - 7, bandW - 8, 12.5, "F");
    doc.setTextColor(...C.ink);
    doc.setFontSize(11);
    doc.text("GANANCIA DEL DÍA", bandLeft + 8, gainBaseline);
    doc.setTextColor(...C.brand);
    doc.setFontSize(17);
    doc.text(
      fmtMoney(totalSales - totalExpenses),
      bandRight - 8,
      gainBaseline + 0.5,
      { align: "right" },
    );

    if (showRegister) {
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text("Apertura de caja", bandLeft + 4, bandY + 44.5);
      doc.text(
        fmtMoney(register.opening_balance),
        bandRight - 4,
        bandY + 44.5,
        { align: "right" },
      );
      doc.text("Efectivo en caja", bandLeft + 4, bandY + 50.5);
      doc.text(fmtMoney(cashInRegister), bandRight - 4, bandY + 50.5, {
        align: "right",
      });
      doc.text("Cierre esperado", bandLeft + 4, bandY + 56.5);
      doc.text(fmtMoney(expectedClose), bandRight - 4, bandY + 56.5, {
        align: "right",
      });
    }

    // ── VENTAS DEL DÍA ──────────────────────────────────
    let yy = bandBottom + 10;
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);

    doc.text("VENTAS DEL DÍA", margin, yy);

    const saleRows = sales
      .filter((sale) => sale.status !== "cancelado")
      .map((sale, index) => [
        index + 1,
        formatMXTime(sale.created_at),
        sale.payment_method === "cash"
          ? "Efectivo"
          : sale.payment_method === "card"
            ? "Tarjeta"
            : "Transferencia",
        fmtMoney(sale.total),
      ]);

    doc.autoTable({
      head: [["#", "Hora", "Método", "Total"]],
      body: saleRows,

      startY: yy + 4,

      margin: {
        left: margin,
        right: margin,
      },

      styles: {
        font: fontName,
        fontSize: 9,
        cellPadding: 3,
        textColor: C.body,
        lineColor: C.grid,
        lineWidth: 0.4,
      },

      headStyles: {
        fillColor: C.head,
        textColor: C.ink,
        fontStyle: "bold",
      },

      footStyles: {
        fillColor: C.head,
        textColor: C.ink,
        fontStyle: "bold",
      },

      columnStyles: {
        0: { halign: "center" },
        3: { halign: "right" },
      },

      foot: [
        [
          {
            content: "TOTAL VENTAS",
            colSpan: 3,
            styles: {
              fontStyle: "bold",
              halign: "right",
            },
          },
          fmtMoney(totalSales),
        ],
      ],
    });

    yy = doc.lastAutoTable.finalY + 8;

    if (expensesList.length > 0) {
      doc.setFontSize(12);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);

      doc.text("GASTOS / EGRESOS", margin, yy);

      yy += 4;

      const expRows = expensesList.map((expense, index) => [
        index + 1,
        formatMXTime(expense.created_at),
        expense.reason,
        fmtMoney(expense.amount),
      ]);

      doc.autoTable({
        head: [["#", "Hora", "Motivo", "Monto"]],

        body: expRows,

        startY: yy,

        margin: {
          left: margin,
          right: margin,
        },

        styles: {
          font: fontName,
          fontSize: 9,
          cellPadding: 3,
          textColor: C.body,
          lineColor: C.grid,
          lineWidth: 0.4,
        },

        headStyles: {
          fillColor: C.head,
          textColor: C.ink,
          fontStyle: "bold",
        },

        footStyles: {
          fillColor: C.head,
          textColor: C.ink,
          fontStyle: "bold",
        },

        columnStyles: {
          0: { halign: "center" },
          3: { halign: "right" },
        },

        foot: [
          [
            {
              content: "TOTAL GASTOS",
              colSpan: 3,
              styles: {
                fontStyle: "bold",
                halign: "right",
              },
            },
            fmtMoney(totalExpenses),
          ],
        ],
      });

      yy = doc.lastAutoTable.finalY + 8;
    }

    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...C.ink);

    doc.text("Desglose por método:", margin + 10, yy);

    yy += 6;

    [
      ["Efectivo", fmtMoney(totalCash)],
      ["Tarjeta", fmtMoney(totalCard)],
      ["Transferencia", fmtMoney(totalTransfer)],
      ...(totalCredit > 0 ? [["Fiado (no entra a caja)", fmtMoney(totalCredit)]] : []),
      ...(collectedCash > 0 || collectedOther > 0
        ? [["Cobranza de fiado", fmtMoney(collectedCash + collectedOther)]]
        : []),
    ].forEach(([label, value]) => {
      doc.setFont(undefined, "normal");
      doc.setTextColor(...C.body);

      doc.text(label, margin + 16, yy);

      doc.setFont(undefined, "bold");
      doc.setTextColor(...C.ink);

      doc.text(value, pageW - margin - 16, yy, {
        align: "right",
      });

      yy += 5;
    });

    yy += 8;

    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);

    doc.line(margin, yy, pageW - margin, yy);

    yy += 8;

    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...C.body);

    doc.text("Cajero: ___________________", margin + 10, yy);

    doc.text("Supervisor: ___________________", pageW / 2 + 5, yy);

    yy += 14;

    // ── PIE DE PÁGINA (por página) ──────────────────────
    const totalPages = doc.getNumberOfPages();
    for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
      doc.setPage(pageIdx);
      const fy = pageH - 10;
      doc.setFontSize(8);
      doc.setFont(undefined, "normal");
      doc.setTextColor(...C.muted);
      doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, margin, fy);
      doc.text(`Página ${pageIdx} de ${totalPages}`, pageW / 2, fy, {
        align: "center",
      });
      doc.setFont(undefined, "bold");
      doc.text("Vendia", pageW - margin, fy, { align: "right" });
    }

    return doc;
  };

  const exportDailyPDF = async () => {
    const doc = await buildDailyPDF();
    doc.save(`reporte-diario-${mxToday()}.pdf`);
  };

  const printDailyReport = async () => {
    const doc = await buildDailyPDF();
    await printDocument(doc);
  };

  const dayItems = useMemo(
    () =>
      [
        ...sales.map((sale) => {
          const method =
            sale.payment_method === "cash"
              ? "Efectivo"
              : sale.payment_method === "card"
                ? "Tarjeta"
                : "Transferencia";

          const productsText = (sale.products || [])
            .map(
              (product) =>
                `${product.name}${qtyLabel(product)}`,
            )
            .join(", ");

          return {
            type: "sale",
            id: `sale-${sale.id}`,
            saleId: sale.id,
            status: sale.status,
            title: sale.pending ? `Venta ${sale.folio}` : `Venta #${sale.id}`,
            pending: sale.pending || null,
            method,
            desc: [method, productsText].filter(Boolean).join(" · "),
            time: sale.created_at,
            amount: Number(sale.total || 0),
            icon: ShoppingCart,
            items: sale.items || [],
          };
        }),

        ...expensesList.map((expense) => ({
          type: expense.kind === "in" ? "cash_in" : "expense",
          subtype: expense.product_id
            ? "purchase"
            : expense.category === "supplier"
              ? "supplier"
              : "other",
          id: `expense-${expense.id}`,
          expenseId: expense.id,
          title: expense.product_id
            ? purchaseName(expense) || "Compra de mercancía"
            : expense.reason ||
              (expense.kind === "in" ? "Entrada de dinero" : "Salida de dinero"),
          desc: expense.product_id ? purchaseDetail(expense) : "",
          reason: expense.reason,
          productQty: expense.product_id ? Number(expense.quantity || 0) : 0,
          productName: expense.product_id ? purchaseName(expense) : null,
          time: expense.created_at,
          amount:
            expense.kind === "in"
              ? Number(expense.amount || 0)
              : -Number(expense.amount || 0),
          icon: Wallet,
        })),
      ].sort((a, b) => new Date(toUTC(a.time)) - new Date(toUTC(b.time))),
    [sales, expensesList],
  );

  // useDeferredValue: la búsqueda no bloquea el hilo principal al teclear.
  // El input responde al instante y la lista filtrada se actualiza de forma
  // diferida, evitando el lag input→pantalla con muchos movimientos.
  const deferredTurnoSearch = useDeferredValue(turnoSearch);

  const filteredTurnoItems = useMemo(() => {
    const q = deferredTurnoSearch.trim().toLowerCase();
    let items = dayItems;
    if (turnoFilter !== "todos") {
      const targets =
        turnoFilter === "ingresos" ? ["sale", "cash_in"] : ["expense"];
      items = items.filter((item) => targets.includes(item.type));
    }
    if (q) {
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          String(item.desc || "").toLowerCase().includes(q) ||
          String(item.method || "").toLowerCase().includes(q) ||
          String(item.id).toLowerCase().includes(q),
      );
    }
    return items;
  }, [dayItems, turnoFilter, deferredTurnoSearch]);

  useEffect(() => {
    setSelectedTurnoIdx(-1);
  }, [turnoFilter, turnoSearch, dayItems]);

  const turnoKeysRef = useRef({
    filteredTurnoItems: [],
    selectedTurnoIdx: -1,
    canManageRegister: false,
    anyDialogOpen: false,
  });
  turnoKeysRef.current = {
    filteredTurnoItems,
    selectedTurnoIdx,
    canManageRegister,
    anyDialogOpen:
      openRegisterModal ||
      closeRegisterModal ||
      withdrawDialogOpen ||
      outsideDialogOpen ||
      !!saleDetailData ||
      !!cancelSaleData ||
      !!cancelExpenseData,
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      const {
        filteredTurnoItems,
        selectedTurnoIdx,
        canManageRegister,
        anyDialogOpen,
      } = turnoKeysRef.current;

      if (anyDialogOpen) return;

      const target = e.target;
      const tag = target?.tagName;
      const isFormField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const isSearchInput = target === turnoSearchRef.current;

      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isFormField
      ) {
        e.preventDefault();
        setTurnoSearch((prev) => prev + e.key);
        turnoSearchRef.current?.focus();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (isFormField && !isSearchInput) return;
        e.preventDefault();
        if (filteredTurnoItems.length === 0) return;
        setSelectedTurnoIdx((prev) => {
          const delta = e.key === "ArrowDown" ? 1 : -1;
          return prev === -1
            ? e.key === "ArrowDown"
              ? 0
              : filteredTurnoItems.length - 1
            : Math.min(
                filteredTurnoItems.length - 1,
                Math.max(0, prev + delta),
              );
        });
        return;
      }

      if (e.key === "Enter") {
        if (isFormField && !isSearchInput) return;
        if (!canManageRegister) return;
        const item =
          selectedTurnoIdx >= 0 ? filteredTurnoItems[selectedTurnoIdx] : null;
        if (!item) return;
        e.preventDefault();
        if (item.type === "sale" && item.status !== "cancelado" && !item.pending) {
          setCancelSaleData({ id: item.saleId });
        } else if (item.type === "expense" || item.type === "cash_in") {
          setCancelExpenseData({
            id: item.expenseId,
            amount: Math.abs(item.amount),
            reason: item.reason ?? item.desc,
            isCashIn: item.type === "cash_in",
            productQty: item.productQty || 0,
            productName: item.productName || null,
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (selectedTurnoIdx < 0 || !turnoTableRef.current) return;
    const row = turnoTableRef.current.querySelector(
      `[data-turno-idx="${selectedTurnoIdx}"]`,
    );
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedTurnoIdx]);

  // Handlers estables para las filas memoizadas (React.memo + useCallback)
  const handleSelectTurno = useCallback((idx) => setSelectedTurnoIdx(idx), []);

  const handleOpenSaleDetail = useCallback((item) => {
    setCancelItemData(null);
    setSaleDetailData({ id: item.saleId });
  }, []);

  // La venta abierta se deriva en vivo de `sales`: tras una cancelación
  // el backend ajusta el total y el Sheet se refresca solo con fetchData.
  const saleDetailSale = useMemo(() => {
    if (!saleDetailData) return null;
    return (
      sales.find((s) => String(s.id) === String(saleDetailData.id)) || null
    );
  }, [sales, saleDetailData]);

  // Venta de un solo renglón y una sola unidad: el Sheet muestra una
  // confirmación simple en lugar de la tabla. Con 2+ unidades (ej. 2 cocas)
  // se muestra la tabla para poder cancelar por renglón.
  const singleSaleItem = useMemo(() => {
    const items = saleDetailSale?.items || [];
    if (items.length !== 1) return null;
    const it = items[0];
    const returned = Number(it.returned_qty || 0);
    const activeQty = round3(Math.max(0, Number(it.quantity || 0) - returned));
    if (activeQty !== 1) return null;
    const discount = Number(it.discount_percent || 0);
    const subtotal = activeQty * Number(it.price_at_sale || 0) * (1 - discount / 100);
    return { ...it, activeQty, subtotal };
  }, [saleDetailSale]);

  const isSingle = !!singleSaleItem;

  const openCancelItemForm = useCallback(
    (it) => {
      if (cancelItemLoading) return;
      if (!saleDetailData) return;

      const isWeightItem = it.sale_unit === "weight";
      const returned = Number(it.returned_qty || 0);
      const active = round3(Math.max(0, Number(it.quantity || 0) - returned));
      if (active <= 0) return;

      setCancelItemData({
        saleId: saleDetailData.id,
        itemId: it.id,
        itemName: it.product_name,
        itemQty: active,
        itemPrice: Number(it.price_at_sale || 0),
        itemDiscount: Number(it.discount_percent || 0),
        isWeightItem,
        qty: isWeightItem ? active : 1,
      });
    },
    [cancelItemLoading, saleDetailData],
  );

  const handleRequestCancelExpense = useCallback(
    (item) =>
      setCancelExpenseData({
        id: item.expenseId,
        amount: Math.abs(item.amount),
        reason: item.reason ?? item.desc,
        isCashIn: item.type === "cash_in",
        productQty: item.productQty || 0,
        productName: item.productName || null,
      }),
    [],
  );

  // Con la caja cerrada, OpenRegisterCard ya dice el estado y lo que sirve del día.
  const registerClosed = !loading && !isOpen;

  const statusSubtitle = !isOpen
    ? ""
    : String(register.opened_by) === String(cashier?.id) ||
        String(register.cashier_id) === String(cashier?.id)
      ? `Abierta a las ${formatMXTime(register.opened_at)}`
      : `Abierta por: ${register.opener_name || "otro usuario"}`;

  // Comparamos el efectivo declarado contra el efectivo que debería haber:
  // apertura + ventas en efectivo - egresos YA registrados en el sistema
  // (retiros hechos durante el turno) - el gasto adicional que se esté
  // capturando ahora mismo en el campo "Gastos / Egresos" del cierre.
  // Si el esperado sale negativo, la declaración reduce la deuda en lugar
  // de sumarse encima (esperado + declarado).
  const baseExpected =
    Number(register?.opening_balance || 0) +
    totalCash +
    collectedCash +
    Number(register?.cash_in || 0) -
    Number(register?.expenses || 0) -
    (parseFloat(expenses) || 0);
  const openCloseDifference =
    baseExpected >= 0
      ? (parseFloat(declaredClose) || 0) - baseExpected
      : baseExpected + (parseFloat(declaredClose) || 0);

  // ─── ACCIÓN PENDIENTE DESDE OTRA PANTALLA ───────────────────
  // Permite navegar a esta vista y abrir automáticamente el modal
  // de cerrar caja o de retiro de efectivo (seteado vía localStorage
  // desde otro componente antes de navegar aquí).
  useEffect(() => {
    if (loading) return;

    const action = localStorage.getItem("eodPendingAction");
    if (!action) return;

    localStorage.removeItem("eodPendingAction");

    if (action === "close-register") {
      if (!canManageRegister) {
        setRegisterMessage({
          type: "error",
          text: "No hay caja abierta para cerrar",
        });
        return;
      }
      setRegisterName("");
      setDeclaredClose("");
      setExpenses("");
      setCloseRegisterModal(true);
    } else if (action === "withdraw" || action === "deposit") {
      if (!canManageRegister) {
        setRegisterMessage({
          type: "error",
          text: "No hay caja abierta para registrar dinero",
        });
        return;
      }
      const prefill = localStorage.getItem("eodWithdrawPrefill");
      if (prefill) {
        try {
          const parsed = JSON.parse(prefill);
          setWithdrawAmount(String(parsed.amount ?? ""));
          setWithdrawReason(parsed.reason || "");
        } catch {
          setWithdrawAmount("");
          setWithdrawReason("");
        }
        localStorage.removeItem("eodWithdrawPrefill");
      } else {
        setWithdrawAmount("");
        setWithdrawReason("");
      }
      setMoneyMode(action === "deposit" ? "in" : "out");
      setWithdrawDialogOpen(true);
    } else if (action === "open-register") {
      if (isOpen) return;
      setOpeningBalance("");
      setOpenRegisterModal(true);
    }
  }, [loading, canManageRegister, isOpen]);

  const summaryCards = [
    { label: "Ventas totales", value: fmtMoney(totalSales), icon: Banknote, tone: "primary" },
    { label: "Transacciones", value: salesCount, icon: Receipt, tone: "info" },
    {
      label: "Efectivo en caja",
      value: isOpen ? fmtMoney(cashInRegister) : "$0.00",
      icon: Landmark,
      tone: "success",
    },
  ];

  const messageColors = {
    success:
      "border-[#059669]/30 bg-[rgba(16,185,129,.12)] text-[#059669] [&>svg]:text-[#059669]!",
    info: "border-sky-500/30 bg-[rgba(14,165,233,.12)] text-sky-600 [&>svg]:text-sky-600! dark:border-sky-400/30 dark:text-sky-400 dark:[&>svg]:text-sky-400!",
    warning:
      "border-amber-500/30 bg-[rgba(245,158,11,.12)] text-amber-600 [&>svg]:text-amber-600! dark:border-amber-400/30 dark:text-amber-400 dark:[&>svg]:text-amber-400!",
    error: "border-red-500/30 bg-[rgba(239,68,68,.12)]",
  };

  const messageIcons = {
    success: <CircleCheck size={18} />,
    info: <Info size={18} />,
    warning: <TriangleAlert size={18} />,
    error: <TriangleAlert size={18} />,
  };

  // Conteos y totales del turno (sin cancelados) para el encabezado.
  const activeTurno = dayItems.filter((i) => i.status !== "cancelado");
  const inflowItems = dayItems.filter((i) => i.type === "sale" || i.type === "cash_in");
  const outflowItems = dayItems.filter((i) => i.type === "expense");
  const turnoIn = activeTurno
    .filter((i) => i.type === "sale" || i.type === "cash_in")
    .reduce((sum, i) => sum + Math.abs(Number(i.amount) || 0), 0);
  const turnoOut = activeTurno
    .filter((i) => i.type === "expense")
    .reduce((sum, i) => sum + Math.abs(Number(i.amount) || 0), 0);
  const filterChips = [
    { value: "todos", label: "Todos", count: dayItems.length },
    { value: "ingresos", label: "Ingresos", count: inflowItems.length },
    { value: "egresos", label: "Egresos", count: outflowItems.length },
  ];

  return (
    <div className="vt-pilot fade-in p-1">
      {/* HEADER: título, estado del turno y todas las acciones de la caja */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[1.8rem] font-extrabold leading-tight">Caja</h2>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
            <CalendarDays size={15} />

            {new Date().toLocaleDateString("es-MX", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "America/Mexico_City",
            })}

            {" · "}

            {new Date().toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Mexico_City",
            })}

            {isOpen && statusSubtitle && (
              <>
                {" · "}
                <span className="font-semibold text-foreground/80">
                  {statusSubtitle}
                </span>
              </>
            )}
          </p>
        </div>

        {isOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="outline" onClick={exportDailyPDF}>
                  <Download size={17} />
                  <span className="sr-only">Exportar PDF</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar PDF</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="outline" onClick={printDailyReport}>
                  <Printer size={17} />
                  <span className="sr-only">Imprimir reporte</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Imprimir reporte</TooltipContent>
            </Tooltip>

            {canManageRegister && (
              <>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

                {/* Mismo estilo que las etiquetas Ingreso / Egreso de Movimientos */}
                <Button
                  variant="outline"
                  className="border-success/25 bg-success/10 text-success hover:border-success/40 hover:bg-success/20 hover:text-success"
                  onClick={() => {
                    setWithdrawAmount("");
                    setWithdrawReason("");
                    setMoneyMode("in");
                    setWithdrawDialogOpen(true);
                  }}
                >
                  <ArrowUpRight size={17} />
                  Entrada de dinero
                </Button>

                <Button
                  variant="outline"
                  className="border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/40 hover:bg-destructive/20 hover:text-destructive dark:text-red-400 dark:hover:text-red-400"
                  onClick={() => {
                    setWithdrawAmount("");
                    setWithdrawReason("");
                    setMoneyMode("out");
                    setWithdrawDialogOpen(true);
                  }}
                >
                  <ArrowDownRight size={17} />
                  Salida de dinero
                </Button>

                <Button
                  variant="outline"
                  className="border-2 border-amber-600/80 bg-amber-500/[0.06] px-4 text-amber-600 hover:border-amber-600 hover:bg-amber-500/15 hover:text-amber-600 dark:border-amber-500/80 dark:text-amber-500 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:hover:text-amber-400"
                  onClick={() => {
                    setDeclaredClose("");
                    setExpenses("");
                    setRegisterName("");
                    setCloseRegisterModal(true);
                    window.api
                      .invoke("open-cash-drawer")
                      .catch((e) => console.error("[DRAWER]", e));
                  }}
                >
                  <Wallet size={17} />
                  Cerrar caja
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ALERT */}
      {registerMessage && (
        <div className="mb-2">
          <Alert
            className={cn(
              "flex items-center gap-3 py-3 pr-3 [&>svg]:static! [&>svg]:shrink-0 [&>svg~*]:pl-0! [&>svg+div]:translate-y-0!",
              messageColors[registerMessage.type],
            )}
            variant={
              registerMessage.type === "error" ? "destructive" : "default"
            }
          >
            {messageIcons[registerMessage.type]}

            <AlertDescription className="min-w-0 flex-1 font-semibold leading-snug">
              {registerMessage.text}
            </AlertDescription>

            <button
              aria-label="Cerrar aviso"
              onClick={() => setRegisterMessage(null)}
              className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
            >
              <X size={15} />
            </button>
          </Alert>
        </div>
      )}

      {/* TOP SUMMARY */}
      {loading ? (
        <CardSkeleton count={3} />
      ) : registerClosed ? null : (
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          {summaryCards.map((item) => {
            const Icon = item.icon;
            return (
              <StatCard
                prominent
                size="sm"
                key={item.label}
                tone={item.tone}
                icon={<Icon />}
                label={item.label}
                value={item.value}
              />
            );
          })}
        </div>
      )}

      {/* OUTSIDE SALES ALERT (caja cerrada) */}
      {!isOpen && outsideSales.length > 0 && (
        <div className="mt-2 mb-3 flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/50 dark:text-sky-200">
          <p className="flex items-center gap-2">
            <Info size={16} />
            Hay {outsideSales.length} venta(s) registrada(s) fuera de caja.
          </p>

          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOutsideDialogOpen(true)}
            >
              Ver
            </Button>
          )}
        </div>
      )}

      {/* ACCIÓN: ABRIR CAJA (caja cerrada) */}
      {registerClosed && (
        <OpenRegisterCard
          lastClose={prevRegister}
          salesToday={totalSales}
          salesCount={salesCount}
          onOpen={() => {
            setOpeningBalance(
              prevRegister?.declared_close
                ? String(prevRegister.declared_close)
                : "",
            );

            setOpenRegisterModal(true);
          }}
        />
      )}

      {/* TABS (caja abierta) */}
      {isOpen && register && (
        <Tabs defaultValue="movimientos">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="movimientos">
              <Activity size={15} />
              Movimientos
            </TabsTrigger>

            <TabsTrigger value="arqueo">
              <Landmark size={15} />
              Arqueo
            </TabsTrigger>
          </TabsList>

          {/* ─── TAB: MOVIMIENTOS ─────────────────────────────── */}
          <TabsContent value="movimientos" className="animate-enter">
            {/* MOVIMIENTOS DEL TURNO */}
            <Card wash>
              <CardContent className="py-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="flex min-w-0 items-center gap-1.5 text-base font-bold">
                      <Activity size={19} />
                      Movimientos del turno
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      Entró{" "}
                      <b className="text-emerald-600 dark:text-emerald-400">
                        {fmtMoney(turnoIn)}
                      </b>
                      {" · "}Salió{" "}
                      <b className="text-destructive">{fmtMoney(turnoOut)}</b>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />

                      <Input
                        ref={turnoSearchRef}
                        value={turnoSearch}
                        onChange={(e) => setTurnoSearch(e.target.value)}
                        placeholder="Buscar folio, producto o motivo"
                        className="h-9 w-[250px] pl-9"
                      />
                    </div>

                    <Tabs value={turnoFilter} onValueChange={setTurnoFilter}>
                      <TabsList aria-label="Filtrar movimientos">
                        {filterChips.map((chip) => (
                          <TabsTrigger key={chip.value} value={chip.value} className="font-semibold">
                            {chip.label}
                            <span className="text-xs tabular-nums opacity-70">{chip.count}</span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>
                </div>

                {filteredTurnoItems.length === 0 ? (
                  <EmptyState
                    icon={<Activity size={28} strokeWidth={1.5} />}
                    title="No hay movimientos registrados en este turno."
                  />
                ) : (
                  <div
                    ref={turnoTableRef}
                    className="max-h-[600px] overflow-y-auto rounded-lg border"
                  >
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Hora</TableHead>
                          <TableHead>Concepto</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className="text-right">Monto</TableHead>

                          {canManageRegister && (
                            <TableHead className="text-center">
                              Acción
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {filteredTurnoItems.map((item, idx) => (
                          <TurnoRow
                            key={item.id}
                            item={item}
                            idx={idx}
                            selected={selectedTurnoIdx === idx}
                            canManageRegister={canManageRegister}
                            onSelect={handleSelectTurno}
                            onDetail={handleOpenSaleDetail}
                            onRequestCancelExpense={
                              handleRequestCancelExpense
                            }
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── TAB: ARQUEO ──────────────────────────────────── */}
          <TabsContent value="arqueo" className="animate-enter">
            <Card wash>
              <CardContent className="px-4 py-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-base font-bold">
                  <Landmark size={18} />
                  Resumen de caja
                </h3>

                <ArqueoSummary
                  register={register}
                  totalCash={totalCash}
                  totalCard={totalCard}
                  totalTransfer={totalTransfer}
                  totalCredit={totalCredit}
                  collectedCash={collectedCash}
                  collectedOther={collectedOther}
                  expectedClose={expectedClose}
                  salesCount={salesCount}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* OPEN REGISTER */}
      <Dialog
        open={openRegisterModal}
        onOpenChange={(open) => {
          if (!open && !openLoading) setOpenRegisterModal(false);
        }}
      >
        <DialogContent
          brand
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleOpenRegister();
          }}
        >
          <DialogBrandHeader
            icon={<Store size={20} />}
            title="Abrir caja"
            description="Ingresa el monto inicial en efectivo para abrir la caja del día."
          />

          <div className="px-6 py-5">
            <FieldLabel>Monto de apertura</FieldLabel>

            <div className="relative">
              <Banknote
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />

              <Input
                type="number"
                value={openingBalance}
                autoFocus
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0.00"
                min={0}
                step={0.01}
                inputMode="decimal"
                className="pl-9"
              />
            </div>
          </div>

          <ModalError text={modalError} onClose={() => setModalError(null)} />

          <DialogBrandFooter>
            <Button
              variant="ghost"
              disabled={openLoading}
              onClick={() => setOpenRegisterModal(false)}
            >
              Cancelar
            </Button>

            <Button
              onClick={handleOpenRegister}
              disabled={openLoading}
            >
              {openLoading ? <Spinner size={18} /> : <CircleCheck size={18} />}
              {openLoading ? "Abriendo..." : "Abrir caja"}
            </Button>
          </DialogBrandFooter>
        </DialogContent>
      </Dialog>

      {/* CLOSE REGISTER */}
      <Dialog
        open={closeRegisterModal}
        onOpenChange={(open) => {
          if (!open && !closeLoading) setCloseRegisterModal(false);
        }}
      >
        <DialogContent
          brand
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !servicePending && e.target.tagName === "INPUT") {
              e.preventDefault();
              handleCloseRegister();
            }
          }}
        >
          <DialogBrandHeader
            icon={<Wallet size={20} />}
            title="Cerrar caja"
            description="Ingresa el efectivo final y los gastos del día para realizar el cierre."
          />

          <div className="space-y-3 px-6 py-4">
            <div>
              <FieldLabel>Nombre de la caja</FieldLabel>

              <div className="relative">
                <Store
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  placeholder="Ej: Caja mañana..."
                  className="pl-9"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Efectivo declarado</FieldLabel>

              <div className="relative">
                <Banknote
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  type="number"
                  value={declaredClose}
                  autoFocus
                  onChange={(e) => setDeclaredClose(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  className="pl-9"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Gastos / Egresos</FieldLabel>

              <div className="relative">
                <Banknote
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  type="number"
                  value={expenses}
                  onChange={(e) => setExpenses(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {/* CLOSE SUMMARY */}
          <div className="mx-6 mb-4 rounded-lg border border-amber-300/30 bg-amber-50 p-4 dark:bg-amber-500/10">
            <p className="mb-3 block text-xs font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Resumen del cierre
            </p>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Cierre esperado
                </span>

                <span className="text-sm font-bold tabular-nums">
                  {fmtMoney(baseExpected)}
                </span>
              </div>

              {baseExpected < 0 && (
                <p className="-mt-0.5 block text-xs text-warning">
                  Los gastos/retiros superaron el efectivo disponible; el
                  esperado quedó negativo.
                </p>
              )}

              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Efectivo declarado
                </span>

                <span className="text-sm font-bold tabular-nums">
                  {fmtMoney(parseFloat(declaredClose) || 0)}
                </span>
              </div>

              <Separator className="my-2" />

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">Diferencia</p>

                  <p className="text-xs text-muted-foreground">
                    {openCloseDifference === 0
                      ? "Caja cuadrada"
                      : openCloseDifference > 0
                        ? "Sobrante de efectivo"
                        : "Faltante de efectivo"}
                  </p>
                </div>

                <span
                  className={cn(
                    "text-base font-extrabold tabular-nums",
                    openCloseDifference === 0
                      ? "text-success"
                      : openCloseDifference > 0
                        ? "text-info"
                        : "text-destructive",
                  )}
                >
                  {openCloseDifference > 0
                    ? "+"
                    : openCloseDifference < 0
                      ? "−"
                      : ""}
                  {fmtMoneyAbs(openCloseDifference)}
                </span>
              </div>
            </div>
          </div>

          <ModalError text={modalError} onClose={() => setModalError(null)} />

          {servicePending && (
            <p role="alert" className="rounded-lg bg-warning/15 px-4 py-3 text-sm text-foreground">
              Hay recargas pendientes o por verificar. Confirma el cierre para
              dejar esas recargas fuera del corte.
            </p>
          )}

          <DialogBrandFooter>
            <CancelButton
              disabled={closeLoading}
              onClick={() => setCloseRegisterModal(false)}
            >
              Cancelar
            </CancelButton>

            <Button
              variant="outline"
              disabled={closeLoading}
              onClick={() => handleCloseRegister(Boolean(servicePending))}
              className="border-amber-600 bg-amber-500/10 text-amber-600 hover:border-amber-600 hover:bg-amber-500/20 hover:text-amber-600 dark:border-amber-500 dark:text-amber-400 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:hover:text-amber-300"
            >
              {closeLoading ? <Spinner size={18} /> : <CircleCheck size={18} />}
              {closeLoading ? "Cerrando..." : servicePending ? "Confirmar cierre" : "Cerrar caja"}
            </Button>
          </DialogBrandFooter>
        </DialogContent>
      </Dialog>

      {/* WITHDRAW */}
      <Dialog
        open={withdrawDialogOpen}
        onOpenChange={(open) => {
          if (!open && !withdrawLoading) setWithdrawDialogOpen(false);
        }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleRegisterExpense();
          }}
        >
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                isMoneyIn ? "bg-emerald-500/10" : "bg-red-500/10",
              )}
            >
              {isMoneyIn ? (
                <ArrowUpRight
                  size={20}
                  className="text-emerald-600 dark:text-emerald-400"
                />
              ) : (
                <ArrowDownRight size={20} className="text-destructive" />
              )}
            </div>

            <div>
              <DialogTitle className="text-base font-extrabold">
                {isMoneyIn ? "Entrada de dinero" : "Salida de dinero"}
              </DialogTitle>

              <DialogDescription className="text-xs leading-relaxed">
                {isMoneyIn
                  ? "Registra dinero que metes a la caja. Se suma al efectivo esperado del corte."
                  : "Registra dinero que sacas de la caja. Se agregará a los gastos del día."}
              </DialogDescription>
            </div>
          </DialogHeader>

          <Separator />

          {(() => {
            const typed = parseFloat(withdrawAmount) || 0;
            const after = isMoneyIn
              ? cashInRegister + typed
              : cashInRegister - typed;
            return (
              <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-muted/40 shadow-sm">
                <div className="px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    Disponible en caja
                  </p>
                  <p className="mt-0.5 text-xl font-extrabold tabular-nums">
                    {fmtMoney(cashInRegister)}
                  </p>
                </div>
                <div
                  className={cn(
                    "border-l px-4 py-3",
                    typed > 0 &&
                      (after < 0
                        ? "bg-red-500/10"
                        : isMoneyIn
                          ? "bg-emerald-500/10"
                          : "bg-card"),
                  )}
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    Quedará
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xl font-extrabold tabular-nums",
                      typed <= 0
                        ? "text-muted-foreground"
                        : after < 0
                          ? "text-destructive"
                          : isMoneyIn
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-foreground",
                    )}
                  >
                    {typed > 0 ? fmtMoney(after) : "—"}
                  </p>
                </div>
              </div>
            );
          })()}

          {!isMoneyIn && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-sidebar p-1">
              {[
                { value: "supplier", label: "Pago de mercancía" },
                { value: "other", label: "Otro gasto" },
              ].map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  disabled={withdrawLoading}
                  onClick={() => {
                    setCashOutCategory(tab.value);
                    setModalError(null);
                    try {
                      localStorage.setItem("cashOutCategory", tab.value);
                    } catch {}
                  }}
                  className={cn(
                    "h-9 cursor-pointer rounded-md text-sm font-bold transition-colors",
                    cashOutCategory === tab.value
                      ? "bg-background text-foreground shadow"
                      : "text-foreground/60 hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <FieldLabel>{isMoneyIn ? "¿Cuánto entra?" : "¿Cuánto sale?"}</FieldLabel>

              <div className="relative">
                <Banknote
                  size={20}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  type="number"
                  value={withdrawAmount}
                  autoFocus
                  disabled={withdrawLoading}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  className="h-12 pl-10 text-lg font-bold tabular-nums"
                />
              </div>
            </div>

            <div>
              <FieldLabel>{isSupplierPay ? "Producto / proveedor" : "Motivo"}</FieldLabel>

              <div className="relative">
                <Receipt
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  value={withdrawReason}
                  disabled={withdrawLoading}
                  autoComplete="off"
                  onChange={(e) => {
                    setWithdrawReason(e.target.value);
                    setSuggestOpen(true);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
                  onKeyDown={(e) => {
                    const list = suggestOpen ? reasonSuggestions : [];
                    if (!list.length) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSuggestIdx((i) => (i + 1) % list.length);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSuggestIdx((i) => (i <= 0 ? list.length - 1 : i - 1));
                    } else if (e.key === "Enter" && suggestIdx >= 0) {
                      // Solo toma la sugerencia si el cajero la marcó con las
                      // flechas; si no, Enter confirma con lo que escribió.
                      e.preventDefault();
                      e.stopPropagation();
                      setWithdrawReason(list[suggestIdx].label);
                      setSuggestOpen(false);
                      setSuggestIdx(-1);
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setSuggestOpen(false);
                    }
                  }}
                  placeholder={
                    isMoneyIn
                      ? "Ej: cambio extra, préstamo del dueño..."
                      : isSupplierPay
                        ? "Ej: Coca-Cola, FEMSA, Bimbo..."
                        : "Ej: gasolina, luz, comida..."
                  }
                  className="h-11 pl-9"
                />

                {isSupplierPay && suggestOpen && reasonSuggestions.length > 0 && (
                  <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
                    {reasonSuggestions.map((sug, i) => (
                      <button
                        key={sug.kind + sug.label}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setWithdrawReason(sug.label);
                          setSuggestOpen(false);
                          setSuggestIdx(-1);
                        }}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm",
                          i === suggestIdx ? "bg-accent" : "hover:bg-accent/60",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">{sug.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{sug.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {isMoneyIn && (
              <Alert variant="default" className="rounded-lg py-2.5">
                <Info size={16} className="text-info" />
                <AlertDescription>
                  No es una venta: úsalo para cambio extra o un préstamo a la caja.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <ModalError text={modalError} onClose={() => setModalError(null)} />

          <DialogFooter className="sm:justify-between">
            <CancelButton
              disabled={withdrawLoading}
              onClick={() => setWithdrawDialogOpen(false)}
            >
              Cancelar
            </CancelButton>

            <Button
              variant="outline"
              disabled={withdrawLoading}
              onClick={handleRegisterExpense}
              className={
                isMoneyIn
                  ? "border-emerald-600 bg-emerald-500/10 text-emerald-700 hover:border-emerald-600 hover:bg-emerald-500/20 hover:text-emerald-700 dark:border-emerald-500 dark:text-emerald-400 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300"
                  : "border-red-600 bg-red-500/10 text-red-600 hover:border-red-600 hover:bg-red-500/20 hover:text-red-600 dark:border-red-500 dark:text-red-400 dark:hover:border-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-300"
              }
            >
              {withdrawLoading ? (
                <>
                  <Spinner size={18} />
                  Registrando...
                </>
              ) : (
                <>
                  <CircleCheck size={18} />
                  {isMoneyIn ? "Confirmar entrada" : "Confirmar salida"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OUTSIDE SALES */}
      <Dialog
        open={outsideDialogOpen}
        onOpenChange={(open) => {
          if (!open) setOutsideDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <ShoppingCart size={22} className="text-info" />

            <DialogTitle className="text-base font-bold">
              Ventas fuera de caja
            </DialogTitle>
          </DialogHeader>

          <DialogDescription className="text-sm leading-relaxed">
            Estas ventas se registraron sin una caja abierta (hoy o ayer). Solo
            el administrador puede cancelarlas y solo si son de hoy.
          </DialogDescription>

          <div className="max-h-[60vh] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Hora</TableHead>
                  <TableHead>Venta</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-center">Acción</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {outsideSales.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-4 text-center">
                      Sin ventas fuera de caja
                    </TableCell>
                  </TableRow>
                )}

                {outsideSales.map((sale) => {
                  const method =
                    sale.payment_method === "cash"
                      ? "Efectivo"
                      : sale.payment_method === "card"
                        ? "Tarjeta"
                        : "Transferencia";

                  const productsText = (sale.products || [])
                    .map((p) => `${p.name}${qtyLabel(p)}`)
                    .join(", ");

                  return (
                    <TableRow key={sale.id} className="cursor-pointer">
                      <TableCell className="whitespace-nowrap">
                        {formatMXTime(sale.created_at)}
                      </TableCell>

                      <TableCell>
                        <p className="text-sm font-semibold">#{sale.id}</p>

                        {productsText && (
                          <p className="block max-w-[300px] truncate text-xs text-muted-foreground">
                            {productsText}
                          </p>
                        )}
                      </TableCell>

                      <TableCell>{method}</TableCell>

                      <TableCell className="text-right font-bold tabular-nums">
                        {fmtMoney(sale.total)}
                      </TableCell>

                      <TableCell className="text-center">
                        <CancelButton
                          size="sm"
                          onClick={() => setCancelSaleData({ id: sale.id })}
                        >
                          Cancelar
                        </CancelButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOutsideDialogOpen(false)}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCEL SALE */}
      <Dialog
        open={!!cancelSaleData}
        onOpenChange={(open) => {
          if (!open && !cancelLoading) setCancelSaleData(null);
        }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !cancelLoading) {
              e.preventDefault();
              handleCancelSale();
            }
          }}
        >
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <TriangleAlert size={22} className="text-destructive" />

            <DialogTitle className="text-base font-bold">
              Cancelar venta #{cancelSaleData?.id}
            </DialogTitle>
          </DialogHeader>

          <DialogDescription className="leading-relaxed">
            Se revertirá el stock de los productos y esta venta dejará de contar
            en la caja y en las ganancias. Esta acción no se puede deshacer.
          </DialogDescription>

          <DialogFooter className="sm:justify-between">
            <CancelButton
              disabled={cancelLoading}
              onClick={() => !cancelLoading && setCancelSaleData(null)}
            >
              No
            </CancelButton>

            <Button
              variant="destructive"
              disabled={cancelLoading}
              onClick={handleCancelSale}
            >
              {cancelLoading ? <Spinner size={18} /> : "Sí, cancelar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SALE DETAIL SHEET */}
      <Sheet
        open={!!saleDetailData}
        onOpenChange={(open) => {
          if (!open && !cancelItemLoading) {
            setCancelItemData(null);
            setSaleDetailData(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full max-w-lg flex-col gap-0 p-0"
        >
          <SheetBrandHeader
            icon={<Receipt />}
            title={<>Detalle de venta #{saleDetailSale?.id}</>}
            description={<>{saleDetailSale &&
                    `${formatMXDateTime(saleDetailSale.created_at)} · ${
                      methodLabels[saleDetailSale.payment_method] ||
                      saleDetailSale.payment_method
                    }`}</>}
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {saleDetailSale && isSingle && (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                  <Trash2 size={26} className="text-destructive" />
                </div>

                <div>
                  <p className="text-lg font-bold text-foreground">
                    {singleSaleItem.product_name}
                  </p>

                  <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                    ×{singleSaleItem.activeQty} · {fmtMoney(singleSaleItem.subtotal)}
                  </p>
                </div>

                <p className="max-w-xs text-sm text-muted-foreground">
                  Se eliminará esta venta y se revertirá el stock.
                </p>
              </div>
            )}

            {saleDetailSale && !isSingle && (
              <>
                <div className="overflow-hidden rounded-xl border">
                  {(saleDetailSale.items || []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Sin productos en esta venta
                    </p>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted sticky top-0 z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Cant</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>

                          {canManageRegister && (
                            <TableHead className="text-center">
                              Acción
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {saleDetailSale.items.map((it) => {
                          const isItemCancelled =
                            it.status === "cancelado" ||
                            Number(it.returned_qty || 0) >=
                              Number(it.quantity || 0);
                          const returned = Number(it.returned_qty || 0);
                          const active = round3(
                            Math.max(0, Number(it.quantity || 0) - returned),
                          );
                          const discount = Number(it.discount_percent || 0);
                          const activeSubtotal =
                            active *
                            Number(it.price_at_sale || 0) *
                            (1 - discount / 100);

                          return (
                            <TableRow key={it.id}>
                              <TableCell
                                className={
                                  isItemCancelled
                                    ? "text-muted-foreground line-through"
                                    : ""
                                }
                              >
                                {it.product_name}
                              </TableCell>

                              <TableCell className="text-right tabular-nums">
                                {it.sale_unit === "weight" ? `${fmtKg(active)} kg` : `x${active}`}
                              </TableCell>

                              <TableCell className="text-right font-semibold tabular-nums">
                                {fmtMoney(activeSubtotal)}
                              </TableCell>

                              {canManageRegister && (
                                <TableCell className="text-center">
                                  {(() => {
                                    if (isItemCancelled)
                                      return (
                                        <Badge
                                          variant="outline"
                                          className="border-red-500/30 bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                                        >
                                          CANCELADO
                                        </Badge>
                                      );

                                    return (
                                      <CancelButton
                                        size="sm"
                                        className="px-2 py-1 text-xs"
                                        disabled={cancelItemLoading}
                                        onClick={() => openCancelItemForm(it)}
                                      >
                                        Cancelar
                                      </CancelButton>
                                    );
                                  })()}
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* DEVOLUCIÓN INLINE · el mismo control de − y +, con el resultado
                    en palabras, motivo opcional y el botón que dice el monto. */}
                {cancelItemData && (() => {
                const isW = cancelItemData.isWeightItem;
                const minQty = isW ? 0.001 : 1;
                const unitOf = (q) => (isW ? `${fmtKg(q)} kg` : `${q} ${q === 1 ? "pieza" : "piezas"}`);
                const qtyError = cancelQtyError(cancelItemData);
                const okQty = qtyError ? 0 : cancelItemData.qty;
                const refund =
                  cancelItemData.itemPrice * okQty * (1 - cancelItemData.itemDiscount / 100);
                const newTotal = Number(saleDetailSale?.total || 0) - refund;
                const left = qtyError ? null : round3(cancelItemData.itemQty - cancelItemData.qty);
                return (
                  <div className="mt-4 space-y-4 rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand/10 text-brand dark:bg-chart-2/15 dark:text-chart-2">
                        <PackageX size={19} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-base font-bold">
                          Devolver {cancelItemData.itemName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Se vendieron {unitOf(cancelItemData.itemQty)} ·{" "}
                          {fmtMoney(cancelItemData.itemPrice)} {isW ? "el kg" : "c/u"}
                          {cancelItemData.itemDiscount > 0 &&
                            ` · desc. ${cancelItemData.itemDiscount}%`}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-center text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        {isW ? "¿Cuántos kg se devuelven?" : "¿Cuántas piezas se devuelven?"}
                      </p>

                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 rounded-[10px]"
                          disabled={
                            cancelItemLoading || !(cancelItemData.qty > minQty)
                          }
                          onClick={() =>
                            setCancelItemData((p) => {
                              const base = Number.isFinite(p?.qty) ? p.qty : 0;
                              return withQty(
                                p,
                                isW
                                  ? round3(Math.max(minQty, base - 0.1))
                                  : Math.max(1, base - 1),
                              );
                            })
                          }
                          aria-label="Restar"
                        >
                          <Minus size={16} />
                        </Button>

                        <Input
                          type="text"
                          inputMode={isW ? "decimal" : "numeric"}
                          value={
                            cancelItemData.qtyText ??
                            (isW ? fmtKg(cancelItemData.qty) : String(cancelItemData.qty))
                          }
                          disabled={cancelItemLoading}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const text = cleanQtyText(e.target.value, isW);
                            const parsed = text === "" || text === "." ? NaN : Number(text);
                            setCancelItemData((p) =>
                              p
                                ? {
                                    ...p,
                                    qtyText: text,
                                    qty: Number.isFinite(parsed) ? round3(parsed) : NaN,
                                  }
                                : p,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleCancelSaleItem();
                            }
                          }}
                          aria-invalid={!!qtyError}
                          className="h-10 w-24 rounded-[10px] text-center text-base font-bold tabular-nums"
                          aria-label="Cantidad a devolver"
                        />

                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 rounded-[10px]"
                          disabled={
                            cancelItemLoading ||
                            cancelItemData.qty >= cancelItemData.itemQty
                          }
                          onClick={() =>
                            setCancelItemData((p) => {
                              const base = Number.isFinite(p?.qty) ? p.qty : 0;
                              return withQty(
                                p,
                                isW
                                  ? Math.min(p.itemQty, round3(base + 0.1))
                                  : Math.min(p.itemQty, base + 1),
                              );
                            })
                          }
                          aria-label="Sumar"
                        >
                          <Plus size={16} />
                        </Button>

                        <span className="text-sm font-semibold text-muted-foreground">
                          de {unitOf(cancelItemData.itemQty)}
                        </span>
                      </div>

                        {(isW || cancelItemData.itemQty > 1) && (
                          <div className="mt-2.5 flex justify-center gap-1.5">
                            {(isW ? cancelItemData.itemQty > 1 : true) && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={cancelItemLoading || cancelItemData.qty === 1}
                                onClick={() => setCancelItemData((p) => withQty(p, 1))}
                              >
                                {isW ? "1 kg" : "1 pieza"}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={
                                cancelItemLoading ||
                                cancelItemData.qty === cancelItemData.itemQty
                              }
                              onClick={() => setCancelItemData((p) => withQty(p, p?.itemQty))}
                            >
                              Todo
                            </Button>
                          </div>
                        )}

                      {cancelItemData.qtyText !== undefined && qtyError && (
                        <p className="mt-1.5 text-center text-xs font-semibold text-destructive">
                          {qtyError}
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-center text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        Motivo{" "}
                        <span className="font-medium normal-case tracking-normal">· opcional</span>
                      </p>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {CANCEL_REASONS.map((r) => {
                          const on = cancelItemData.reason === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              aria-pressed={on}
                              disabled={cancelItemLoading}
                              onClick={() =>
                                setCancelItemData((p) =>
                                  p ? { ...p, reason: on ? "" : r } : p,
                                )
                              }
                              className={cn(
                                "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                                on
                                  ? "bg-foreground text-background"
                                  : "text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground",
                              )}
                            >
                              {r}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl bg-muted/60 px-3.5 py-3">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-2">
                        <span className="text-sm font-bold">Se le regresa al cliente</span>
                        <span className="text-xl font-bold text-destructive tabular-nums">
                          {fmtMoney(refund)}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5 text-sm">
                        <span className="text-muted-foreground">Vuelve al inventario</span>
                        <span className="font-bold text-success tabular-nums">
                          +{isW ? `${fmtKg(okQty)} kg` : okQty}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5 text-sm">
                        <span className="text-muted-foreground">El ticket queda en</span>
                        <span className="font-bold tabular-nums">{fmtMoney(newTotal)}</span>
                      </div>
                      {left > 0 && (
                        <div className="flex justify-between py-0.5 text-sm">
                          <span className="text-muted-foreground">Siguen en la venta</span>
                          <span className="font-bold tabular-nums">{unitOf(left)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        disabled={cancelItemLoading}
                        onClick={() => setCancelItemData(null)}
                      >
                        Volver
                      </Button>

                      <Button
                        variant="destructive"
                        className="flex-1"
                        disabled={cancelItemLoading || !!qtyError}
                        onClick={handleCancelSaleItem}
                      >
                        {cancelItemLoading ? (
                          <Spinner size={16} />
                        ) : (
                          `Devolver ${fmtMoney(refund)}`
                        )}
                      </Button>
                    </div>
                  </div>
                )})()}

                <p
                  className={cn(
                    "mt-3 text-right text-lg font-bold tabular-nums",
                    "text-success",
                  )}
                >
                  Total: {fmtMoney(saleDetailSale.total)}
                </p>
              </>
            )}
          </div>

          <ModalError text={modalError} onClose={() => setModalError(null)} />

          <SheetFooter className="sm:justify-between">
            {isSingle ? (
              <Button
                variant="destructive"
                disabled={cancelLoading}
                onClick={() => handleCancelSaleDirect(saleDetailSale?.id)}
              >
                {cancelLoading ? <Spinner size={18} /> : "Eliminar venta"}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={cancelItemLoading}
                onClick={() => {
                  const saleId = saleDetailSale?.id;
                  setCancelItemData(null);
                  setSaleDetailData(null);
                  setCancelSaleData({ id: saleId });
                }}
              >
                Cancelar toda la venta
              </Button>
            )}

            <Button
              variant="outline"
              disabled={cancelItemLoading}
              onClick={() => {
                setCancelItemData(null);
                setSaleDetailData(null);
              }}
            >
              Cerrar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* CANCEL EXPENSE */}
      <Dialog
        open={!!cancelExpenseData}
        onOpenChange={(open) => {
          if (!open && !cancelExpenseLoading) setCancelExpenseData(null);
        }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !cancelExpenseLoading) {
              e.preventDefault();
              handleCancelExpense();
            }
          }}
        >
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <TriangleAlert size={22} className="text-destructive" />

            <DialogTitle className="text-base font-bold">
              {cancelExpenseData?.isCashIn ? "Cancelar entrada" : "Cancelar gasto"}
            </DialogTitle>
          </DialogHeader>

          <DialogDescription className="leading-relaxed">
            Se quitará {cancelExpenseData?.isCashIn
              ? "la entrada"
              : cancelExpenseData?.productQty > 0
                ? "la compra"
                : "el gasto"}{" "}
            {cancelExpenseData?.reason && (
              <strong className="text-foreground">
                "{cancelExpenseData.reason}"
              </strong>
            )}{" "}
            por {fmtMoney(cancelExpenseData?.amount)} de la caja
            {cancelExpenseData?.productQty > 0 && (
              <>
                {" "}y se restarán{" "}
                <strong className="text-foreground">
                  {cancelExpenseData.productQty}{" "}
                  {cancelExpenseData.productQty === 1 ? "pieza" : "piezas"}
                  {cancelExpenseData.productName ? ` de ${cancelExpenseData.productName}` : ""}
                </strong>{" "}
                del inventario
              </>
            )}
            . Esta acción no se puede deshacer.
          </DialogDescription>

          <DialogFooter className="sm:justify-between">
            <CancelButton
              disabled={cancelExpenseLoading}
              onClick={() => !cancelExpenseLoading && setCancelExpenseData(null)}
            >
              No
            </CancelButton>

            <Button
              variant="destructive"
              disabled={cancelExpenseLoading}
              onClick={handleCancelExpense}
            >
              {cancelExpenseLoading ? <Spinner size={18} /> : "Sí, cancelar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EndOfDay;

// ── Resumen de caja (pestaña Arqueo) ────────────────────────────────────────
// Dos columnas: ventas por forma de pago (tonos del azul de Vendia, fiado
// rayado aparte) y el movimiento del efectivo con sus signos. Abajo, aparte,
// "¿Dónde está el dinero?". El total es todo lo que hay que llevarse (cajón
// con apertura, entradas y gastos ya restados, más banco). Sólo aparece si hubo
// efectivo Y tarjeta/transferencia: con una sola forma repetiría esa tarjeta.
const CREDIT_STRIPES = {
  backgroundImage: "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 4px)",
};

function MethodSwatch({ className, credit }) {
  return credit ? (
    <i
      className="inline-block size-2.5 shrink-0 rounded-[3px] border border-current text-muted-foreground"
      style={CREDIT_STRIPES}
    />
  ) : (
    <i className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", className)} />
  );
}

function ArqueoSummary({
  register,
  totalCash,
  totalCard,
  totalTransfer,
  totalCredit,
  collectedCash,
  collectedOther,
  expectedClose,
  salesCount,
}) {
  const methods = [
    { key: "cash", label: "Efectivo", value: totalCash, swatch: "bg-brand dark:bg-chart-3" },
    { key: "card", label: "Tarjeta", value: totalCard, swatch: "bg-chart-2 dark:bg-chart-1" },
    { key: "transfer", label: "Transferencia", value: totalTransfer, swatch: "bg-chart-4" },
    ...(totalCredit > 0 ? [{ key: "credit", label: "Fiado", value: totalCredit, credit: true }] : []),
  ];
  const sold = methods.reduce((sum, m) => sum + m.value, 0);
  const pct = (v) => (sold > 0 ? Math.round((v / sold) * 100) : 0);
  const ticket = salesCount > 0 ? sold / salesCount : 0;

  const cashIn = Number(register.cash_in || 0);
  const ledger = [
    { label: "Apertura", value: Number(register.opening_balance || 0), sign: "" },
    { label: "Ventas en efectivo", value: totalCash, sign: "+" },
    ...(collectedCash > 0 ? [{ label: "Cobranza de fiado", value: collectedCash, sign: "+" }] : []),
    ...(cashIn > 0 ? [{ label: "Entradas de dinero", value: cashIn, sign: "+" }] : []),
    { label: "Gastos y retiros", value: Number(register.expenses || 0), sign: "−" },
  ];

  const cashGot = totalCash + collectedCash;
  const bankGot = totalCard + totalTransfer + collectedOther;
  const where = [
    ...(cashGot > 0 && bankGot > 0
      ? [{ label: "Total", value: expectedClose + bankGot, note: "cajón y banco: todo lo del turno", swatch: "bg-foreground/70" }]
      : []),
    { label: "En el cajón", value: expectedClose, note: "efectivo para contar", swatch: "bg-brand dark:bg-chart-3" },
    { label: "En el banco", value: bankGot, note: "tarjeta y transferencia", swatch: "bg-chart-2 dark:bg-chart-1" },
    { label: "Salió", value: Number(register.expenses || 0), note: "gastos y retiros", swatch: "bg-destructive" },
  ];

  return (
    <div>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {/* VENTAS POR FORMA DE PAGO */}
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Ventas por forma de pago
          </p>
          <p className="mt-1 mb-2.5 flex flex-wrap items-baseline gap-x-2 text-2xl font-bold tracking-tight tabular-nums">
            {fmtMoney(sold)}
            {ticket > 0 && (
              <span className="text-[13px] font-medium tracking-normal text-muted-foreground">
                ticket promedio {fmtMoney(ticket)}
              </span>
            )}
          </p>

          {sold > 0 && (
            <div className="mb-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              {methods
                .filter((m) => m.value > 0)
                .map((m) =>
                  m.credit ? (
                    <i
                      key={m.key}
                      className="block h-full text-muted-foreground"
                      style={{ ...CREDIT_STRIPES, width: `${(m.value / sold) * 100}%` }}
                    />
                  ) : (
                    <i key={m.key} className={cn("block h-full", m.swatch)} style={{ width: `${(m.value / sold) * 100}%` }} />
                  ),
                )}
            </div>
          )}

          {methods.map((m) => (
            <div
              key={m.key}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-t py-2 text-sm",
                m.credit && "text-muted-foreground",
              )}
            >
              <MethodSwatch className={m.swatch} credit={m.credit} />
              <span className="truncate">
                {m.label}
                {m.credit && <span className="text-xs"> · no entra a caja</span>}
              </span>
              <span className="min-w-9 text-right text-xs text-muted-foreground tabular-nums">{pct(m.value)} %</span>
              <b className="font-semibold tabular-nums">{fmtMoney(m.value)}</b>
            </div>
          ))}
        </div>

        {/* MOVIMIENTO DEL EFECTIVO */}
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Movimiento del efectivo
          </p>
          <div className="mt-2">
            {ledger.map((row, i) => (
              <div
                key={row.label}
                className={cn(
                  "grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 py-2.5 text-sm",
                  i > 0 && "border-t",
                )}
              >
                <span
                  className={cn(
                    "text-center font-bold",
                    row.sign === "+" && "text-success",
                    row.sign === "−" && "text-destructive",
                  )}
                >
                  {row.sign}
                </span>
                <span>{row.label}</span>
                <b className="font-semibold tabular-nums">{fmtMoneyAbs(row.value)}</b>
              </div>
            ))}
            <div className="mt-1 grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-success/12 px-2 py-3 text-[15px] font-bold text-success ring-1 ring-success/25 dark:bg-success/15">
              <span className="text-center">=</span>
              <span>Cierre esperado</span>
              <b className="text-lg tabular-nums">{fmtMoney(expectedClose)}</b>
            </div>
          </div>
        </div>
      </div>

      {/* ¿DÓNDE ESTÁ EL DINERO? */}
      <div className="mt-4 border-t border-dashed pt-3.5">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
          ¿Dónde está el dinero del turno?
        </p>
        <div className={cn("mt-2 grid grid-cols-2 gap-2.5", where.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {where.map((w) => (
            <div key={w.label} className="grid gap-1 rounded-[10px] bg-muted px-3.5 py-3">
              <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <MethodSwatch className={w.swatch} />
                {w.label}
              </span>
              <b className="text-xl font-bold tracking-tight tabular-nums">{fmtMoney(w.value)}</b>
              <small className="text-xs text-muted-foreground">{w.note}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
