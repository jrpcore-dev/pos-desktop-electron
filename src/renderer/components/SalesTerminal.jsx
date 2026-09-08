import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
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
import RechargeDialog from "./RechargeDialog";
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

const roundCash = (amount) => {
  const base = Math.floor(amount);
  const cents = Math.round((amount - base) * 100);
  if (cents <= 29) return base;
  if (cents <= 79) return base + 0.5;
  return base + 1;
};

const parseQtyPrefix = (str) => {
  const m = /^(\d+)\*(.+)$/.exec(str);
  if (m) {
    const qty = parseInt(m[1], 10);
    return { qty: qty >= 1 ? qty : 1, rest: m[2].trim() };
  }
  return { qty: null, rest: str };
};

const PRESET_RECHARGES = [12, 22, 32, 52, 62, 100];

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
  const [recargaDialogOpen, setRecargaDialogOpen] = useState(false);
  const [recargaAmount, setRecargaAmount] = useState("");
  const [storeSettings, setStoreSettings] = useState({
    name: "MI TIENDA POS",
    website: "www.mitienda.com",
    logo: "",
  });
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
        setPaymentMethod("");
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
        if (name)
          setStoreSettings((prev) => ({ ...prev, name: name.toUpperCase() }));
        if (website) setStoreSettings((prev) => ({ ...prev, website }));
        if (logo) setStoreSettings((prev) => ({ ...prev, logo }));
      } catch (e) {}
    };
    loadSettings();

    const handleSettingsUpdated = (event) => {
      const { storeName, storeLogo } = event.detail || {};
      if (storeName) setStoreSettings((prev) => ({ ...prev, name: storeName.toUpperCase() }));
      if (typeof storeLogo === "string") setStoreSettings((prev) => ({ ...prev, logo: storeLogo }));
    };
    window.addEventListener("storeSettingsUpdated", handleSettingsUpdated);
    return () => window.removeEventListener("storeSettingsUpdated", handleSettingsUpdated);
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
        qtyDialogOpen ||
        recargaDialogOpen
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
          updateQuantity(lastItem, 1);
        }
      }
      if (e.key === "F3") {
        e.preventDefault();
        const lastItem = cartRef.current?.[cartRef.current.length - 1];
        if (lastItem && !lastItem.isWeightItem) {
          updateQuantity(lastItem, -1);
        }
      }
      if (e.key === "q" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.getElementById("barcode-input")?.focus();
        setFocusZone("search");
      }
      if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setRecargaDialogOpen(true);
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
          removeFromCart(lastItem);
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
            setCart([]);
            setPaymentMethod("");
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
            updateQuantity(item, 1);
          }
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const item = cartRef.current[selectedCartItemIndex];
          if (item && !item.isWeightItem) {
            updateQuantity(item, -1);
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
          setPaymentMethod((prev) =>
            prev === "cash" ? "card" : prev === "card" ? "transfer" : "cash",
          );
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setPaymentMethod((prev) =>
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
    if (product.stock <= 0) {
      showNotification("Producto sin stock", "error");
      return;
    }
    if (product.stock - committedStockFor(product, cartRef.current) < 1) {
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
    if (product.stock - committedStockFor(product, cartRef.current) < kg) {
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
    if (product.stock - committedStockFor(product, cartRef.current) < needPieces * qty) {
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

  const confirmRecharge = () => {
    const amount = parseFloat(recargaAmount);
    if (!amount || amount <= 0) {
      showNotification("Ingresa un monto válido", "warning");
      return;
    }
    const item = {
      id: `recarga-${amount}`,
      name: `Recarga $${amount}`,
      price: amount,
      finalPrice: amount,
      quantity: 1,
      discount_percent: 0,
      has_discount: 0,
      barcode: `RECARGA-${amount}`,
      stock: 999,
      isManual: true,
    };
    setCart((prev) => [...prev, item]);
    setRecargaDialogOpen(false);
    setRecargaAmount("");
    refocusBarcode();
    showNotification(`Recarga $${amount} agregada al carrito`, "success");
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
          const qty = Math.min(newQty, it.stock || 999);
          const disc = it.discount || 0;
          const fp =
            disc > 0 && qty > 0
              ? (it.price * qty - disc) / qty
              : it.finalPrice;
          return { ...it, quantity: qty, finalPrice: fp };
        })
        .filter(Boolean),
    );
  }, []);

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
    [showNotification],
  );

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
    setPaymentMethod(method === paymentMethod ? "" : method);
  };

  const handleCashConfirm = () => {
    processSale("cash");
  };

  const handleDrawerDone = () => {
    setWaitingDrawer(false);
    setCashDialogOpen(false);
    setCart([]);
    setPaymentMethod("");
    setCashAmount("");
    setChange(0);
    setBarcode("");
    refocusBarcode();
  };

  const generateReceiptHTML = (method) => {
    const now = new Date();
    const ticketNum = Date.now().toString().slice(-6);
    const lines = [];

    if (storeSettings.logo) {
      lines.push(
        `<div style="text-align:center;margin-bottom:4px"><img src="${storeSettings.logo}" style="height:100px;max-width:48mm;object-fit:contain"/></div>`,
      );
    }
    lines.push(
      `<div style="text-align:center;font-weight:bold;font-size:15px">${storeSettings.name}</div>`,
    );
    lines.push(
      `<div style="text-align:center;font-size:11px">Sistema de Punto de Venta</div>`,
    );
    lines.push(`<div class="sep"></div>`);
    lines.push(
      `<div style="text-align:center;font-size:10px">${now.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Mexico_City" })}<br>${now.toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}</div>`,
    );
    lines.push(`<div class="sep"></div>`);
    lines.push(
      `<div style="font-size:11px;display:flex;justify-content:space-between"><span>Cajero:</span><span>${cashier?.name || "Usuario Principal"}</span></div>`,
    );
    lines.push(
      `<div style="font-size:11px;display:flex;justify-content:space-between"><span>Ticket #:</span><span>${ticketNum}</span></div>`,
    );
    lines.push(`<div class="sep"></div>`);
    lines.push(
      `<div style="text-align:center;font-weight:bold;font-size:12px">DETALLE DE COMPRA</div>`,
    );
    lines.push(`<div class="sep"></div>`);

    cart.forEach((item) => {
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
      lines.push(`<div style="font-weight:bold;font-size:12px">${name}</div>`);
      lines.push(
        `<div style="display:flex;justify-content:space-between;font-size:10px"><span>${qtyDisplay} ${unit} x $${fp.toFixed(2)}</span><span>$${lt.toFixed(2)}</span></div>`,
      );
      if (promo)
        lines.push(
          `<div style="text-align:center;font-size:10px;color:purple">${
            promo.type === "mayoreo"
              ? `Mayoreo desde ${promo.qty} pz`
              : `Oferta ${promo.qty} x $${promo.price.toFixed(2)}`
          }</div>`,
        );
      if (item.discount_percent > 0)
        lines.push(
          `<div style="text-align:center;font-size:10px;color:red">Descuento: -${item.discount_percent}%</div>`,
        );
      if (item.discount > 0)
        lines.push(
          `<div style="text-align:center;font-size:10px;color:red">Descuento: -$${item.discount.toFixed(2)}</div>`,
        );
      lines.push(
        `<div style="border-bottom:1px dotted #ccc;margin:3px 0"></div>`,
      );
    });

    lines.push(`<div class="sep"></div>`);
    const effSubtotal =
      method === "cash" ? roundCash(subtotal) : subtotal;
    const effTotal = method === "cash" ? roundCash(total) : total;
    const effDiscount = effSubtotal - effTotal;
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Subtotal:</span><span>$${effSubtotal.toFixed(2)}</span></div>`,
    );
    if (
      cart.some(
        (i) =>
          i.discount_percent > 0 ||
          i.discount > 0 ||
          promoInfo(i, i.quantity).applied,
      )
    )
      lines.push(
        `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Descuentos:</span><span>-$${effDiscount.toFixed(2)}</span></div>`,
      );
    lines.push(`<div class="sep"></div>`);
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px"><span>TOTAL:</span><span>$${effTotal.toFixed(2)}</span></div>`,
    );
    lines.push(`<div class="sep"></div>`);
    const metodo =
      method === "card"
        ? "TARJETA"
        : method === "transfer"
          ? "TRANSFERENCIA"
          : "EFECTIVO";
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Metodo:</span><span><strong>${metodo}</strong></span></div>`,
    );
    if (method === "cash") {
      lines.push(
        `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Recibido:</span><span>$${parseFloat(cashAmount).toFixed(2)}</span></div>`,
      );
      lines.push(
        `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cambio:</span><span>$${change.toFixed(2)}</span></div>`,
      );
    }
    lines.push(`<div class="sep"></div>`);
    lines.push(
      `<div style="text-align:center;font-weight:bold;font-size:13px">¡GRACIAS POR SU COMPRA!</div>`,
    );
    lines.push(
      `<div style="text-align:center;font-size:10px">Conserve este ticket</div>`,
    );
    lines.push(
      `<div style="text-align:center;font-size:9px;margin-top:5px">JRP POS</div>`,
    );
    lines.push(`<div style="height:20px"></div>`);

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:58mm auto;margin:0}
      *{box-sizing:border-box}
      body{font-family:'Courier New',monospace;font-size:11px;margin:0 auto;padding:2px 2px;width:48mm;max-width:48mm;background:white;color:black;overflow-wrap:break-word}
      .sep{border-top:1px dashed #333;margin:5px 0}
    </style></head><body>${lines.join("")}</body></html>`;
  };

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col overflow-hidden">
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
          onOpenRecarga={() => setRecargaDialogOpen(true)}
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
            cart.map((item, index) => (
              <CartItem
                key={lineKeyOf(item)}
                item={item}
                index={index}
                isSelected={selectedCartItemIndex === index && focusZone === "cart"}
                onSelect={onSelectItem}
                onQuantityChange={updateQuantity}
                onRemove={removeFromCart}
                onDiscount={openDiscountDialog}
              />
            ))
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="border-t border-border bg-muted/30 p-4">
          <div className="mb-2">
            <div className="mb-0.5 flex justify-between">
              <span className="text-xs text-muted-foreground">Subtotal</span>
              <span className="text-xs text-muted-foreground">
                ${displaySubtotal.toFixed(2)}
              </span>
            </div>
            {displayDiscountTotal > 0 && (
              <div className="mb-0.5 flex justify-between">
                <span className="text-xs text-destructive">Descuentos</span>
                <span className="text-xs text-destructive">
                  -${displayDiscountTotal.toFixed(2)}
                </span>
              </div>
            )}
            <div className="my-1 h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-base font-extrabold text-foreground">
                Total
              </span>
              <span
                key={displayTotal}
                className="cart-total-pop inline-block text-2xl font-extrabold tabular-nums text-success"
              >
                ${displayTotal.toFixed(2)}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "mb-1.5 flex gap-1 rounded-md p-0.5 transition-all duration-150",
              focusZone === "payment"
                ? "ring-2 ring-primary ring-inset"
                : "ring-2 ring-transparent ring-inset",
            )}
          >
            <ShadButton
              type="button"
              variant={paymentMethod === "cash" ? "warning" : "outline"}
              size="sm"
              onClick={() => handlePayClick("cash")}
              className="flex-1 font-bold text-xs py-1"
            >
              <DollarSign />
              Efectivo
            </ShadButton>
            <ShadButton
              type="button"
              variant={paymentMethod === "card" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePayClick("card")}
              className="flex-1 font-bold text-xs py-1"
            >
              <CreditCard />
              Tarjeta
            </ShadButton>
            <ShadButton
              type="button"
              variant={paymentMethod === "transfer" ? "warning" : "outline"}
              size="sm"
              onClick={() => handlePayClick("transfer")}
              className="flex-1 font-bold text-xs py-1"
            >
              <Landmark />
              Transf.
            </ShadButton>
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
              className="w-full px-4 py-3.5 text-base font-extrabold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {printing ? (
                <Spinner size={18} />
              ) : (
                <Banknote size={20} />
              )}
              <span className="flex-1 text-center">
                {printing ? "Procesando venta..." : "Finalizar Venta"}
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

      <RechargeDialog
        open={recargaDialogOpen}
        onClose={() => {
          setRecargaDialogOpen(false);
          setRecargaAmount("");
          refocusBarcode();
        }}
        amount={recargaAmount}
        onAmountChange={setRecargaAmount}
        onConfirm={confirmRecharge}
        presets={PRESET_RECHARGES}
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

      {printing && (
        <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-sm">
          <Spinner size={48} className="text-white" />
          <p className="text-base font-bold text-white">
            Imprimiendo ticket...
          </p>
        </div>
      )}
      </ResizablePanelGroup>
    </div>
  );
};

export default SalesTerminal;
