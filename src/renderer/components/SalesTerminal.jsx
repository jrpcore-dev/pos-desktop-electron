import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useCashier } from "../contexts/CashierContext";
import { useDbChanges } from "../lib/useDbChanges";
import {
  ShoppingCart,
  Trash2,
  CreditCard,
  DollarSign,
  Landmark,
  Banknote,
  UserPlus,
  X,
} from "lucide-react";
import CartItem from "./CartItem";
import CartTabs from "./CartTabs";
import SearchSection from "./SearchSection";
import FastCashDialog from "./FastCashDialog";
import WeightDialog from "./WeightDialog";
import BoxChoiceDialog from "./BoxChoiceDialog";
import QtyDialog from "./QtyDialog";
import DiscountDialog from "./DiscountDialog";
import ManualProductDialog from "./ManualProductDialog";
import CustomerSearchDialog from "./CustomerSearchDialog";
import { useMultiCart } from "./cart/useMultiCart";
import { Button as ShadButton } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Spinner } from "./ui/spinner";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./ui/resizable";
import { cn } from "@/lib/utils";
import { useToast } from "./ToastProvider";
import { useNavigate } from "react-router-dom";
import { isContainerUnit, unitLabels } from "../utils/unitLabels";
import {
  calcFinalPrice,
  canManualDiscount,
  lineKeyOf,
  packPriceOf,
  piecePriceOf,
  promoInfo,
  lineTotal,
  lineUnitPrice,
  committedStockFor,
  customerPriceForLine,
} from "../utils/cartMath";
import { buildReceiptHTML } from "../utils/receiptTemplate";
import { prepareTicketLogo } from "../utils/logo";
import { fmtMoney, fmtMoneyAbs } from "../utils/format";
import { setSaleInProgress } from "../utils/posState";
import {
  getScaleConfig,
  isScaleEnabled,
  toDriverConfig,
} from "../utils/scaleConfig";

let roundEnabled = true;
let roundStep = 0.5;
let allowSaleWithoutStock = false;

const applyRoundingConfig = (enabled, mode) => {
  roundEnabled = enabled !== false;
  const step = parseFloat(mode);
  roundStep = Number.isFinite(step) && step > 0 ? step : 0.5;
};

const roundCash = (amount) => {
  if (!roundEnabled || !roundStep) return amount;
  return Number((Math.round(amount / roundStep) * roundStep).toFixed(2));
};

const noRound = (amount) => amount;

// Estilo reutilizable para las teclas de atajo (barra de contexto + botón
// Cobrar). Piso de 11px, sombra apagada para que la tecla se lea como hint,
// no como un botón con elevación.
const HINT_KBD_CLS =
  "h-auto rounded border-border px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground shadow-none";

const parseQtyPrefix = (str) => {
  const m = /^(\d+)\*(.+)$/.exec(str);
  if (m) {
    const qty = parseInt(m[1], 10);
    return { qty: qty >= 1 ? qty : 1, rest: m[2].trim() };
  }
  return { qty: null, rest: str };
};


const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
};

const useIsDark = () => {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() =>
      setIsDark(root.classList.contains("dark")),
    );
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
};

const lastSavedPaymentMethod = () => {
  try {
    const stored = localStorage.getItem("lastPaymentMethod");
    return ["cash", "card", "transfer"].includes(stored) ? stored : "";
  } catch {
    return "";
  }
};

const SalesTerminal = () => {
  const { cashier } = useCashier();
  const notify = useToast();
  const navigate = useNavigate();
  const [barcode, setBarcode] = useState("");
  const {
    carts,
    activeIndex,
    cart,
    setCart,
    paymentMethod,
    setPaymentMethod,
    customer,
    pricing,
    setCustomer,
    newSale,
    switchCart,
    cancelCart,
  } = useMultiCart();
  const lastRegisterWarnRef = useRef(0);
  // Bloque 5 · folio real de la última venta (el que devuelve el Host o la
  // cola offline). Solo cambia DE DÓNDE sale el número del ticket.
  const lastSaleFolioRef = useRef(null);
  // Bloque 4 · última caja abierta conocida: viaja en la venta offline para
  // que el Host sepa a qué corte pertenece.
  const lastRegisterRef = useRef(null);
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [change, setChange] = useState(0);
  const [waitingDrawer, setWaitingDrawer] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // 3d · versión local del catálogo. Sube con `db-changed` (venta local o
  // réplica) y relanza la búsqueda abierta para que sugerencias/precios no
  // queden desfasados. NO toca el carrito.
  const [catalogVersion, setCatalogVersion] = useState(0);
  useDbChanges(
    useCallback(() => setCatalogVersion((v) => v + 1), []),
    ["products", "product_prices", "customers", "customer_prices", "tier_prices"],
  );
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [manualProductModalOpen, setManualProductModalOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [manualProduct, setManualProduct] = useState({ name: "", price: "" });
  const [pendingQty, setPendingQty] = useState(1);
  const [qtyDialogOpen, setQtyDialogOpen] = useState(false);
  const [qtyInput, setQtyInput] = useState("");
  const [storeSettings, setStoreSettings] = useState({
    name: "MI TIENDA POS",
    website: "www.mitienda.com",
    logo: "",
  });
  const [receiptNotes, setReceiptNotes] = useState({ header: "", footer: "" });
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimedOut, setSearchTimedOut] = useState(false);
  const [weightDialog, setWeightDialog] = useState({
    open: false,
    product: null,
  });
  const [weightAmount, setWeightAmount] = useState("");
  const [scaleLive, setScaleLive] = useState(null);
  const manualWeightRef = useRef(false);
  const [boxChoiceDialog, setBoxChoiceDialog] = useState({
    open: false,
    product: null,
    qty: 1,
  });
  const [discountDialog, setDiscountDialog] = useState({
    open: false,
    item: null,
  });
  const [discountValue, setDiscountValue] = useState("");
  const [printing, setPrinting] = useState(false);
  const suggestionListRef = useRef(null);
  const cartRef = useRef(cart);
  const lastEscRef = useRef(0);
  const saleKeyLockRef = useRef(0);
  const lastDiscountItemKeyRef = useRef(null);
  const isDark = useIsDark();
  const isXLargeScreen = useMediaQuery("(min-width: 1536px)");
  const isLargeScreen = useMediaQuery("(min-width: 1200px)");
  const isMediumScreen = useMediaQuery("(min-width: 900px)");
  const isSmallScreen = useMediaQuery("(max-width: 600px)");
  const DRAWER_WIDTH = isXLargeScreen ? 490 : isLargeScreen ? 430 : isMediumScreen ? 350 : isSmallScreen ? 270 : 310;
  const hasCart = cart.length > 0;
  const [cartWidth, setCartWidth] = useState(() => {
    const saved = localStorage.getItem("cartWidth");
    return saved ? parseInt(saved, 10) : 0;
  });
  const effectiveCartWidth = cartWidth || DRAWER_WIDTH;
  useEffect(() => {
    if (cartWidth > 0) localStorage.setItem("cartWidth", String(cartWidth));
  }, [cartWidth]);
  const handleCartResize = useCallback((size) => {
    if (size > 0) setCartWidth(size);
  }, []);
  const [selectedCartItemIndex, setSelectedCartItemIndex] = useState(-1);
  const [focusZone, setFocusZone] = useState("search");
  const [cartFlashKey, setCartFlashKey] = useState(null);

  // Limpia el flash de confirmación tras 600 ms para que no se quede pegado.
  useEffect(() => {
    if (!cartFlashKey) return;
    const t = setTimeout(() => setCartFlashKey(null), 600);
    return () => clearTimeout(t);
  }, [cartFlashKey]);

const processSaleRef = useRef(null);

  const cartSummary = useMemo(() => {
    const subtotal = cart.reduce(
      (s, item) => s + item.price * (item.quantity || 1),
      0,
    );
    const total = cart.reduce(
      (s, item) => s + lineTotal(item, item.quantity || 1),
      0,
    );
    const discountTotal = Math.max(0, subtotal - total);

    return {
      subtotal,
      total,
      discountTotal
    };
  }, [cart]);

  const subtotal = cartSummary.subtotal;
  const total = cartSummary.total;

  const isCashPayment = paymentMethod === "cash";
  const displaySubtotal = isCashPayment
    ? roundCash(cartSummary.subtotal)
    : cartSummary.subtotal;
  const displayTotal = isCashPayment
    ? roundCash(cartSummary.total)
    : cartSummary.total;
  const displayDiscountTotal = displaySubtotal - displayTotal;

  const paymentLabel =
    paymentMethod === "cash"
      ? "Efectivo"
      : paymentMethod === "card"
        ? "Tarjeta"
        : paymentMethod === "transfer"
          ? "Transferencia"
          : "Sin método";
  const itemCount = `${cart.length} ${cart.length === 1 ? "producto" : "productos"}`;

  // Acento de la caja TOTAL: wash primary tenue + borde tintado para que el
  // monto se lea como el "héroe" de la pantalla sin ruido (1px, sin sombra).
  // El fondo calmado y el borde fino la separan de Subtotal/Descuentos, que
  // son filas de texto sin caja.
  const totalAccentClass = "bg-primary/[0.05] border-primary/30";
  const totalValueClass = "text-foreground";

  const [removingKeys, setRemovingKeys] = useState(() => new Set());

  const processSale = async (method) => {
    const registerOpen = await checkRegisterOpen();
    if (!registerOpen) {
      warnRegisterClosed();
      return;
    }
    const cartForSale = cart.map((it) => ({
      ...it,
      finalPrice: lineUnitPrice(it, it.quantity),
      // Con precio de cliente el % de la promoción no se aplicó.
      ...(it.customerPriced ? { discount_percent: 0 } : {}),
    }));
    const result = await window.api.invoke("record-sale", {
      cart: cartForSale,
      total: method === "cash" ? roundCash(cartSummary.total) : cartSummary.total,
      paymentMethod: method,
      discountTotal: cartSummary.discountTotal,
      cashierName: cashier?.name || "Usuario Principal",
      cashierId: cashier?.id ?? null,
      customerId: customer?.id ?? null,
      registerId: lastRegisterRef.current?.id ?? null,
    });
    if (result.success) {
      lastSaleFolioRef.current = result.folio || null;
      if (result.offline) {
        showNotification(
          "Host sin conexión: la venta quedó guardada y se subirá sola al reconectar.",
          "warning",
        );
      }
      if (method === "cash") {
        setWaitingDrawer(true);
      } else {
        setCart([]);
        setCustomer(null, null);
        setPaymentMethod(lastSavedPaymentMethod());
        setCashDialogOpen(false);
        setCashAmount("");
        setChange(0);
        setBarcode("");
      }
      window.dispatchEvent(new CustomEvent("sale-registered"));
      showNotification("Venta registrada exitosamente", "success");
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const stockWarns = warnings.filter((w) => w && w.code === "STOCK_NEGATIVE");
      const custWarns = warnings.filter((w) => w && w.code === "CUSTOMER_NOT_FOUND");
      if (stockWarns.length > 0) {
        const detail = stockWarns
          .map((w) => `«${w.name}» quedó con stock ${w.stock_after} en el sistema`)
          .join(". ");
        showNotification(`${detail}. Ajusta el inventario.`, "warning");
      }
      if (custWarns.length > 0) {
        showNotification("Cliente no encontrado; la venta se guardó sin cliente.", "warning");
      }
      try {
        const printEnabled = await window.api.invoke("get-setting", "print_enabled");
        if (printEnabled === "false") {
          window.api
            .invoke("open-cash-drawer")
            .catch((e) => console.error("[DRAWER]", e));
          return;
        }
        setPrinting(true);
        try {
          const paperWidthMm = await window.api.invoke(
            "get-setting",
            "paper_width_mm",
          );
          const text = generateReceiptHTML(method, paperWidthMm);
          const printResult = await window.api.invoke("print-receipt", text);
          if (printResult?.success) {
            // Si la impresora configurada no existía en este equipo, el main
            // cayó a la predeterminada del sistema: avisar al cajero.
            if (printResult.fellBack) {
              showNotification(
                `La impresora configurada no está disponible; se imprimió en «${printResult.printer}».`,
                "warning",
              );
            }
            if (method === "card" || method === "transfer") {
              const setting = await window.api.invoke(
                "get-setting",
                "print_two_tickets",
              );
              if (setting === "true") {
                await window.api.invoke(
                  "print-receipt",
                  generateReceiptHTML(method, paperWidthMm),
                );
              }
            }
          } else {
            console.error("[PRINT]", printResult?.error);
            showNotification(
              printResult?.error || "No se pudo imprimir el ticket",
              "error",
            );
          }
        } catch (e) {
          console.error("[PRINT]", e);
          showNotification("No se pudo imprimir el ticket", "error");
        }
        setPrinting(false);
      } catch (e) {
        console.error("[PRINT]", e);
      }
    } else {
      showNotification(result.error || "Error al registrar la venta", "error");
    }
  };

  // Ajustes de la tienda, del ticket y del POS. Se releen al montar y cada
  // vez que cambian (guardados aquí, o replicados desde el Host en una caja).
  const loadSettings = useCallback(async () => {
    try {
      const name = await window.api.invoke("get-setting", "store_name");
      const website = await window.api.invoke("get-setting", "store_website");
      const logo = await window.api.invoke("get-setting", "store_logo");
      const headerNote = await window.api.invoke(
        "get-setting",
        "print_header_note"
      );
      const footerNote = await window.api.invoke(
        "get-setting",
        "print_footer_note"
      );
      const roundingEnabled = await window.api.invoke(
        "get-setting",
        "rounding_enabled"
      );
      const roundingMode = await window.api.invoke(
        "get-setting",
        "rounding_mode"
      );
      const saleWithoutStock = await window.api.invoke(
        "get-setting",
        "sale_without_stock"
      );
      if (name)
        setStoreSettings((prev) => ({ ...prev, name: name.toUpperCase() }));
      if (website) setStoreSettings((prev) => ({ ...prev, website }));
      if (logo) {
        const trimmed = await prepareTicketLogo(logo);
        setStoreSettings((prev) => ({ ...prev, logo: trimmed }));
      }
      setReceiptNotes({
        header: headerNote || "",
        footer: footerNote || "",
      });
      if (roundingEnabled !== null || roundingMode !== null) {
        applyRoundingConfig(
          roundingEnabled === null ? true : roundingEnabled !== "false",
          roundingMode === null ? "0.50" : roundingMode
        );
      }
      allowSaleWithoutStock = saleWithoutStock === "true";
    } catch (e) {}
  }, []);
  useDbChanges(loadSettings, ["settings"]);

  useEffect(() => {
    loadSettings();

    const handleSettingsUpdated = (event) => {
      const { storeName, storeLogo } = event.detail || {};
      if (storeName) setStoreSettings((prev) => ({ ...prev, name: storeName.toUpperCase() }));
      if (typeof storeLogo === "string") setStoreSettings((prev) => ({ ...prev, logo: storeLogo }));
    };
    const handlePosSettingsUpdated = (event) => {
      const { roundingEnabled, roundingMode, saleWithoutStock } =
        event.detail || {};
      if (roundingEnabled !== undefined || roundingMode !== undefined) {
        applyRoundingConfig(
          roundingEnabled === undefined ? roundEnabled : roundingEnabled,
          roundingMode === undefined ? roundStep : roundingMode
        );
      }
      if (saleWithoutStock !== undefined) {
        allowSaleWithoutStock = saleWithoutStock === true;
      }
    };
    window.addEventListener("storeSettingsUpdated", handleSettingsUpdated);
    window.addEventListener("posSettingsUpdated", handlePosSettingsUpdated);
    return () => {
      window.removeEventListener("storeSettingsUpdated", handleSettingsUpdated);
      window.removeEventListener("posSettingsUpdated", handlePosSettingsUpdated);
    };
  }, [loadSettings]);

  useEffect(() => {
    cartRef.current = cart;
    processSaleRef.current = processSale;
  }, [cart, processSale]);

  useEffect(() => {
    if (cart.length === 0) {
      setSelectedCartItemIndex(-1);
      setFocusZone("search");
    }
  }, [cart.length]);

  const cartOpsRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const barcodeInput = document.getElementById("barcode-input");
      const isBarcodeFocused = document.activeElement?.id === "barcode-input";
      const el = e.target;
      const isEditable =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.tagName === "SELECT" ||
        el?.isContentEditable;
      const isEnter = e.key === "Enter";
      const isModalExiting = !!document.querySelector(
        '[data-state="closed"].dialog-content',
      );
      const isInteractiveTarget = isEditable || el?.tagName === "BUTTON";
      const now = Date.now();
      const saleKeyLocked = isEnter && now < saleKeyLockRef.current;

      // Cualquier diálogo abierto (incluido el de cliente, que antes no estaba)
      // o una impresión/cobro en curso invalidan todos los atajos de función.
      const anyDialogOpen =
        cashDialogOpen ||
        discountDialog.open ||
        boxChoiceDialog.open ||
        weightDialog.open ||
        manualProductModalOpen ||
        qtyDialogOpen ||
        customerDialogOpen ||
        !!document.querySelector(
          '[data-state="open"].dialog-content, [data-state="open"].sheet-content-right',
        );

      if (anyDialogOpen || printing) {
        if (isEnter || e.key === "Escape")
          saleKeyLockRef.current = now + 200;
        return;
      }

      if (!isBarcodeFocused && !isEditable && !e.ctrlKey && !e.metaKey) {
        if (e.key === "F5") {
          e.preventDefault();
          barcodeInput?.focus();
          return;
        }
        if (e.key.length === 1 && /[\w\d]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          barcodeInput?.focus();
          setBarcode((prev) => prev + e.key);
          return;
        }
      }

      if (e.key === "F8" &&
        cartRef.current.length > 0 &&
        !saleKeyLocked &&
        !isInteractiveTarget) {
        e.preventDefault();
        if (paymentMethod === "cash") {
          saleKeyLockRef.current = now + 600;
          setCashDialogOpen(true);
        } else if (paymentMethod) {
          saleKeyLockRef.current = now + 600;
          processSaleRef.current(paymentMethod);
        } else {
          showNotification(
            "Seleccione un método de pago en el carrito",
            "warning",
          );
        }
      }
      if (e.key === "F4") {
        e.preventDefault();
        const lastItem = cartRef.current?.[cartRef.current.length - 1];
        if (lastItem && !lastItem.isWeightItem) {
          cartOpsRef.current?.updateQuantity(lastItem, 1);
        }
      }
      if (e.key === "F3") {
        e.preventDefault();
        const lastItem = cartRef.current?.[cartRef.current.length - 1];
        if (lastItem && !lastItem.isWeightItem) {
          cartOpsRef.current?.updateQuantity(lastItem, -1);
        }
      }
      if (e.key === "q" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.getElementById("barcode-input")?.focus();
        setFocusZone("search");
      }
      if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        navigate("/servicios");
      }
      if (e.key === "F2") {
        e.preventDefault();
        setManualProductModalOpen(true);
      }
      if (e.key === "F9") {
        e.preventDefault();
        setQtyInput(pendingQty === 1 ? "" : String(pendingQty));
        setQtyDialogOpen(true);
      }
      if (e.key === "F7") {
        e.preventDefault();
        const cart = cartRef.current;
        if (cart.length > 0) {
          const lastItem = cart[cart.length - 1];
          cartOpsRef.current?.removeFromCart(lastItem);
        }
      }
      if (e.key === "F6") {
        e.preventDefault();
        const eligible = cartRef.current.filter(canManualDiscount);
        if (eligible.length === 0) {
          showNotification(
            "No hay productos con descuento manual en el carrito",
            "info",
          );
          return;
        }
        const currentIdx = eligible.findIndex(
          (i) => lineKeyOf(i) === lastDiscountItemKeyRef.current,
        );
        const next = currentIdx === -1 ? 0 : (currentIdx + 1) % eligible.length;
        const target = eligible[next];
        lastDiscountItemKeyRef.current = lineKeyOf(target);
        setDiscountValue(
          target.discount > 0 ? String(target.discount.toFixed(2)) : "",
        );
        setDiscountDialog({ open: true, item: target });
      }
      if (e.key === "F11") {
        e.preventDefault();
        if (now < saleKeyLockRef.current) return;
        if (cartRef.current.length > 0) {
          showNotification(
            "Termina la venta actual antes de cerrar la caja",
            "warning",
          );
          return;
        }
        saleKeyLockRef.current = now + 600;
        localStorage.setItem("eodPendingAction", "close-register");
        navigate("/end-of-day");
      }
      if (e.key === "F10") {
        e.preventDefault();
        if (now < saleKeyLockRef.current) return;
        // Mismo criterio que F11: no abrir un corte de caja con la venta a medias.
        if (cartRef.current.length > 0) {
          showNotification(
            "Termina la venta actual antes de retirar de caja",
            "warning",
          );
          return;
        }
        saleKeyLockRef.current = now + 600;
        localStorage.setItem("eodPendingAction", "withdraw");
        navigate("/end-of-day");
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (focusZone === "search" && cartRef.current.length > 0) {
          setFocusZone("cart");
          setSelectedCartItemIndex(0);
          document.getElementById("barcode-input")?.blur();
        } else if (focusZone === "cart" || focusZone === "payment") {
          setSelectedCartItemIndex(-1);
          setFocusZone("search");
          document.getElementById("barcode-input")?.focus();
        }
      }

      if (e.key === "Escape" && !isEditable) {
        if (focusZone === "cart" || focusZone === "payment") {
          e.preventDefault();
          setSelectedCartItemIndex(-1);
          setFocusZone("search");
          document.getElementById("barcode-input")?.focus();
        } else if (document.activeElement?.id !== "barcode-input") {
          e.preventDefault();
          const now = Date.now();
          if (now - lastEscRef.current < 400) {
            cartOpsRef.current?.setCart([]);
            cartOpsRef.current?.setPaymentMethod("");
            showNotification("Carrito limpiado", "success");
          }
          lastEscRef.current = now;
        }
      }

      if (focusZone === "cart" && cartRef.current.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (selectedCartItemIndex >= cartRef.current.length - 1) {
            setFocusZone("payment");
          } else {
            setSelectedCartItemIndex((prev) => prev + 1);
          }
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedCartItemIndex((prev) =>
            prev > 0 ? prev - 1 : cartRef.current.length - 1,
          );
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const item = cartRef.current[selectedCartItemIndex];
          if (item && !item.isWeightItem) {
            cartOpsRef.current?.updateQuantity(item, 1);
          }
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const item = cartRef.current[selectedCartItemIndex];
          if (item && !item.isWeightItem) {
            cartOpsRef.current?.updateQuantity(item, -1);
          }
        }
        if (e.key === "Enter" &&
          !isBarcodeFocused &&
          paymentMethod &&
          !saleKeyLocked &&
          !isInteractiveTarget &&
          !isModalExiting) {
          e.preventDefault();
          saleKeyLockRef.current = now + 600;
          if (paymentMethod === "cash") {
            setCashDialogOpen(true);
          } else {
            processSaleRef.current(paymentMethod);
          }
        }
      }

      if (focusZone === "payment") {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("cart");
          setSelectedCartItemIndex(cartRef.current.length - 1);
        }
if (e.key === "Tab" && !isEditable) {
          e.preventDefault();
          setFocusZone("search");
          document.getElementById("barcode-input")?.focus();
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          cartOpsRef.current?.setPaymentMethod((prev) =>
            prev === "cash" ? "card" : prev === "card" ? "transfer" : "cash",
          );
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          cartOpsRef.current?.setPaymentMethod((prev) =>
            prev === "cash" ? "transfer" : prev === "transfer" ? "card" : "cash",
          );
        }
        if (e.key === "Enter" &&
          !isBarcodeFocused &&
          !saleKeyLocked &&
          !isInteractiveTarget &&
          !isModalExiting) {
          e.preventDefault();
          saleKeyLockRef.current = now + 600;
          if (paymentMethod === "cash") {
            setCashDialogOpen(true);
          } else if (paymentMethod) {
            processSaleRef.current(paymentMethod);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    paymentMethod,
    navigate,
    focusZone,
    selectedCartItemIndex,
    cashDialogOpen,
    discountDialog.open,
    boxChoiceDialog.open,
    weightDialog.open,
    manualProductModalOpen,
    qtyDialogOpen,
    customerDialogOpen,
    printing,
    pendingQty,
  ]);

  // Publica si hay una venta en curso para que los atajos globales sensibles
  // (F12 = cerrar sesión en Layout) puedan pedir confirmación.
  useEffect(() => {
    setSaleInProgress(cart.length > 0);
    return () => setSaleInProgress(false);
  }, [cart.length]);

  useEffect(() => {
    if (!weightDialog.open || !weightDialog.product) return;
    // Caja sin báscula: el peso se captura a mano, sin tocar el puerto.
    if (!isScaleEnabled()) return;
    let cancelled = false;

    manualWeightRef.current = false;
    setScaleLive(null);

    // Si el cajero escribe un peso a mano, la báscula ya no lo sobrescribe.
    const unsub = window.api.on("weight-update", (data) => {
      if (cancelled || manualWeightRef.current) return;
      if (data.overload) {
        setScaleLive({ stable: false, overload: true });
        return;
      }
      if (data.weight >= 0) setWeightAmount(data.weight.toFixed(3));
      setScaleLive({ stable: data.stable !== false, overload: false });
    });

    (async () => {
      try {
        const cfg = getScaleConfig();
        if (!cfg.port) return;
        await window.api.invoke(
          "start-weight-stream",
          cfg.port,
          toDriverConfig(cfg),
        );
      } catch (e) {}
    })();

    return () => {
      cancelled = true;
      unsub();
      setScaleLive(null);
      window.api.invoke("stop-weight-stream");
    };
  }, [weightDialog.open, weightDialog.product]);

  useEffect(() => {
    const searchQuery = barcode.replace(/^\d+\*/g, "");
    if (/^CLI-/i.test(searchQuery)) {
      setSearchResults([]);
      setShowSuggestions(false);
      setIsSearching(false);
      setSearchTimedOut(false);
      return;
    }
    const isNumeric = /^\d+$/.test(searchQuery);
    const minChars = isNumeric ? 5 : 3;
    if (searchQuery.length < minChars) {
      setSearchResults([]);
      setShowSuggestions(false);
      setIsSearching(false);
      setSearchTimedOut(false);
      return;
    }

    let cancelled = false;
    const runSearch = async () => {
      setIsSearching(true);
      setSearchTimedOut(false);
      setShowSuggestions(false);
      const timeout = setTimeout(() => {
        if (cancelled) return;
        setIsSearching(false);
        setSearchTimedOut(true);
      }, 3000);
      try {
        const products = await window.api.invoke("search-products", searchQuery);
        if (cancelled) return;
        clearTimeout(timeout);
        setSearchResults(products);
        setShowSuggestions(products.length > 0);
        setIsSearching(false);
      } catch (e) {
        if (cancelled) return;
        clearTimeout(timeout);
        setSearchResults([]);
        setShowSuggestions(false);
        setIsSearching(false);
      }
    };

    const debounceTimer = setTimeout(runSearch, 200);
    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
    // catalogVersion: si el catálogo cambia con la búsqueda abierta, se vuelve
    // a consultar para que el precio/stock mostrados no queden viejos.
  }, [barcode, catalogVersion]);

  useEffect(() => {
    if (selectedSuggestionIndex < 0) return;
    const el =
      suggestionListRef.current?.querySelectorAll("[data-suggestion-idx]")[
        selectedSuggestionIndex
      ];
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedSuggestionIndex, searchResults]);

  const showNotification = useCallback(
    (message, severity = "info") => {
      notify(message, severity);
    },
    [notify],
  );

  const repriceCart = (nextPricing) => {
    setCart((prev) =>
      prev.map((it) => {
        if (it.isManual || typeof it.id !== "number") return it;
        const catalog = it.catalogPrice ?? it.price;
        const special = customerPriceForLine(it, nextPricing, {
          isBox: it.isBoxItem,
          isPack: it.isPackItem,
        });
        const base = special ?? catalog;
        const customerPriced = special != null;
        if (base === it.price && customerPriced === !!it.customerPriced) return it;
        return {
          ...it,
          price: base,
          customerPriced,
          finalPrice: customerPriced
            ? base
            : calcFinalPrice(base, it.discount_percent),
        };
      }),
    );
  };

  const selectCustomer = async (found) => {
    try {
      const res = await window.api.invoke("get-customer-pricing", found.id);
      if (!res.success || !res.customer) {
        showNotification("Cliente no encontrado", "error");
        return;
      }
      const nextPricing = {
        exceptions: res.exceptions || {},
        tierPrices: res.tierPrices || {},
      };
      setCustomer(res.customer, nextPricing);
      repriceCart(nextPricing);
      window.api.invoke("touch-customer", res.customer.id);
      showNotification(`${res.customer.name} seleccionado`, "success");
    } catch {
      showNotification("No se pudo cargar el cliente", "error");
    }
  };

  const clearCustomer = () => {
    setCustomer(null, null);
    repriceCart(null);
  };

  const checkRegisterOpen = async () => {
    try {
      const res = await window.api.invoke("get-cash-register-status", {
        cashierId: cashier?.id,
        role: cashier?.role,
      });
      if (res.success && res.register) lastRegisterRef.current = res.register;
      return !!(res.success && res.register && res.register.status === "open");
    } catch {
      return false;
    }
  };

  const warnRegisterClosed = () => {
    const now = Date.now();
    if (now - lastRegisterWarnRef.current < 5000) return;
    lastRegisterWarnRef.current = now;
    notify("Abre la caja para completar la venta", "warning");
  };

  const clearSearch = () => {
    setBarcode("");
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    refocusBarcode();
  };

  const addProductToCart = (product, qtyOverride) => {
    checkRegisterOpen().then((open) => {
      if (!open) warnRegisterClosed();
    });
    const qty = qtyOverride ?? pendingQty;
    if (product.sale_unit === "weight" && !product.isManual) {
      setPendingQty(1);
      setWeightAmount("");
      setWeightDialog({ open: true, product });
      return;
    }
    if (
      (isContainerUnit(product.sale_unit) || product.pack_qty > 0) &&
      !product.isManual
    ) {
      setPendingQty(1);
      setBoxChoiceDialog({ open: true, product, qty });
      return;
    }
    const special = customerPriceForLine(product, pricing);
    const basePrice = special ?? product.price;
    const effectivePrice =
      special ?? calcFinalPrice(basePrice, product.discount_percent);
    const productWithDiscount = {
      ...product,
      price: basePrice,
      finalPrice: effectivePrice,
      catalogPrice: product.price,
      customerPriced: special != null,
    };

    if (product.isManual) {
      setCart((prev) => {
        const existingIndex = prev.findIndex(
          (item) => item.id === product.id || item.name === product.name,
        );
        if (existingIndex !== -1) {
          const updatedCart = [...prev];
          updatedCart[existingIndex] = {
            ...updatedCart[existingIndex],
            quantity: updatedCart[existingIndex].quantity + qty,
          };
          return updatedCart;
        }
        return [...prev, { ...productWithDiscount, quantity: qty }];
      });
      if (qty !== 1) setPendingQty(1);
      setCartFlashKey(lineKeyOf(product));
      clearSearch();
      showNotification(`${product.name} agregado al carrito`, "success");
      return;
    }
    if (!allowSaleWithoutStock && product.stock <= 0) {
      showNotification("Producto sin stock", "error");
      return;
    }
    if (
      !allowSaleWithoutStock &&
      product.stock - committedStockFor(product, cartRef.current) < 1
    ) {
      showNotification("Stock insuficiente", "warning");
      return;
    }
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === product.id);
      if (existingIndex !== -1) {
        const updatedCart = [...prev];
        updatedCart[existingIndex] = {
          ...updatedCart[existingIndex],
          quantity: updatedCart[existingIndex].quantity + qty,
        };
        return updatedCart;
      }
      return [...prev, { ...productWithDiscount, quantity: qty }];
    });
    if (qty !== 1) setPendingQty(1);
    setCartFlashKey(lineKeyOf(productWithDiscount));
    clearSearch();
    showNotification(`${product.name} agregado al carrito`, "success");
  };

  const confirmWeightProduct = () => {
    const { product } = weightDialog;
    const kg = parseFloat(weightAmount) || 0;
    if (kg <= 0) return;
    if (
      !allowSaleWithoutStock &&
      product.stock - committedStockFor(product, cartRef.current) < kg
    ) {
      setWeightDialog({ open: false, product: null });
      setWeightAmount("");
      refocusBarcode();
      showNotification("Stock insuficiente", "warning");
      return;
    }
    const weightSpecial = customerPriceForLine(product, pricing);
    const weightBase = weightSpecial ?? product.price;
    const effectivePrice =
      weightSpecial ?? calcFinalPrice(weightBase, product.discount_percent);
    const productWithWeight = {
      ...product,
      price: weightBase,
      finalPrice: effectivePrice,
      catalogPrice: product.price,
      customerPriced: weightSpecial != null,
      quantity: kg,
      isWeightItem: true,
    };
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.id === product.id && item.isWeightItem,
      );
      if (existingIndex !== -1) {
        const updatedCart = [...prev];
        updatedCart[existingIndex] = {
          ...updatedCart[existingIndex],
          quantity: updatedCart[existingIndex].quantity + kg,
        };
        return updatedCart;
      }
      return [...prev, productWithWeight];
    });
    setWeightDialog({ open: false, product: null });
    setWeightAmount("");
    clearSearch();
    showNotification(
      `${kg.toFixed(3)} kg de ${product.name} agregado`,
      "success",
    );
  };

  const confirmBoxChoice = (choice) => {
    const { product, qty = 1 } = boxChoiceDialog;
    const isBox = choice === "box";
    const isPack = choice === "pack";
    const containerNoun =
      unitLabels(product.sale_unit)?.containerNoun || "Caja";
    const needPieces = isBox
      ? product.box_qty || 1
      : isPack
        ? product.pack_qty || 1
        : 1;
    if (
      !allowSaleWithoutStock &&
      product.stock - committedStockFor(product, cartRef.current) <
        needPieces * qty
    ) {
      setBoxChoiceDialog({ open: false, product: null });
      refocusBarcode();
      showNotification("Stock insuficiente", "warning");
      return;
    }
    const chosenUnitPrice = isBox
      ? product.box_price
      : isPack
        ? packPriceOf(product)
        : piecePriceOf(product);
    const lineSpecial = customerPriceForLine(product, pricing, { isBox, isPack });
    const unitPrice = lineSpecial ?? chosenUnitPrice;
    const effectivePrice =
      lineSpecial ?? calcFinalPrice(unitPrice, product.discount_percent);
    const item = {
      ...product,
      finalPrice: effectivePrice,
      quantity: qty,
      isBoxItem: isBox,
      isPackItem: isPack,
      price: unitPrice,
      catalogPrice: chosenUnitPrice,
      customerPriced: lineSpecial != null,
      prices: product.prices || [],
    };
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (i) =>
          i.id === product.id &&
          i.isBoxItem === isBox &&
          i.isPackItem === isPack,
      );
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + qty,
        };
        return updated;
      }
      return [...prev, item];
    });
    setBoxChoiceDialog({ open: false, product: null });
    clearSearch();
    showNotification(
      `${isBox ? containerNoun : isPack ? "Paquete" : "Pieza"} de ${product.name} agregado`,
      "success",
    );
  };

  const handleBarcodeSubmit = async (event) => {
    const rawValue = event.target?.value ?? barcode;
    const trimmedValue = rawValue.trim();
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (trimmedValue === "") return;
      setShowSuggestions(false);
      const { qty, rest } = parseQtyPrefix(trimmedValue);
      if (rest === "") {
        setBarcode("");
        setSelectedSuggestionIndex(-1);
        showNotification("Producto no encontrado", "error");
        return;
      }
      if (/^CLI-/i.test(rest)) {
        setBarcode("");
        setSelectedSuggestionIndex(-1);
        const res = await window.api.invoke("get-customer-by-qr", rest);
        if (res.success && res.customer) {
          await selectCustomer(res.customer);
        } else {
          showNotification("Cliente no encontrado", "error");
        }
        return;
      }
      if (
        selectedSuggestionIndex >= 0 &&
        searchResults[selectedSuggestionIndex]
      ) {
        addProductToCart(searchResults[selectedSuggestionIndex], qty ?? undefined);
        return;
      }
      const { success, product } = await window.api.invoke(
        "get-product-by-barcode",
        rest,
      );
      if (success && product) {
        addProductToCart(product, qty ?? undefined);
      } else if (qty && searchResults.length > 0) {
        addProductToCart(searchResults[0], qty);
      } else {
        setBarcode("");
        setSelectedSuggestionIndex(-1);
        showNotification("Producto no encontrado", "error");
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      if (showSuggestions && searchResults.length > 0) {
        setSelectedSuggestionIndex((prev) =>
          prev < searchResults.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (showSuggestions && searchResults.length > 0) {
        setSelectedSuggestionIndex((prev) =>
          prev > 0 ? prev - 1 : searchResults.length - 1,
        );
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleManualProduct = () => {
    if (manualProduct.name && manualProduct.price) {
      const newProduct = {
        id: `manual-${Date.now()}`,
        name: manualProduct.name,
        price: parseFloat(manualProduct.price),
        finalPrice: parseFloat(manualProduct.price),
        discount_percent: 0,
        has_discount: 0,
        barcode: "SIN CÓDIGO",
        stock: 999,
        isManual: true,
      };
      addProductToCart(newProduct);
      setManualProduct({ name: "", price: "" });
      setManualProductModalOpen(false);
      refocusBarcode();
    }
  };

  const refocusBarcode = () => {
    setTimeout(() => {
      document.getElementById("barcode-input")?.focus();
    }, 150);
  };

  const resetSearchState = () => {
    setBarcode("");
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    setSelectedCartItemIndex(-1);
    setFocusZone("search");
  };

  const handleNewSale = () => {
    newSale();
    resetSearchState();
    refocusBarcode();
  };

  const handleSwitchCart = (index) => {
    switchCart(index);
    resetSearchState();
    refocusBarcode();
  };

  const handleCancelCart = (index) => {
    cancelCart(index);
    resetSearchState();
    refocusBarcode();
  };

  const updateQuantity = useCallback((item, delta) => {
    setCart((prev) =>
      prev
        .map((it) => {
          if (
            it.id !== item.id ||
            it.isBoxItem !== item.isBoxItem ||
            it.isPackItem !== item.isPackItem
          )
            return it;
          const step = it.isWeightItem ? 0.1 : 1;
          const newQty = it.quantity + delta * step;
          if (newQty <= 0) return null;
          const qty = allowSaleWithoutStock
            ? newQty
            : Math.min(newQty, it.stock || 999);
          const disc = it.discount || 0;
          const fp =
            disc > 0 && qty > 0
              ? (it.price * qty - disc) / qty
              : it.finalPrice;
          return { ...it, quantity: qty, finalPrice: fp };
        })
        .filter(Boolean),
    );
  }, [setCart]);

  const removeFromCart = useCallback(
    (item) => {
      setCart((prev) =>
        prev.filter(
          (it) =>
            it.id !== item.id ||
            it.isBoxItem !== item.isBoxItem ||
            it.isPackItem !== item.isPackItem,
        ),
      );
      showNotification("Producto eliminado del carrito", "info");
    },
    [setCart, showNotification],
  );

  const removeWithCollapse = useCallback(
    (item) => {
      const key = lineKeyOf(item);
      setRemovingKeys((prev) => new Set(prev).add(key));
      window.setTimeout(() => {
        removeFromCart(item);
        setRemovingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 240);
    },
    [removeFromCart],
  );

  useEffect(() => {
    cartOpsRef.current = { setCart, setPaymentMethod, updateQuantity, removeFromCart };
  }, [setCart, setPaymentMethod, updateQuantity, removeFromCart]);

  const applyDiscount = (item, amount) => {
    setCart((prev) =>
      prev.map((it) => {
        if (lineKeyOf(it) !== lineKeyOf(item)) return it;
        const qty = it.quantity || 1;
        const max = it.price * qty;
        const discount = Math.min(Math.max(parseFloat(amount) || 0, 0), max);
        const fp = discount > 0 ? (it.price * qty - discount) / qty : it.price;
        return { ...it, discount, finalPrice: fp };
      }),
    );
  };

  const clearDiscount = (item) => {
    setCart((prev) =>
      prev.map((it) => {
        if (lineKeyOf(it) !== lineKeyOf(item)) return it;
        const fp =
          it.discount_percent > 0 && !it.customerPriced
            ? calcFinalPrice(it.price, it.discount_percent)
            : it.price;
        return { ...it, discount: 0, finalPrice: fp };
      }),
    );
  };

  const openDiscountDialog = useCallback((item) => {
    lastDiscountItemKeyRef.current = lineKeyOf(item);
    setDiscountValue(item.discount > 0 ? String(item.discount.toFixed(2)) : "");
    setDiscountDialog({ open: true, item });
  }, []);

  const onSelectItem = useCallback((i) => {
    setSelectedCartItemIndex(i);
    setFocusZone("cart");
  }, []);

  const handleDiscountApply = () => {
    const item = discountDialog.item;
    if (!item) return;
    const amount = parseFloat(discountValue);
    const max = item.price * item.quantity;
    if (isNaN(amount) || amount <= 0 || amount > max) return;
    applyDiscount(item, discountValue);
    setDiscountDialog({ open: false, item: null });
  };

  const handlePayClick = (method) => {
    if (method !== paymentMethod) {
      setPaymentMethod(method);
      try {
        localStorage.setItem("lastPaymentMethod", method);
      } catch {}
    } else {
      setPaymentMethod("");
    }
  };

  const handleCashConfirm = () => {
    processSale("cash");
  };

  const handleDrawerDone = () => {
    setWaitingDrawer(false);
    setCashDialogOpen(false);
    setCart([]);
    setCustomer(null, null);
    setPaymentMethod(lastSavedPaymentMethod());
    setCashAmount("");
    setChange(0);
    setBarcode("");
    refocusBarcode();
  };

  const generateReceiptHTML = (method, paperWidthMm) => {
    const effSubtotal = method === "cash" ? roundCash(subtotal) : subtotal;
    const effTotal = method === "cash" ? roundCash(total) : total;
    const showDiscounts = cart.some(
      (i) =>
        (i.discount_percent > 0 && !i.customerPriced) ||
        i.discount > 0 ||
        promoInfo(i, i.quantity).applied,
    );
    const items = cart.map((item) => {
      const promo = promoInfo(item, item.quantity).applied;
      const fp = lineUnitPrice(item, item.quantity);
      const lt = lineTotal(item, item.quantity);
      const unit = item.isWeightItem
        ? "kg"
        : item.isBoxItem
          ? unitLabels(item.sale_unit)?.short || "cj"
          : item.isPackItem
            ? "pq"
            : "pza";
      const qtyDisplay = item.isWeightItem
        ? item.quantity.toFixed(3)
        : item.quantity;
      const name =
        item.name.length > 24 ? item.name.substring(0, 22) + ".." : item.name;
      const promoLabel = promo
        ? promo.type === "mayoreo"
          ? `Mayoreo desde ${promo.qty} pz`
          : promo.type === "fijo"
            ? `Precio fijo ${fmtMoney(promo.price)}`
            : `Oferta ${promo.qty} x ${fmtMoney(promo.price)}`
        : null;
      const discountParts = [];
      if (item.discount_percent > 0 && !item.customerPriced)
        discountParts.push(`-${item.discount_percent}%`);
      if (item.discount > 0) discountParts.push(`-${fmtMoneyAbs(item.discount)}`);

      return {
        name,
        qtyDisplay,
        unit,
        unitPrice: fp,
        lineTotal: lt,
        promoLabel,
        discountLabel: discountParts.join(" + ") || null,
      };
    });

    return buildReceiptHTML({
      store: storeSettings,
      headerNote: receiptNotes.header,
      footerNote: receiptNotes.footer,
      ticketNum: lastSaleFolioRef.current || Date.now().toString().slice(-6),
      date: new Date(),
      cashierName: cashier?.name || "Usuario Principal",
      items,
      subtotal: effSubtotal,
      showDiscounts,
      discountTotal: effSubtotal - effTotal,
      total: effTotal,
      methodLabel:
        method === "card"
          ? "TARJETA"
          : method === "transfer"
            ? "TRANSFERENCIA"
            : "EFECTIVO",
      isCash: method === "cash",
      paperWidthMm: paperWidthMm ?? 58,
      received: parseFloat(cashAmount) || 0,
      change: change || 0,
    });
  };

  return (
      <div className="flex h-[calc(100vh-112px)] flex-col overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
        <CartTabs
          carts={carts}
          activeIndex={activeIndex}
          onNewSale={handleNewSale}
          onSwitch={handleSwitchCart}
          onCancel={handleCancelCart}
        />
        <SearchSection
          barcode={barcode}
          onBarcodeChange={setBarcode}
          onBarcodeKeyDown={handleBarcodeSubmit}
          pendingQty={pendingQty}
          onOpenServicios={() => navigate("/servicios")}
          searchResults={searchResults}
          showSuggestions={showSuggestions}
          selectedSuggestionIndex={selectedSuggestionIndex}
          isSearching={isSearching}
          searchTimedOut={searchTimedOut}
          suggestionListRef={suggestionListRef}
          onSuggestionClick={(product) => {
            const { qty } = parseQtyPrefix(barcode);
            addProductToCart(product, qty ?? undefined);
          }}
          onAddProduct={addProductToCart}
        />
        </div>
      </div>
      {hasCart && (
        <ResizableHandle withHandle target="next" className="h-full w-2 bg-transparent" />
      )}
      <ResizablePanel
        defaultSize={effectiveCartWidth}
        minSize={0}
        maxSizeFraction={0.6}
        collapsed={!hasCart}
        onResizeEnd={handleCartResize}
        className="flex flex-col shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-md"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                focusZone === "cart"
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary",
              )}
            >
              <ShoppingCart size={18} />
            </span>
            <span
              className={cn(
                "truncate font-bold text-base",
                focusZone === "cart" ? "text-primary" : "text-foreground",
              )}
            >
              Carrito
            </span>
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary">
              {cart.length}
            </span>
          </div>
          <ShadButton
            variant="ghost"
            size="icon-sm"
            aria-label="Vaciar carrito"
            onClick={() => setCart([])}
            className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={18} />
          </ShadButton>
        </div>

        {/* Barra de contexto única: concentra los atajos de la zona activa
            (carrito o pago) en un solo lugar, sin apretar el título. */}
        {(focusZone === "cart" || focusZone === "payment") && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5 text-[11px] font-semibold text-muted-foreground">
            {focusZone === "cart" ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <Kbd className={HINT_KBD_CLS}>↑↓</Kbd> navegar
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd className={HINT_KBD_CLS}>←</Kbd>
                  <Kbd className={HINT_KBD_CLS}>→</Kbd> cantidad
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1">
                  <Kbd className={HINT_KBD_CLS}>←</Kbd>
                  <Kbd className={HINT_KBD_CLS}>→</Kbd> método
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd className={HINT_KBD_CLS}>↑↓</Kbd> carrito
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd className={HINT_KBD_CLS}>Tab</Kbd> buscador
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd className={HINT_KBD_CLS}>Enter</Kbd> finalizar
                </span>
              </>
            )}
          </div>
        )}

<div className="min-h-0 flex-1 overflow-auto p-1.5">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 opacity-40">
              <ShoppingCart size={56} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Sin productos</p>
            </div>
          ) : (
            cart.map((item, index) => {
              const lineKey = lineKeyOf(item);
              const removing = removingKeys.has(lineKey);
              return (
                <div
                  key={lineKey}
                  className={cn(
                    "grid transition-all duration-200 ease-out",
                    removing
                      ? "grid-rows-[0fr] opacity-40"
                      : "grid-rows-[1fr] opacity-100",
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <CartItem
                      item={item}
                      index={index}
                      isSelected={selectedCartItemIndex === index && focusZone === "cart"}
                      onSelect={onSelectItem}
                      onQuantityChange={updateQuantity}
                      onRemove={removeWithCollapse}
                      onDiscount={openDiscountDialog}
                      round={isCashPayment ? roundCash : noRound}
                      flash={cartFlashKey === lineKeyOf(item)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div
          className="sticky bottom-0 z-20 border-t border-border p-3 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.10)] bg-gradient-to-t from-transparent via-card/60 to-card"
        >
          <div className="mb-2.5">
            {customer ? (
              <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {customer.name}
                  {customer.tier_name && (
                    <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-primary">
                      {customer.tier_name}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={clearCustomer}
                  title="Quitar cliente"
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCustomerDialogOpen(true)}
                className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
              >
                <UserPlus size={18} />
                Cliente
              </button>
            )}
          </div>
          {/* Totales tipo ticket */}
          <div className="mb-2.5 flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Subtotal
              </span>
              <span className="text-base font-bold tabular-nums text-foreground">
                {fmtMoney(displaySubtotal)}
              </span>
            </div>
            {displayDiscountTotal > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-destructive">
                  Descuentos
                </span>
                <span className="text-base font-bold tabular-nums text-destructive">
                  -{fmtMoney(displayDiscountTotal)}
                </span>
              </div>
            )}
            <div className="my-1.5 border-t border-dashed border-border" />
            <div
              className={cn(
                "flex items-end justify-between gap-3 rounded-xl border border-primary/40 bg-primary/[0.04] px-4 py-2.5",
              )}
            >
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Total a cobrar
                </span>
                <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                  {itemCount} · {paymentLabel}
                </span>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span
                  key={displayTotal}
                  className={cn(
                    "cart-total-pop inline-block text-4xl font-bold leading-none tabular-nums",
                    totalValueClass,
                  )}
                >
                  {fmtMoney(displayTotal)}
                </span>
                {isCashPayment && change > 0 && (
                  <span className="mt-0.5 text-xs text-success font-semibold tabular-nums">
                    Cambio: {fmtMoney(change)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Cajón de cobro: divider deliberado que separa el resumen (recibo)
              de la zona donde se ejecuta el pago, para que el botón verde sea
              el punto focal y no uno más en la bandeja. */}
          <div className="my-2 border-t border-border/70" />
          {/* Métodos de pago */}
          <div
            className={cn(
              "mb-1.5 flex gap-1 rounded-lg p-1 transition-all duration-150",
              focusZone === "payment"
                ? "ring-2 ring-primary ring-inset"
                : "ring-2 ring-transparent ring-inset",
            )}
          >
            <button
              type="button"
              onClick={() => handlePayClick("cash")}
              title="Efectivo"
              className={cn(
                "flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-150 cursor-pointer",
                paymentMethod === "cash"
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <DollarSign
                size={17}
                className={cn(
                  paymentMethod === "cash"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
              <span className="text-sm font-bold leading-none">Efectivo</span>
            </button>

            <button
              type="button"
              onClick={() => handlePayClick("card")}
              title="Tarjeta"
              className={cn(
                "flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-150 cursor-pointer",
                paymentMethod === "card"
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <CreditCard
                size={17}
                className={cn(
                  paymentMethod === "card"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
              <span className="text-sm font-bold leading-none">Tarjeta</span>
            </button>

            <button
              type="button"
              onClick={() => handlePayClick("transfer")}
              title="Transferencia"
              className={cn(
                "flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-150 cursor-pointer",
                paymentMethod === "transfer"
                  ? "border-primary bg-primary/10 text-primary shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <Landmark
                size={17}
                className={cn(
                  paymentMethod === "transfer"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
              <span className="text-sm font-bold leading-none">Transf.</span>
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <ShadButton
              type="button"
              size="lg"
              disabled={!paymentMethod}
              onClick={() => {
                if (paymentMethod === "cash") setCashDialogOpen(true);
                else processSale(paymentMethod);
              }}
              className="w-full min-h-[58px] px-4 py-4 text-xl font-bold uppercase tracking-wide bg-success text-success-foreground hover:bg-success/90 hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              {/* Slots laterales de ancho igual (w-10) → el "Cobrar" del centro
                  queda ópticamente alineado, no desplazado por un ícono pequeño
                  y un Kbd ancho asimétricos. */}
              <span className="flex w-10 shrink-0 items-center justify-start">
                {printing ? (
                  <Spinner size={20} />
                ) : (
                  <Banknote size={22} />
                )}
              </span>
              <span className="flex-1 text-center">
                {printing ? "Cobrando..." : "Cobrar"}
              </span>
              <span className="flex w-10 shrink-0 items-center justify-end">
                <Kbd className={HINT_KBD_CLS}>Enter</Kbd>
              </span>
            </ShadButton>
          </div>
        </div>
      </ResizablePanel>


      <WeightDialog
        open={weightDialog.open}
        onClose={() => {
          setWeightDialog({ open: false, product: null });
          refocusBarcode();
        }}
        product={weightDialog.product}
        weightAmount={weightAmount}
        onWeightChange={(v) => {
          manualWeightRef.current = true;
          setScaleLive(null);
          setWeightAmount(v);
        }}
        scaleStatus={scaleLive}
        onConfirm={confirmWeightProduct}
        isDark={isDark}
      />

      <DiscountDialog
        open={discountDialog.open}
        onClose={() => setDiscountDialog({ open: false, item: null })}
        item={discountDialog.item}
        value={discountValue}
        onValueChange={setDiscountValue}
        onApply={handleDiscountApply}
        onClear={() => {
          clearDiscount(discountDialog.item);
          setDiscountDialog({ open: false, item: null });
        }}
        isDark={isDark}
      />

      <BoxChoiceDialog
        open={boxChoiceDialog.open}
        onClose={() => {
          setBoxChoiceDialog({ open: false, product: null });
          refocusBarcode();
        }}
        product={boxChoiceDialog.product}
        onConfirm={confirmBoxChoice}
        containerNoun={
          unitLabels(boxChoiceDialog.product?.sale_unit)?.containerNoun || "Caja"
        }
        piecesPer={
          unitLabels(boxChoiceDialog.product?.sale_unit)?.piecesPer ||
          "piezas por caja"
        }
        boxPrice={boxChoiceDialog.product?.box_price}
        packPrice={
          boxChoiceDialog.product
            ? packPriceOf(boxChoiceDialog.product)
            : undefined
        }
        piecePrice={
          boxChoiceDialog.product
            ? piecePriceOf(boxChoiceDialog.product)
            : undefined
        }
        boxQty={boxChoiceDialog.product?.box_qty}
        packQty={boxChoiceDialog.product?.pack_qty}
        saleUnit={boxChoiceDialog.product?.sale_unit}
      />

      <FastCashDialog
        open={cashDialogOpen}
        onClose={() => {
          if (waitingDrawer) {
            handleDrawerDone();
          } else {
            setCashDialogOpen(false);
          }
        }}
        total={displayTotal}
        cashAmount={cashAmount}
        onCashAmountChange={(val) => {
          setCashAmount(val);
          setChange((parseFloat(val) || 0) - displayTotal);
        }}
        change={change}
        waitingDrawer={waitingDrawer}
        onConfirm={handleCashConfirm}
        onDrawerDone={handleDrawerDone}
      />

      <QtyDialog
        open={qtyDialogOpen}
        onClose={() => {
          setQtyDialogOpen(false);
          refocusBarcode();
        }}
        value={qtyInput}
        onChange={(v) => setQtyInput(v)}
        onConfirm={() => {
          const qty = parseInt(qtyInput, 10);
          if (qty >= 1) {
            setPendingQty(qty);
            setQtyDialogOpen(false);
            showNotification(`Próxima captura: x${qty}`, "info");
            refocusBarcode();
          } else {
            showNotification("Cantidad inválida", "warning");
          }
        }}
      />

      <ManualProductDialog
        open={manualProductModalOpen}
        onClose={() => {
          setManualProductModalOpen(false);
          refocusBarcode();
        }}
        name={manualProduct.name}
        price={manualProduct.price}
        onNameChange={(v) => setManualProduct({ ...manualProduct, name: v })}
        onPriceChange={(v) => setManualProduct({ ...manualProduct, price: v })}
        onConfirm={handleManualProduct}
      />

      <CustomerSearchDialog
        open={customerDialogOpen}
        onClose={() => {
          setCustomerDialogOpen(false);
          refocusBarcode();
        }}
        onSelect={(c) => {
          setCustomerDialogOpen(false);
          selectCustomer(c);
          refocusBarcode();
        }}
      />

      {printing &&
        createPortal(
          <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center gap-5 bg-black/60 backdrop-blur-sm">
            <div className="ticket-print">
              <div className="ticket-window">
                <div className="ticket-track">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className={[
                        "ticket-line",
                        i === 11
                          ? "ticket-line--total"
                          : ["ticket-line--full", "ticket-line--med", "ticket-line--short"][i % 3],
                      ].join(" ")}
                    />
                  ))}
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={`b-${i}`}
                      className={[
                        "ticket-line",
                        i === 11
                          ? "ticket-line--total"
                          : ["ticket-line--full", "ticket-line--med", "ticket-line--short"][i % 3],
                      ].join(" ")}
                    />
                  ))}
                </div>
              </div>
            </div>
            <p className="text-base font-bold text-white">
              Imprimiendo ticket...
            </p>
          </div>,
          document.body,
        )}
      </ResizablePanelGroup>
    </div>
  );
};

export default SalesTerminal;
