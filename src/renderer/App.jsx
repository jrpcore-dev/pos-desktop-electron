import React, { useState, useEffect, useMemo, useCallback } from "react";
import { flushSync } from "react-dom";
import { HashRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import SetupWizardScreen from "./components/SetupWizardScreen";
import AddProductModal from "./components/AddProductModal";
import LoginScreen from "./components/LoginScreen";
import BoxSetupScreen from "./components/BoxSetupScreen";
import Catalog from "./components/Catalog";
import ToastProvider from "./components/ToastProvider";
import { Spinner } from "./components/ui/spinner";

const Layout = React.lazy(() => import("./components/Layout"));
const SalesTerminal = React.lazy(() => import("./components/SalesTerminal"));
const Inventory = React.lazy(() => import("./components/Inventory"));
const EndOfDay = React.lazy(() => import("./components/EndOfDay"));
const RegisterHistory = React.lazy(() => import("./components/RegisterHistory"));
const Suppliers = React.lazy(() => import("./components/Suppliers"));
const StockMovements = React.lazy(() => import("./components/StockMovements"));
const Reports = React.lazy(() => import("./components/Reports"));
const BackupRestore = React.lazy(() => import("./components/BackupRestore"));
const Cashiers = React.lazy(() => import("./components/Cashiers"));
const ConfigurationScreen = React.lazy(() => import("./components/ConfigurationScreen"));
const Categories = React.lazy(() => import("./components/Categories"));
const Transacciones = React.lazy(() => import("./components/Transacciones"));
const ServicesScreen = React.lazy(() =>
  import("./components/servicios/ServicesScreen")
);
const Customers = React.lazy(() => import("./components/Customers"));
import { CashierProvider, useCashier } from "./contexts/CashierContext";
import { ThemeModeContext } from "./contexts/ThemeContext";

const AppInner = () => {
  const { cashier, setCashier } = useCashier();
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState(() => {
    try { return !!localStorage.getItem("currentCashier"); } catch { return false; }
  });

  useEffect(() => {
    if (!cashier) setLoggedIn(false);
  }, [cashier]);
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem("themeMode") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const [isFirstTime, setIsFirstTime] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [setupPreview, setSetupPreview] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);

  // B7 · estado de la caja. `null` = todavía sin preguntar; `{}` = no se pudo
  // saber (se trata como Host en vez de quedarse cargando para siempre).
  const [box, setBox] = useState(null);
  const loadBox = useCallback(async () => {
    try {
      const s = await window.api.invoke("box-get-settings");
      setBox(s && typeof s === "object" ? s : {});
    } catch {
      setBox({});
    }
  }, []);

  const isBoxDevice = !!box && box.device_role === "client";
  const canSell = isBoxDevice && box.canSell === true;

  useEffect(() => {
    loadBox();
  }, [loadBox]);

  // Sólo la caja se vigila, y sólo mientras no pueda vender: así el paso de
  // vincular y la descarga se reflejan solos sin sondear nada en el Host.
  useEffect(() => {
    if (!isBoxDevice || canSell) return;
    const timer = setInterval(loadBox, 1200);
    return () => clearInterval(timer);
  }, [isBoxDevice, canSell, loadBox]);

  const applyModeClass = (next) => {
    const root = document.documentElement;
    if (next === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  };

  const colorMode = useMemo(() => ({
    toggleMode: () => {
      const flip = () => {
        const next = mode === "dark" ? "light" : "dark";
        const root = document.documentElement;
        try { localStorage.setItem("themeMode", next); } catch {}
        root.classList.add("theme-switching");
        applyModeClass(next);
        flushSync(() => setMode(next));
        requestAnimationFrame(() => {
          root.classList.remove("theme-switching");
        });
      };
      if (typeof document.startViewTransition === "function") {
        document.startViewTransition(() => flip());
      } else {
        flip();
      }
    },
    isDark: mode === "dark",
  }), [mode]);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [mode]);

  // Sincroniza con el titleBarOverlay del proceso principal (color del navbar)
  // en el arranque y en cada cambio de tema, sin reiniciar la app.
  // En las pantallas de marca (Login y SetupWizard) el fondo es un gradiente
  // full-bleed, así que el overlay se tiñe con el modo "brand" para que los
  // controles nativos se fundan con la marca en vez de verse un bloque sólido.
  const onBrandScreen = !loggedIn || showSetup;
  useEffect(() => {
    try {
      window.api?.setTitlebarTheme(onBrandScreen ? "brand" : mode);
    } catch {}
  }, [mode, onBrandScreen]);

  useEffect(() => {
    const checkFirstTime = async () => {
      try {
        const firstTime = await window.api.invoke("is-first-time");
        setIsFirstTime(firstTime);
        if (firstTime) {
          setSetupPreview(false);
          setShowSetup(true);
        }
      } catch (error) {
        console.error("Error checking first time:", error);
        setIsFirstTime(false);
      }
    };
    checkFirstTime();
    const handleCtrlN = () => setShowAddProduct(true);
    window.addEventListener("ctrl-n", handleCtrlN);
    return () => {
      window.removeEventListener("ctrl-n", handleCtrlN);
    };
  }, []);

  // Atajo para ver el asistente de configuración cuando se quiera
  // (Ctrl+Shift+W). Abre en modo preview: no guarda ajustes ni crea
  // cajeros, y se cierra con su botón/Cancelar.
  useEffect(() => {
    const openWizardPreview = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "w" && !showSetup) {
        e.preventDefault();
        setSetupPreview(true);
        setShowSetup(true);
      }
    };
    window.addEventListener("keydown", openWizardPreview);
    return () => window.removeEventListener("keydown", openWizardPreview);
  }, [showSetup]);

  const handleSetupComplete = async (setupData) => {
    setShowSetup(false);
    setIsFirstTime(false);
    window.dispatchEvent(new CustomEvent("setupCompleted", { detail: setupData }));
    if (!setupPreview) {
      // Auto-login as the admin created during setup
      try {
        const list = await window.api.invoke("get-cashiers");
        const admin = list.find((c) => c.role === "admin");
        if (admin) {
          setCashier({ id: admin.id, name: admin.name, role: admin.role });
          setLoggedIn(true);
          navigate("/");
        }
      } catch {}
    }
    setSetupPreview(false);
  };

  const handleSetupClose = () => {
    setShowSetup(false);
    setSetupPreview(false);
  };

  const handleLogin = (cashier) => {
    setLoggedIn(true);
    setCashier(cashier);
    navigate("/");
  };

  const loadingScreen = (
    <div className="fixed inset-0 z-[9999] flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-center">
        <Spinner size={40} className="text-brand" />
        <p className="text-sm font-medium text-muted-foreground">Cargando...</p>
      </div>
    </div>
  );

  // B7 · la caja corta ANTES que todo lo demás. Mientras no esté sincronizada
  // no hay catálogo propio ni cajeros propios, así que ni el asistente de
  // instalación ni el login tienen sentido: sólo vincular y descargar. No es
  // un botón desactivado, es que no existe ningún sitio al que se pueda llegar.
  if (box === null) {
    return (
      <ThemeModeContext.Provider value={colorMode}>
        <ToastProvider>
          {loadingScreen}
        </ToastProvider>
      </ThemeModeContext.Provider>
    );
  }

  if (isBoxDevice && !canSell) {
    return (
      <ThemeModeContext.Provider value={colorMode}>
        <ToastProvider>
          <BoxSetupScreen settings={box} onRefresh={loadBox} />
        </ToastProvider>
      </ThemeModeContext.Provider>
    );
  }

  if (isFirstTime === null) {
    return (
      <ThemeModeContext.Provider value={colorMode}>
        <ToastProvider>
          {loadingScreen}
        </ToastProvider>
      </ThemeModeContext.Provider>
    );
  }

  if (!loggedIn) {
    return (
      <ThemeModeContext.Provider value={colorMode}>
        <ToastProvider>
          <SetupWizardScreen
            open={showSetup}
            isPreviewMode={setupPreview}
            onComplete={handleSetupComplete}
            onClose={handleSetupClose}
          />

          {!showSetup && <LoginScreen onLogin={handleLogin} />}
        </ToastProvider>
      </ThemeModeContext.Provider>
    );
  }

  return (
    <ThemeModeContext.Provider value={colorMode}>
      <ToastProvider>
        <SetupWizardScreen
          open={showSetup}
          isPreviewMode={setupPreview}
          onComplete={handleSetupComplete}
          onClose={handleSetupClose}
        />

        <AddProductModal open={showAddProduct} onClose={() => setShowAddProduct(false)} onProductAdded={() => setShowAddProduct(false)} />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<SalesTerminal />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="catalog-reference" element={<Catalog />} />
            <Route path="catalog" element={<Navigate to="catalog-reference" replace />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="categories" element={<Categories />} />
            <Route path="stock-movements" element={<StockMovements />} />
            <Route path="transacciones" element={<Transacciones />} />
            <Route path="servicios" element={<ServicesScreen />} />
            <Route path="customers" element={<Customers />} />
            <Route path="end-of-day" element={<EndOfDay />} />
            <Route path="register-history" element={<RegisterHistory />} />
            <Route path="reports" element={<Reports />} />
            <Route path="backup" element={<BackupRestore />} />
            <Route path="cashiers" element={<Cashiers />} />
            <Route path="configuration" element={<ConfigurationScreen />} />
          </Route>
        </Routes>
      </ToastProvider>
    </ThemeModeContext.Provider>
  );
};

const App = () => (
  <CashierProvider>
    <HashRouter>
      <AppInner />
    </HashRouter>
  </CashierProvider>
);

export default App;