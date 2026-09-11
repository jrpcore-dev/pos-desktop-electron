import React, { useState, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { HashRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import SetupWizardScreen from "./components/SetupWizardScreen";
import AddProductModal from "./components/AddProductModal";
import LoginScreen from "./components/LoginScreen";
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
  useEffect(() => {
    try {
      window.api?.setTitlebarTheme(mode);
    } catch {}
  }, [mode]);

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