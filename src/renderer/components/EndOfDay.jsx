import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Banknote,
  CalendarDays,
  CircleCheck,
  CreditCard,
  Download,
  Eye,
  Info,
  Landmark,
  Lock,
  Minus,
  PackageX,
  Plus,
  Printer,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
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

import CancelButton from "./CancelButton";
import { CardSkeleton } from "./Skeletons";

import {
  formatMXDateTime,
  formatMXTime,
  mxToday,
  toUTC,
} from "../utils/dateUtils";

import { useCashier } from "../contexts/CashierContext";

import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";

applyPlugin(jsPDF);

const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
    {children}
  </span>
);

const methodLabels = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const fmtKg = (n) => String(round3(n));

const TurnoRow = memo(function TurnoRow({
  item,
  idx,
  selected,
  canManageRegister,
  onSelect,
  onDetail,
  onRequestCancelSale,
  onRequestCancelExpense,
}) {
  const isCancelled = item.status === "cancelado";
  const isSale = item.type === "sale";

  return (
    <TableRow
      data-turno-idx={idx}
      onClick={() => onSelect(idx)}
      className={cn(
        "cursor-pointer",
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

        <p className="max-w-[480px] truncate text-xs text-muted-foreground">
          {item.desc}
        </p>
      </TableCell>

      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            "border leading-none",
            isSale
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
              : "border-red-500/30 bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
          )}
        >
          {isSale ? "INGRESO" : "EGRESO"}
        </Badge>
      </TableCell>

      <TableCell
        className={cn(
          "whitespace-nowrap text-right font-bold tabular-nums",
          isCancelled
            ? "text-muted-foreground line-through"
            : isSale
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive",
        )}
      >
        {isSale ? "+" : "-"}${Math.abs(item.amount).toFixed(2)}
      </TableCell>

      {canManageRegister && (
        <TableCell className="whitespace-nowrap text-center">
          {isSale && !isCancelled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="mr-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDetail(item);
                  }}
                  aria-label="Ver detalle de la venta"
                >
                  <Eye size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ver detalle</TooltipContent>
            </Tooltip>
          )}

          {isSale && !isCancelled && (
            <CancelButton
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onRequestCancelSale(item.saleId);
              }}
            >
              Cancelar
            </CancelButton>
          )}

          {!isSale && (
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

  const [openingBalance, setOpeningBalance] = useState("");
  const [declaredClose, setDeclaredClose] = useState("");
  const [expenses, setExpenses] = useState("");
  const [registerName, setRegisterName] = useState("");

  const [registerMessage, setRegisterMessage] = useState(null);

  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");

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

  const fetchData = useCallback(async () => {
    setLoading(true);

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
      setLoading(false);
    }
  }, [cashier?.id, cashier?.role]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handleSaleRegistered = () => fetchData();
    window.addEventListener("sale-registered", handleSaleRegistered);
    return () =>
      window.removeEventListener("sale-registered", handleSaleRegistered);
  }, [fetchData]);

  // Un solo pase O(n) sobre las ventas para los 3 métodos de pago
  // (antes eran 3 useMemo que filtraban la lista completa por cada render).
  const { totalCash, totalCard, totalTransfer } = useMemo(() => {
    let cash = 0;
    let card = 0;
    let transfer = 0;

    for (const sale of sales) {
      if (sale.status === "cancelado") continue;

      const amount = Number(sale.total || 0);

      if (sale.payment_method === "cash") cash += amount;
      else if (sale.payment_method === "card") card += amount;
      else if (sale.payment_method === "transfer") transfer += amount;
    }

    return { totalCash: cash, totalCard: card, totalTransfer: transfer };
  }, [sales]);

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
      totalCash -
      Number(register.expenses || 0)
    );
  }, [register, totalCash]);

  const cashInRegister = expectedClose;

  const handleOpenRegister = async () => {
    const result = await window.api.invoke("open-cash-register", {
      openingBalance: parseFloat(openingBalance) || 0,
      cashierId: cashier?.id,
      role: cashier?.role,
    });

    if (result.success) {
      setOpenRegisterModal(false);
      setOpeningBalance("");

      await fetchData();

      setRegisterMessage({
        type: "success",
        text: "Caja abierta exitosamente.",
      });
    } else {
      setRegisterMessage({
        type: "error",
        text: result.error,
      });
    }
  };

  const handleCloseRegister = async () => {
    const result = await window.api.invoke("close-cash-register", {
      declaredClose: parseFloat(declaredClose) || 0,

      expenses: parseFloat(expenses) || 0,

      name: registerName.trim() || register?.opener_name || "Cierre sin nombre",

      cashierId: cashier?.id,
      role: cashier?.role,
    });

    if (result.success) {
      setCloseRegisterModal(false);
      setRegisterName("");
      setDeclaredClose("");
      setExpenses("");

      await fetchData();

      setRegisterMessage({
        type: "success",
        text:
          `Caja cerrada. Esperado: $${Number(result.expectedClose || 0).toFixed(
            2,
          )}, ` + `Diferencia: $${Number(result.difference || 0).toFixed(2)}`,
      });
    } else {
      setRegisterMessage({
        type: "error",
        text: result.error,
      });
    }
  };

  const handleRegisterExpense = async () => {
    const amount = parseFloat(withdrawAmount);

    if (!amount || amount <= 0) {
      setRegisterMessage({
        type: "error",
        text: "Ingresa un monto válido.",
      });
      return;
    }

    if (!withdrawReason.trim()) {
      setRegisterMessage({
        type: "error",
        text: "Ingresa el motivo del retiro.",
      });
      return;
    }

    setWithdrawLoading(true);

    try {
      const result = await window.api.invoke("register-cash-expense", {
        amount,
        reason: withdrawReason.trim(),
        cashierId: cashier?.id,
        role: cashier?.role,
      });

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
            `Retiro de $${amount.toFixed(2)} registrado: ` +
            withdrawReason.trim(),
        });
      } else {
        setRegisterMessage({
          type: "error",
          text: result.error,
        });
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

  const handleCancelSaleItem = async () => {
    if (!cancelItemData) return;

    setCancelItemLoading(true);

    try {
      const result = await window.api.invoke("cancel-sale-item", {
        saleId: cancelItemData.saleId,
        itemId: cancelItemData.itemId,
        quantity: cancelItemData.qty,
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

        const refundText = `$${Number(result.refundAmount || 0).toFixed(2)}`;
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
        setRegisterMessage({
          type: "error",
          text: result.error,
        });
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
          text: "Gasto cancelado correctamente.",
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

  const printDailyReport = async () => {
    const store = await window.api.invoke("get-setting", "store_name");

    const storeName = store || "MI TIENDA POS";

    const now = new Date();

    const today = now.toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Mexico_City",
    });

    const methodNames = {
      cash: "Efectivo",
      card: "Tarjeta",
      transfer: "Transferencia",
    };

    const expensesHtml =
      expensesList.length > 0
        ? `
          <div class="section-title">
            Gastos / Egresos
          </div>

          <table>
            <tr>
              <th>#</th>
              <th>Hora</th>
              <th>Motivo</th>
              <th>Monto</th>
            </tr>

            ${expensesList
              .map(
                (expense, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${formatMXTime(expense.created_at)}</td>
                    <td>${expense.reason}</td>
                    <td align="right">
                      $${Number(expense.amount).toFixed(2)}
                    </td>
                  </tr>
                `,
              )
              .join("")}

            <tr class="total-row">
              <td colspan="3">
                TOTAL GASTOS
              </td>
              <td align="right">
                $${totalExpenses.toFixed(2)}
              </td>
            </tr>
          </table>
        `
        : "";

    const win = window.open("", "_blank");

    if (!win) return;

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reporte Diario</title>

        <style>
          body {
            font-family:
              'Segoe UI',
              Arial,
              sans-serif;

            margin: 30px 40px;
            color: #1e293b;
            font-size: 13px;
          }

          h1 {
            font-size: 22px;
            margin-bottom: 2px;
            letter-spacing: .5px;
          }

          .subtitle {
            font-size: 13px;
            color: #64748b;
            margin-top: 0;
            margin-bottom: 20px;
          }

          hr {
            border: none;
            border-top: 2px solid #2563eb;
            margin: 15px 0;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 12px;
          }

          th {
            background: #1e3a5f;
            color: white;
            padding: 8px 10px;
            text-align: left;
          }

          td {
            padding: 7px 10px;
            border-bottom: 1px solid #e2e8f0;
          }

          tr:nth-child(even) {
            background: #f8fafc;
          }

          .total-row td {
            background: #1e3a5f;
            color: white;
            font-weight: 700;
          }

          .resumen-table td {
            padding: 5px 10px;
            border: none;
          }

          .section-title {
            font-size: 14px;
            font-weight: 700;
            color: #1e3a5f;
            margin: 18px 0 6px;
          }

          .footer {
            text-align: center;
            margin-top: 35px;
            color: #94a3b8;
            font-size: 11px;
            border-top: 1px solid #e2e8f0;
            padding-top: 12px;
          }

          .signature {
            display: flex;
            justify-content: space-around;
            margin-top: 40px;
          }

          .sig-box {
            text-align: center;
            width: 200px;
          }

          .sig-line {
            display: block;
            border-top: 2px solid #1e293b;
            margin-top: 40px;
            padding-top: 6px;
            font-size: 12px;
            color: #1e293b;
          }

          @media print {
            body {
              margin: .5in;
            }

            .no-print {
              display: none;
            }
          }
        </style>
      </head>

      <body>

        <h1>
          ${storeName.toUpperCase()}
        </h1>

        <p class="subtitle">
          Reporte Diario — ${today}
        </p>

        <hr>

        <div class="section-title">
          Ventas del Día
        </div>

        <table>
          <tr>
            <th>#</th>
            <th>Hora</th>
            <th>Método</th>
            <th>Total</th>
          </tr>

          ${sales
            .filter((sale) => sale.status !== "cancelado")
            .map(
              (sale, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${formatMXTime(sale.created_at)}</td>
                  <td>
                    ${methodNames[sale.payment_method] || sale.payment_method}
                  </td>
                  <td align="right">
                    $${Number(sale.total).toFixed(2)}
                  </td>
                </tr>
              `,
            )
            .join("")}

          <tr class="total-row">
            <td colspan="3">
              TOTAL VENTAS
            </td>

            <td align="right">
              $${totalSales.toFixed(2)}
            </td>
          </tr>
        </table>

        ${expensesHtml}

        <hr>

        <div class="section-title">
          Resumen Final
        </div>

        <table class="resumen-table">
          <tr>
            <td>Ventas Totales</td>
            <td align="right">
              $${totalSales.toFixed(2)}
            </td>
          </tr>

          <tr>
            <td>Total Gastos</td>
            <td align="right">
              -$${totalExpenses.toFixed(2)}
            </td>
          </tr>

          <tr>
            <td>
              <strong>
                GANANCIA DEL DÍA
              </strong>
            </td>

            <td align="right">
              <strong>
                $${(totalSales - totalExpenses).toFixed(2)}
              </strong>
            </td>
          </tr>
        </table>

        <div class="section-title">
          Desglose por método
        </div>

        <table class="resumen-table">
          <tr>
            <td>Efectivo</td>
            <td align="right">
              $${totalCash.toFixed(2)}
            </td>
          </tr>

          <tr>
            <td>Tarjeta</td>
            <td align="right">
              $${totalCard.toFixed(2)}
            </td>
          </tr>

          <tr>
            <td>Transferencia</td>
            <td align="right">
              $${totalTransfer.toFixed(2)}
            </td>
          </tr>
        </table>

        ${
          register
            ? `
              <div class="section-title">
                Control de Caja
              </div>

              <table class="resumen-table">
                <tr>
                  <td>Apertura</td>
                  <td align="right">
                    $${Number(register.opening_balance || 0).toFixed(2)}
                  </td>
                </tr>

                <tr>
                  <td>Efectivo en caja</td>
                  <td align="right">
                    $${cashInRegister.toFixed(2)}
                  </td>
                </tr>

                <tr>
                  <td>
                    <strong>
                      Cierre esperado
                    </strong>
                  </td>

                  <td align="right">
                    <strong>
                      $${expectedClose.toFixed(2)}
                    </strong>
                  </td>
                </tr>
              </table>
            `
            : ""
        }

        <div class="signature">
          <div class="sig-box">
            <span class="sig-line">Cajero</span>
          </div>
          <div class="sig-box">
            <span class="sig-line">Supervisor</span>
          </div>
        </div>

        <div class="footer">
          Generado el
          ${formatMXDateTime(now)}
          — JRP POS
        </div>

      </body>
      </html>
    `);

    win.document.close();
    win.print();
  };

  const exportDailyPDF = async () => {
    const store = await window.api.invoke("get-setting", "store_name");

    const storeName = store || "MI TIENDA POS";

    const doc = new jsPDF();

    const pageW = doc.internal.pageSize.getWidth();

    const margin = 18;

    doc.setFontSize(18);
    doc.setFont(undefined, "bold");

    doc.text(storeName.toUpperCase(), margin, 22);

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");

    doc.text(
      `Reporte Diario — ${new Date().toLocaleDateString("es-MX")}`,
      margin,
      29,
    );

    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.8);

    doc.line(margin, 33, pageW - margin, 33);

    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.setTextColor(30);

    doc.text("VENTAS DEL DÍA", margin, 44);

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
        `$${Number(sale.total).toFixed(2)}`,
      ]);

    doc.autoTable({
      head: [["#", "Hora", "Método", "Total"]],

      body: saleRows,

      startY: 48,

      margin: {
        left: margin,
        right: margin,
      },

      styles: {
        fontSize: 8,
        cellPadding: 2,
      },

      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: "bold",
      },

      alternateRowStyles: {
        fillColor: [245, 247, 250],
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
          `$${totalSales.toFixed(2)}`,
        ],
      ],
    });

    let yy = doc.lastAutoTable.finalY + 8;

    if (expensesList.length > 0) {
      doc.setFontSize(12);
      doc.setFont(undefined, "bold");

      doc.text("GASTOS / EGRESOS", margin, yy);

      yy += 4;

      const expRows = expensesList.map((expense, index) => [
        index + 1,
        formatMXTime(expense.created_at),
        expense.reason,
        `$${Number(expense.amount).toFixed(2)}`,
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
          fontSize: 8,
          cellPadding: 2,
        },

        headStyles: {
          fillColor: [239, 68, 68],
          textColor: 255,
          fontStyle: "bold",
        },

        alternateRowStyles: {
          fillColor: [255, 245, 245],
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
            `$${totalExpenses.toFixed(2)}`,
          ],
        ],
      });

      yy = doc.lastAutoTable.finalY + 8;
    }

    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.5);

    doc.line(margin, yy, pageW - margin, yy);

    yy += 7;

    doc.setFontSize(14);
    doc.setFont(undefined, "bold");

    doc.text("RESUMEN FINAL", margin, yy);

    yy += 8;

    const summaryRows = [
      ["Ventas Totales", `$${totalSales.toFixed(2)}`],
      ["Total Gastos", `-$${totalExpenses.toFixed(2)}`],
      ["GANANCIA DEL DÍA", `$${(totalSales - totalExpenses).toFixed(2)}`],
    ];

    if (register) {
      summaryRows.push(
        [
          "Apertura de caja",
          `$${Number(register.opening_balance || 0).toFixed(2)}`,
        ],
        ["Efectivo en caja", `$${cashInRegister.toFixed(2)}`],
        ["Cierre esperado", `$${expectedClose.toFixed(2)}`],
      );
    }

    doc.autoTable({
      body: summaryRows,

      startY: yy,

      margin: {
        left: margin + 10,
        right: margin + 10,
      },

      styles: {
        fontSize: 9,
        cellPadding: 2.5,
      },

      columnStyles: {
        0: {
          fontStyle: "bold",
          cellWidth: 80,
        },

        1: {
          fontStyle: "bold",
          halign: "right",
          cellWidth: 50,
        },
      },

      theme: "plain",
    });

    yy = doc.lastAutoTable.finalY + 8;

    doc.setFontSize(10);
    doc.setFont(undefined, "bold");

    doc.text("Desglose por método:", margin + 10, yy);

    yy += 6;

    [
      ["Efectivo", `$${totalCash.toFixed(2)}`],
      ["Tarjeta", `$${totalCard.toFixed(2)}`],
      ["Transferencia", `$${totalTransfer.toFixed(2)}`],
    ].forEach(([label, value]) => {
      doc.setFont(undefined, "normal");

      doc.text(label, margin + 16, yy);

      doc.setFont(undefined, "bold");

      doc.text(value, pageW - margin - 16, yy, {
        align: "right",
      });

      yy += 5;
    });

    yy += 8;

    doc.setDrawColor(200);
    doc.setLineWidth(0.3);

    doc.line(margin, yy, pageW - margin, yy);

    yy += 8;

    doc.setFontSize(9);
    doc.setFont(undefined, "normal");

    doc.text("Cajero: ___________________", margin + 10, yy);

    doc.text("Supervisor: ___________________", pageW / 2 + 5, yy);

    yy += 14;

    doc.setFontSize(8);
    doc.setTextColor(150);

    doc.text(`Generado el ${new Date().toLocaleString("es-MX")}`, margin, yy);

    doc.setFont(undefined, "bold");

    doc.text("JRP POS", pageW - margin, yy, {
      align: "right",
    });

    doc.save(`reporte-diario-${mxToday()}.pdf`);
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
                `${product.name}${product.qty > 1 ? ` x${product.qty}` : ""}`,
            )
            .join(", ");

          return {
            type: "sale",
            id: `sale-${sale.id}`,
            saleId: sale.id,
            status: sale.status,
            title: `Venta #${sale.id}`,
            desc: [method, productsText].filter(Boolean).join(" · "),
            time: sale.created_at,
            amount: Number(sale.total || 0),
            icon: ShoppingCart,
            items: sale.items || [],
          };
        }),

        ...expensesList.map((expense) => ({
          type: "expense",
          id: `expense-${expense.id}`,
          expenseId: expense.id,
          title: expense.reason?.startsWith("Compra")
            ? "Compra de inventario"
            : "Retiro de efectivo",
          desc: expense.reason,
          time: expense.created_at,
          amount: -Number(expense.amount || 0),
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
      const target = turnoFilter === "ingresos" ? "sale" : "expense";
      items = items.filter((item) => item.type === target);
    }
    if (q) {
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.desc.toLowerCase().includes(q) ||
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
        if (item.type === "sale" && item.status !== "cancelado") {
          setCancelSaleData({ id: item.saleId });
        } else if (item.type === "expense") {
          setCancelExpenseData({
            id: item.expenseId,
            amount: Math.abs(item.amount),
            reason: item.desc,
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

  const openCancelItemForm = useCallback(
    (it) => {
      if (cancelItemLoading) return;
      if (!saleDetailData) return;

      const isWeightItem = it.sale_unit === "weight";
      const returned = Number(it.returned_qty || 0);
      const active = Math.max(0, Number(it.quantity || 0) - returned);
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

  const handleRequestCancelSale = useCallback(
    (saleId) => setCancelSaleData({ id: saleId }),
    [],
  );

  const handleRequestCancelExpense = useCallback(
    (item) =>
      setCancelExpenseData({
        id: item.expenseId,
        amount: Math.abs(item.amount),
        reason: item.desc,
      }),
    [],
  );

  const statusBanner = !register
    ? {
        bg: "rgba(217,119,6,.12)",
        color: "#d97706",
        icon: TriangleAlert,
        title: "Sin apertura de caja",
        subtitle: prevRegister
          ? `El corte anterior se cerró con $${Number(
              prevRegister.declared_close || 0,
            ).toFixed(2)}. Abre una caja para comenzar a vender.`
          : "Abre una caja para comenzar a vender.",
      }
    : isOpen
      ? {
          bg: "rgba(16,185,129,.12)",
          color: "#059669",
          icon: CircleCheck,
          title: "Caja abierta",
          subtitle:
            String(register.opened_by) === String(cashier?.id) ||
            String(register.cashier_id) === String(cashier?.id)
              ? `Abierta a las ${formatMXTime(register.opened_at)}`
              : `Abierta por: ${register.opener_name || "otro usuario"}`,
        }
      : {
          bg: "rgba(100,116,139,.12)",
          color: "hsl(var(--muted-foreground))",
          icon: Lock,
          title: "Caja cerrada",
          subtitle: prevRegister
            ? `El corte anterior se cerró con $${Number(
                prevRegister.declared_close || 0,
              ).toFixed(2)}. Abre una caja para comenzar a registrar ventas.`
            : "Abre una caja para comenzar a registrar ventas.",
        };

  const StatusIcon = statusBanner.icon;

  // Comparamos el efectivo declarado contra el efectivo que debería haber:
  // apertura + ventas en efectivo - egresos YA registrados en el sistema
  // (retiros hechos durante el turno) - el gasto adicional que se esté
  // capturando ahora mismo en el campo "Gastos / Egresos" del cierre.
  // Si el esperado sale negativo, la declaración reduce la deuda en lugar
  // de sumarse encima (esperado + declarado).
  const baseExpected =
    Number(register?.opening_balance || 0) +
    totalCash -
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
    } else if (action === "withdraw") {
      if (!canManageRegister) {
        setRegisterMessage({
          type: "error",
          text: "No hay caja abierta para retirar efectivo",
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
      setWithdrawDialogOpen(true);
    }
  }, [loading, canManageRegister]);

  const summaryCards = [
    {
      label: "Ventas totales",
      value: `$${totalSales.toFixed(2)}`,
      icon: Banknote,
      color: "#059669",
      bg: "rgba(16,185,129,.12)",
    },
    {
      label: "Transacciones",
      value: salesCount,
      icon: Receipt,
      color: "#0d9488",
      bg: "rgba(13,148,136,.12)",
    },
    {
      label: "Efectivo en caja",
      value: isOpen ? `$${cashInRegister.toFixed(2)}` : "$0.00",
      icon: Landmark,
      color: "#d97706",
      bg: "rgba(217,119,6,.12)",
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

  const filterChips = [
    { value: "todos", label: "Todos" },
    { value: "ingresos", label: "Ingresos" },
    { value: "egresos", label: "Egresos" },
  ];

  return (
    <div className="fade-in p-1">
      {/* HEADER */}
      <div className="mb-2 flex items-end justify-between">
        <div>
          <h2 className="text-[1.8rem] font-extrabold leading-tight">Caja</h2>

          <p className="mt-0.5 flex items-center gap-0.5 text-xs text-muted-foreground">
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
          </p>
        </div>
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

      {/* STATUS */}
      <Card className="mb-2">
        <CardContent className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
              style={{ background: statusBanner.bg }}
            >
              <StatusIcon size={23} style={{ color: statusBanner.color }} />
            </div>

            <div>
              <p className="font-bold leading-tight">{statusBanner.title}</p>

              <p className="mt-0.5 block text-xs text-muted-foreground">
                {statusBanner.subtitle}
              </p>
            </div>
          </div>

          {isOpen && (
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={exportDailyPDF}
                  >
                    <Download size={17} />
                    <span className="sr-only">Exportar PDF</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exportar PDF</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={printDailyReport}
                  >
                    <Printer size={17} />
                    <span className="sr-only">Imprimir reporte</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Imprimir reporte</TooltipContent>
              </Tooltip>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TOP SUMMARY */}
      {loading ? (
        <CardSkeleton count={3} />
      ) : (
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          {summaryCards.map((item, i) => {
            const Icon = item.icon;

            return (
              <Card
                key={item.label}
                className={cn(
                  "fade-in-up transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                  `stagger-${i + 1}`,
                )}
              >
                <CardContent className="flex items-center gap-2 px-3 py-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: item.bg }}
                  >
                    <Icon size={21} style={{ color: item.color }} />
                  </div>

                  <div className="min-w-0">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                      {item.label}
                    </p>

                    <p className="truncate text-lg font-bold leading-tight tabular-nums">
                      {item.value}
                    </p>
                  </div>
                </CardContent>
              </Card>
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
      {!isOpen && (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => {
              setOpeningBalance(
                prevRegister?.declared_close
                  ? String(prevRegister.declared_close)
                  : "",
              );

              setOpenRegisterModal(true);
            }}
          >
            <Store size={17} />
            Abrir caja
          </Button>
        </div>
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
            {/* ACCIONES */}
            {canManageRegister && (
              <div className="mb-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setWithdrawAmount("");
                    setWithdrawReason("");
                    setWithdrawDialogOpen(true);
                  }}
                >
                  <Wallet size={17} />
                  Retirar dinero
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
              </div>
            )}

            {/* MOVIMIENTOS DEL TURNO */}
            <Card>
              <CardContent className="py-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-1.5 text-base font-bold">
                    <Activity size={19} />
                    Movimientos del turno

                    <Badge
                      variant="secondary"
                      className="ml-1 shrink-0 tabular-nums"
                    >
                      {filteredTurnoItems.length}
                    </Badge>
                  </h3>

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
                        placeholder="Buscar producto..."
                        className="h-9 w-[200px] pl-9"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      {filterChips.map((chip) => (
                        <button
                          key={chip.value}
                          onClick={() => setTurnoFilter(chip.value)}
                          className={cn(
                            "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            turnoFilter === chip.value
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
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
                    className="max-h-[400px] overflow-y-auto rounded-lg border"
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
                            onRequestCancelSale={handleRequestCancelSale}
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
            <Card>
              <CardContent className="px-4 py-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-base font-bold">
                  <Landmark size={18} />
                  Resumen de caja
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* DESGLOSE DE VENTAS */}
                  <div className="overflow-hidden rounded-xl border">
                    <div className="border-b bg-muted px-3 py-2">
                      <p className="text-xs font-extrabold uppercase tracking-[0.07em]">
                        Desglose de ventas
                      </p>
                    </div>

                    {/* Ventas Totales: suma de TODOS los métodos de pago.
                        No confundir con el efectivo físico en caja. */}
                    <div className="flex items-center justify-between border-b bg-blue-50 px-3 py-2.5 dark:bg-blue-500/10">
                      <span className="flex items-center gap-2 text-sm font-bold">
                        <ShoppingCart size={17} className="text-primary" />
                        Ventas Totales
                      </span>

                      <span className="text-sm font-extrabold text-primary tabular-nums">
                        ${totalSales.toFixed(2)}
                      </span>
                    </div>

                    {[
                      {
                        label: "Efectivo",
                        value: totalCash,
                        icon: Banknote,
                        color: "#059669",
                      },
                      {
                        label: "Tarjeta",
                        value: totalCard,
                        icon: CreditCard,
                        color: "#4f46e5",
                      },
                      {
                        label: "Transferencia",
                        value: totalTransfer,
                        icon: Landmark,
                        color: "#d97706",
                      },
                    ].map((item) => {
                      const Icon = item.icon;

                      return (
                        <div
                          key={item.label}
                          className="flex items-center justify-between border-b px-3 py-2.5 last:border-b-0"
                        >
                          <span className="flex items-center gap-2 text-sm">
                            <Icon size={17} style={{ color: item.color }} />
                            {item.label}
                          </span>

                          <span className="text-sm font-bold tabular-nums">
                            ${item.value.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* CONTROL DE CAJA */}
                  <div className="overflow-hidden rounded-xl border">
                    <div className="border-b bg-muted px-3 py-2">
                      <p className="text-xs font-extrabold uppercase tracking-[0.07em]">
                        Control de caja
                      </p>
                    </div>

                    {[
                      [
                        "Apertura",
                        `$${Number(register.opening_balance || 0).toFixed(2)}`,
                      ],
                      ["Ventas en efectivo", `+$${totalCash.toFixed(2)}`],
                      [
                        "Gastos",
                        `-$${Number(register.expenses || 0).toFixed(2)}`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex justify-between border-b px-3 py-2.5"
                      >
                        <span className="text-sm text-muted-foreground">
                          {label}
                        </span>

                        <span className="text-sm font-bold tabular-nums">
                          {value}
                        </span>
                      </div>
                    ))}

                    <div className="flex items-center justify-between bg-teal-50 px-3 py-3 dark:bg-teal-500/10">
                      <span className="text-sm font-extrabold">
                        Cierre esperado
                      </span>

                      <span className="text-base font-extrabold text-teal-600 tabular-nums dark:text-teal-400">
                        ${expectedClose.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* OPEN REGISTER */}
      <Dialog
        open={openRegisterModal}
        onOpenChange={(open) => {
          if (!open) setOpenRegisterModal(false);
        }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleOpenRegister();
          }}
        >
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <Store size={20} className="text-primary" />
            </div>

            <div>
              <DialogTitle className="text-base font-extrabold">
                Abrir caja
              </DialogTitle>

              <DialogDescription className="text-xs leading-relaxed">
                Ingresa el monto inicial en efectivo para abrir la caja del día.
              </DialogDescription>
            </div>
          </DialogHeader>

          <Separator />

          <div>
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

          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => setOpenRegisterModal(false)}
            >
              Cancelar
            </Button>

            <Button
              onClick={handleOpenRegister}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <CircleCheck size={18} />
              Abrir caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CLOSE REGISTER */}
      <Dialog
        open={closeRegisterModal}
        onOpenChange={(open) => {
          if (!open) setCloseRegisterModal(false);
        }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleCloseRegister();
          }}
        >
          <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
              <Wallet size={20} className="text-warning" />
            </div>

            <div>
              <DialogTitle className="text-base font-extrabold">
                Cerrar caja
              </DialogTitle>

              <DialogDescription className="text-xs leading-relaxed">
                Ingresa el efectivo final y los gastos del día para realizar el
                cierre.
              </DialogDescription>
            </div>
          </DialogHeader>

          <Separator />

          <div className="space-y-3">
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
          <div className="rounded-lg border border-amber-300/30 bg-amber-50 p-4 dark:bg-amber-500/10">
            <p className="mb-3 block text-xs font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Resumen del cierre
            </p>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Cierre esperado
                </span>

                <span className="text-sm font-bold tabular-nums">
                  $
                  {(
                    Number(register?.opening_balance || 0) +
                    totalCash -
                    Number(register?.expenses || 0) -
                    (parseFloat(expenses) || 0)
                  ).toFixed(2)}
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
                  ${(parseFloat(declaredClose) || 0).toFixed(2)}
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
                  ${Math.abs(openCloseDifference).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <CancelButton onClick={() => setCloseRegisterModal(false)}>
              Cancelar
            </CancelButton>

            <Button
              variant="outline"
              onClick={handleCloseRegister}
              className="border-amber-600 bg-amber-500/10 text-amber-600 hover:border-amber-600 hover:bg-amber-500/20 hover:text-amber-600 dark:border-amber-500 dark:text-amber-400 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:hover:text-amber-300"
            >
              <CircleCheck size={18} />
              Cerrar caja
            </Button>
          </DialogFooter>
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
              <Wallet size={20} className="text-destructive" />
            </div>

            <div>
              <DialogTitle className="text-base font-extrabold">
                Retirar dinero
              </DialogTitle>

              <DialogDescription className="text-xs leading-relaxed">
                Registra una salida de efectivo. Se agregará a los gastos del
                día.
              </DialogDescription>
            </div>
          </DialogHeader>

          <Separator />

          <Alert variant="default" className="mb-5 rounded-lg py-2.5">
            <Info size={16} className="text-info" />
            <AlertDescription>Aquí solo retiros por otras salidas.</AlertDescription>
          </Alert>

          <div className="space-y-3">
            <div>
              <FieldLabel>Motivo del retiro</FieldLabel>

              <div className="relative">
                <Receipt
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  value={withdrawReason}
                  autoFocus
                  disabled={withdrawLoading}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Ej: Pago a proveedor..."
                  className="pl-9"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Monto a retirar</FieldLabel>

              <div className="relative">
                <Banknote
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />

                <Input
                  type="number"
                  value={withdrawAmount}
                  disabled={withdrawLoading}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-md border px-3 py-2">
              <Banknote size={15} className="text-muted-foreground" />

              <p className="text-sm text-muted-foreground">
                Disponible en caja:{" "}
                <b className="text-foreground tabular-nums">
                  ${cashInRegister.toFixed(2)}
                </b>
              </p>
            </div>
          </div>

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
              className="border-red-600 bg-red-500/10 text-red-600 hover:border-red-600 hover:bg-red-500/20 hover:text-red-600 dark:border-red-500 dark:text-red-400 dark:hover:border-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-300"
            >
              {withdrawLoading ? (
                <>
                  <Spinner size={18} />
                  Registrando...
                </>
              ) : (
                <>
                  <CircleCheck size={18} />
                  Confirmar retiro
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
                    .map((p) => `${p.name}${p.qty > 1 ? ` x${p.qty}` : ""}`)
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
                        ${Number(sale.total || 0).toFixed(2)}
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
          <SheetHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Receipt size={20} className="text-primary" />
              </div>

              <div>
                <SheetTitle className="text-base font-bold">
                  Detalle de venta #{saleDetailSale?.id}
                </SheetTitle>

                <SheetDescription className="text-xs">
                  {saleDetailSale &&
                    `${formatMXDateTime(saleDetailSale.created_at)} · ${
                      methodLabels[saleDetailSale.payment_method] ||
                      saleDetailSale.payment_method
                    }`}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {saleDetailSale && (
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
                          const active = Math.max(
                            0,
                            Number(it.quantity || 0) - returned,
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
                                x{active}
                              </TableCell>

                              <TableCell className="text-right font-semibold tabular-nums">
                                ${activeSubtotal.toFixed(2)}
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

                {/* DEVOLUCIÓN INLINE */}
                {cancelItemData && (() => {
                const isW = cancelItemData.isWeightItem;
                const minQty = isW ? 0.001 : 1;
                return (
                  <div className="mt-4 space-y-3 rounded-lg border border-red-500/20 bg-red-50/60 p-3 dark:bg-red-500/5">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <PackageX size={18} className="shrink-0 text-destructive" />

                      <div>
                        <p className="text-base font-bold">
                          Devolución de {cancelItemData.itemName}
                        </p>

                        <p className="text-sm font-semibold text-muted-foreground">
                          {isW
                            ? `${fmtKg(cancelItemData.itemQty)} kg disponible(s) · $${cancelItemData.itemPrice.toFixed(2)}/kg`
                            : `${cancelItemData.itemQty} unidad(es) disponible(s) · $${cancelItemData.itemPrice.toFixed(2)} c/u`}
                          {cancelItemData.itemDiscount > 0 &&
                            ` · desc. ${cancelItemData.itemDiscount}%`}
                        </p>
                      </div>
                    </div>

                    <div>
                      <span className="mb-1.5 block text-center text-sm font-bold text-muted-foreground">
                        {isW
                          ? "¿Cuántos kg cancelar?"
                          : "¿Cuántas unidades cancelar?"}
                      </span>

                      <div className="flex items-center justify-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={
                            cancelItemLoading || cancelItemData.qty <= minQty
                          }
                          onClick={() =>
                            setCancelItemData((p) =>
                              p
                                ? {
                                    ...p,
                                    qty: isW
                                      ? round3(
                                          Math.max(minQty, p.qty - 0.1),
                                        )
                                      : Math.max(1, p.qty - 1),
                                  }
                                : p,
                            )
                          }
                          aria-label="Restar unidad"
                        >
                          <Minus size={14} />
                        </Button>

                        <Input
                          type="number"
                          inputMode={isW ? "decimal" : "numeric"}
                          min={minQty}
                          max={cancelItemData.itemQty}
                          step={isW ? 0.001 : 1}
                          value={cancelItemData.qty}
                          disabled={cancelItemLoading}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (isW) {
                              if (raw.trim() === "") return;
                              const parsed = parseFloat(raw);
                              if (Number.isNaN(parsed) || parsed < 0) return;
                              setCancelItemData((p) =>
                                p ? { ...p, qty: round3(parsed) } : p,
                              );
                            } else {
                              const v = Math.min(
                                cancelItemData.itemQty,
                                Math.max(1, parseInt(raw, 10) || 1),
                              );
                              setCancelItemData((p) =>
                                p ? { ...p, qty: v } : p,
                              );
                            }
                          }}
                          onBlur={
                            isW
                              ? () =>
                                  setCancelItemData((p) =>
                                    p
                                      ? {
                                          ...p,
                                          qty: round3(
                                            Math.min(
                                              p.itemQty,
                                              Math.max(0.001, p.qty),
                                            ),
                                          ),
                                        }
                                      : p,
                                  )
                              : undefined
                          }
                          className={cn(
                            "text-center text-sm font-bold tabular-nums",
                            isW ? "h-10 w-24" : "h-8 w-16",
                          )}
                          aria-label="Cantidad a cancelar"
                        />

                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={
                            cancelItemLoading ||
                            cancelItemData.qty >= cancelItemData.itemQty
                          }
                          onClick={() =>
                            setCancelItemData((p) =>
                              p
                                ? {
                                    ...p,
                                    qty: isW
                                      ? Math.min(
                                          p.itemQty,
                                          round3(p.qty + 0.1),
                                        )
                                      : Math.min(p.itemQty, p.qty + 1),
                                  }
                                : p,
                            )
                          }
                          aria-label="Sumar unidad"
                        >
                          <Plus size={14} />
                        </Button>

                        <span className="inline-flex h-8 items-center text-sm font-bold text-muted-foreground">
                          de{" "}
                          {isW
                            ? `${fmtKg(cancelItemData.itemQty)} kg`
                            : cancelItemData.itemQty}
                        </span>
                      </div>
                    </div>

                    {(isW || cancelItemData.itemQty > 1) && (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {(isW ? cancelItemData.itemQty > 1 : true) && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="lg"
                            className="text-base"
                            disabled={
                              cancelItemLoading || cancelItemData.qty === 1
                            }
                            onClick={() =>
                              setCancelItemData((p) =>
                                p ? { ...p, qty: 1 } : p,
                              )
                            }
                          >
                            Cancelar 1{isW ? " kg" : ""}
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          className="text-base"
                          disabled={
                            cancelItemLoading ||
                            cancelItemData.qty === cancelItemData.itemQty
                          }
                          onClick={() =>
                            setCancelItemData((p) =>
                              p ? { ...p, qty: p.itemQty } : p,
                            )
                          }
                        >
                          Cancelar todas (
                          {isW
                            ? `${fmtKg(cancelItemData.itemQty)} kg`
                            : cancelItemData.itemQty}
                          )
                        </Button>
                      </div>
                    )}

                    {(() => {
                      const refund =
                        cancelItemData.itemPrice *
                        cancelItemData.qty *
                        (1 - cancelItemData.itemDiscount / 100);
                      const newTotal =
                        Number(saleDetailSale?.total || 0) - refund;

                      return (
                        <div className="space-y-1.5 rounded-lg border bg-background px-3 py-2.5">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Devolución
                            </span>

                            <span className="font-bold tabular-nums text-destructive">
                              −${refund.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Stock a restaurar
                            </span>

                            <span className="font-bold tabular-nums">
                              +{isW ? fmtKg(cancelItemData.qty) : cancelItemData.qty}
                              {isW ? " kg" : ""}
                            </span>
                          </div>

                          <Separator className="my-1" />

                          <div className="flex justify-between text-sm">
                            <span className="font-semibold">
                              Nuevo total ticket
                            </span>

                            <span className="font-extrabold tabular-nums">
                              ${newTotal.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {cancelItemData.qty < cancelItemData.itemQty && (
                      <Alert variant="warning" className="rounded-lg py-2">
                        <Info size={15} className="text-warning" />
                        <AlertDescription>
                          Quedarán{" "}
                          {isW
                            ? `${fmtKg(
                                cancelItemData.itemQty - cancelItemData.qty,
                              )} kg`
                            : `${cancelItemData.itemQty - cancelItemData.qty} unidad(es)`}{" "}
                          de este producto en la venta.
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                      <CancelButton
                        disabled={cancelItemLoading}
                        onClick={() => setCancelItemData(null)}
                      >
                        Cancelar
                      </CancelButton>

                      <Button
                        variant="destructive"
                        disabled={cancelItemLoading}
                        onClick={handleCancelSaleItem}
                      >
                        {cancelItemLoading ? (
                          <Spinner size={16} />
                        ) : (
                          "Confirmar devolución"
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
                  Total: ${Number(saleDetailSale.total || 0).toFixed(2)}
                </p>
              </>
            )}
          </div>

          <SheetFooter className="sm:justify-between">
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
              Cancelar gasto
            </DialogTitle>
          </DialogHeader>

          <DialogDescription className="leading-relaxed">
            Se quitará el gasto{" "}
            {cancelExpenseData?.reason && (
              <strong className="text-foreground">
                "{cancelExpenseData.reason}"
              </strong>
            )}{" "}
            por ${Number(cancelExpenseData?.amount || 0).toFixed(2)} de la
            caja. Esta acción no se puede deshacer.
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