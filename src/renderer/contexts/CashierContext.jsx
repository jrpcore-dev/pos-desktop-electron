import { createContext, useContext, useState, useCallback } from "react";

const CashierContext = createContext({ cashier: null, setCashier: () => {}, logout: () => {} });

export const CashierProvider = ({ children }) => {
  const [cashier, setCashier] = useState(() => {
    try {
      const saved = localStorage.getItem("currentCashier");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const logout = useCallback(() => {
    setCashier(null);
    localStorage.removeItem("currentCashier");
  }, []);

  const handleSetCashier = useCallback((c) => {
    setCashier(c);
    if (c) localStorage.setItem("currentCashier", JSON.stringify(c));
    else localStorage.removeItem("currentCashier");
  }, []);

  return (
    <CashierContext.Provider value={{ cashier, setCashier: handleSetCashier, logout }}>
      {children}
    </CashierContext.Provider>
  );
};

export const useCashier = () => useContext(CashierContext);
