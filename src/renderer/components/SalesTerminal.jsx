import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useCashier } from "../contexts/CashierContext";
import {
  ShoppingCart,
  Trash2,
  CreditCard,
  DollarSign,
  Landmark,
  Banknote,
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
import { useMultiCart } from "./cart/useMultiCart";
import { Button as ShadButton } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
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
} from "../utils/cartMath";
import { buildReceiptHTML } from "../utils/receiptTemplate";

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
    newSale,
    switchCart,
    cancelCart,
  } = useMultiCart();
  const lastRegisterWarnRef = useRef(0);
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [change, setChange] = useState(0);
  const [waitingDrawer, setWaitingDrawer] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [manualProductModalOpen, setManualProductModalOpen] = useState(false);
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

  const totalAccentClass = "bg-success/10 border-success/30";
  const totalValueClass = "text-success";

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
    }));
    const result = await window.api.invoke("record-sale", {
      cart: cartForSale,
      total: method === "cash" ? roundCash(cartSummary.total) : cartSummary.total,
      paymentMethod: method,
      discountTotal: cartSummary.discountTotal,
      cashierName: cashier?.name || "Usuario Principal",
    });
    if (result.success) {
      if (method === "cash") {
        setWaitingDrawer(true);
      } else {
        setCart([]);
        setPaymentMethod(lastSavedPaymentMethod());
        setCashDialogOpen(false);
        setCashAmount("");
        setChange(0);
        setBarcode("");
      }
      window.dispatchEvent(new CustomEvent("sale-registered"));
      showNotification("Venta registrada exitosamente", "success");
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
          const text = generateReceiptHTML(method);
          const printResult = await window.api.invoke("print-receipt", text);
          if (printResult.success && (method === "card" || method === "transfer")) {
            const setting = await window.api.invoke("get-setting", "print_two_tickets");
            if (setting === "true") {
              await window.api.invoke("print-receipt", generateReceiptHTML(method));
            }
          }
          if (!printResult.success) {
            console.error("[PRINT]", printResult.error);
          }
        } catch (e) {
          console.error("[PRINT]", e);
        }
        setPrinting(false);
      } catch (e) {
        console.error("[PRINT]", e);
      }
    } else {
      showNotification(result.error || "Error al registrar la venta", "error");
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
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
        if (logo) setStoreSettings((prev) => ({ ...prev, logo }));
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
    };
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
  }, []);

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

      if (
        cashDialogOpen ||
        discountDialog.open ||
        boxChoiceDialog.open ||
        weightDialog.open ||
        manualProductModalOpen ||
        qtyDialogOpen
      ) {
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
        if (cartRef.current.length > 0) {
          showNotification(
            "Termina la venta actual antes de cerrar la caja",
            "warning",
          );
          return;
        }
        localStorage.setItem("eodPendingAction", "close-register");
        navigate("/end-of-day");
      }
      if (e.key === "F10") {
        e.preventDefault();
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
    pendingQty,
  ]);

  useEffect(() => {
    if (!weightDialog.open || !weightDialog.product) return;
    let cancelled = false;

    const unsub = window.api.on("weight-update", (data) => {
      if (!cancelled && data.weight >= 0) {
        setWeightAmount(data.weight.toFixed(3));
      }
    });

    (async () => {
      try {
        const port = localStorage.getItem("scalePort");
        const baud = localStorage.getItem("scaleBaud") || "115200";
        if (!port) return;
        await window.api.invoke("start-weight-stream", port, parseInt(baud));
      } catch (e) {}
    })();

    return () => {
      cancelled = true;
      unsub();
      window.api.invoke("stop-weight-stream");
    };
  }, [weightDialog.open, weightDialog.product]);

  useEffect(() => {
    const searchQuery = barcode.replace(/^\d+\*/g, "");
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
  }, [barcode]);

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

  const checkRegisterOpen = async () => {
    try {
      const res = await window.api.invoke("get-cash-register-status", {
        cashierId: cashier?.id,
        role: cashier?.role,
      });
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
    const effectivePrice = calcFinalPrice(
      product.price,
      product.discount_percent,
    );
    const productWithDiscount = { ...product, finalPrice: effectivePrice };

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
    const effectivePrice = calcFinalPrice(
      product.price,
      product.discount_percent,
    );
    const productWithWeight = {
      ...product,
      finalPrice: effectivePrice,
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
    const unitPrice = isBox
      ? product.box_price
      : isPack
        ? packPriceOf(product)
        : piecePriceOf(product);
    const effectivePrice = calcFinalPrice(unitPrice, product.discount_percent);
    const item = {
      ...product,
      finalPrice: effectivePrice,
      quantity: qty,
      isBoxItem: isBox,
      isPackItem: isPack,
      price: unitPrice,
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
          it.discount_percent > 0
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
    setPaymentMethod(lastSavedPaymentMethod());
    setCashAmount("");
    setChange(0);
    setBarcode("");
    refocusBarcode();
  };

  const generateReceiptHTML = (method) => {
    const effSubtotal = method === "cash" ? roundCash(subtotal) : subtotal;
    const effTotal = method === "cash" ? roundCash(total) : total;
    const showDiscounts = cart.some(
      (i) =>
        i.discount_percent > 0 ||
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
            ? `Precio fijo $${promo.price.toFixed(2)}`
            : `Oferta ${promo.qty} x $${promo.price.toFixed(2)}`
        : null;
      const discountParts = [];
      if (item.discount_percent > 0)
        discountParts.push(`-${item.discount_percent}%`);
      if (item.discount > 0) discountParts.push(`-$${item.discount.toFixed(2)}`);

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
      ticketNum: Date.now().toString().slice(-6),
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
        <div
          className={cn(
            "flex items-center justify-between border-b border-border px-4 pb-1.5",
            hasCart && "pt-4",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1 font-bold text-base",
              focusZone === "cart" ? "text-primary" : "text-foreground",
            )}
          >
            <ShoppingCart size={20} className={focusZone === "cart" ? "text-primary" : "text-foreground"} />
            Productos ({cart.length})
            {focusZone === "cart" && (
              <span className="ml-0.5 inline-flex items-center gap-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                <KbdGroup>
                  <Kbd className="h-5 px-1 text-[9px]">↑↓</Kbd>
                </KbdGroup>
                <span className="opacity-60">navegar</span>
                <KbdGroup>
                  <Kbd className="h-5 px-1 text-[9px]">←</Kbd>
                  <Kbd className="h-5 px-1 text-[9px]">→</Kbd>
                </KbdGroup>
                <span className="opacity-60">cantidad</span>
              </span>
            )}
          </div>
          <ShadButton
            variant="ghost"
            size="icon-sm"
            aria-label="Vaciar carrito"
            onClick={() => setCart([])}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 size={18} />
          </ShadButton>
        </div>

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
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="border-t border-border bg-muted/30 p-3">
          {/* Totales tipo ticket */}
          <div className="mb-2.5 flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Subtotal
              </span>
              <span className="text-base font-bold tabular-nums text-foreground">
                ${displaySubtotal.toFixed(2)}
              </span>
            </div>
            {displayDiscountTotal > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-destructive">
                  Descuentos
                </span>
                <span className="text-base font-bold tabular-nums text-destructive">
                  -${displayDiscountTotal.toFixed(2)}
                </span>
              </div>
            )}
            <div className="my-1 border-t border-dashed border-border" />
            <div
              className={cn(
                "flex items-end justify-between gap-3 rounded-xl border px-4 py-2",
                totalAccentClass,
              )}
            >
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Total
                </span>
                <span className="text-[0.68rem] font-medium text-muted-foreground">
                  {itemCount} · {paymentLabel}
                </span>
              </div>
              <span
                key={displayTotal}
                className={cn(
                  "cart-total-pop inline-block text-3xl font-black leading-none tabular-nums",
                  totalValueClass,
                )}
              >
                ${displayTotal.toFixed(2)}
              </span>
            </div>
          </div>

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
                "flex h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-150 cursor-pointer",
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
                "flex h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-150 cursor-pointer",
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
                "flex h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors duration-150 cursor-pointer",
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

          {focusZone === "payment" && (
            <div className="mb-0.5 flex items-center justify-center gap-1.5 text-[10px] font-semibold text-foreground">
              <KbdGroup>
                <Kbd className="h-5 px-1 text-[9px]">←</Kbd>
                <Kbd className="h-5 px-1 text-[9px]">→</Kbd>
              </KbdGroup>
              <span className="opacity-60">cambiar método</span>
              <KbdGroup>
                <Kbd className="h-5 px-1 text-[9px]">↑↓</Kbd>
              </KbdGroup>
              <span className="opacity-60">carrito</span>
              <Kbd className="h-5 px-1 text-[9px]">Tab</Kbd>
              <span className="opacity-60">buscador</span>
              <Kbd className="h-5 px-1 text-[9px]">Enter</Kbd>
              <span className="opacity-60">finalizar</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <ShadButton
              type="button"
              size="lg"
              disabled={!paymentMethod}
              onClick={() => {
                if (paymentMethod === "cash") setCashDialogOpen(true);
                else processSale(paymentMethod);
              }}
              className="w-full min-h-[58px] px-4 py-4 text-xl font-black uppercase tracking-wide bg-success text-white hover:bg-success/90 shadow-sm shadow-success/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              {printing ? (
                <Spinner size={20} />
              ) : (
                <Banknote size={22} />
              )}
              <span className="flex-1 text-center">
                {printing ? "Cobrando..." : "Cobrar"}
              </span>
              <Kbd className="h-5 px-1 text-[10px]">Enter</Kbd>
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
        onWeightChange={(v) => setWeightAmount(v)}
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
