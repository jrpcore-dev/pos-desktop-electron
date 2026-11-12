import React, { createContext, useContext, useCallback } from "react";
import { Toaster, toast as sonnerToast } from "sonner";
import { Check, X, TriangleAlert, Info } from "lucide-react";

// Notificaciones (Sonner) con la identidad de Vendia (maqueta aprobada):
// tarjeta clara con sombra en capas, ícono en una ficha de color con relieve,
// el rayo de Vendia tenue en sus colores, barrita que se vacía con el tiempo
// y entrada con rebote suave. Los estilos viven en index.css (`.vt-toast`).
// La API no cambia: notify(mensaje, "success" | "error" | "warning" | "info").

const ToastContext = createContext(null);

export const useToast = () => useContext(ToastContext);

const DURATION = 3500;

const toastMethods = {
  info: sonnerToast.info,
  warning: sonnerToast.warning,
  warn: sonnerToast.warning,
  error: sonnerToast.error,
  success: sonnerToast.success,
};

const icons = {
  info: <Info size={18} strokeWidth={2.6} />,
  warning: <TriangleAlert size={18} strokeWidth={2.6} />,
  error: <X size={18} strokeWidth={2.8} />,
  success: <Check size={18} strokeWidth={2.8} />,
};

const ToastProvider = ({ children }) => {
  const notify = useCallback((message, severity = "success") => {
    const method = toastMethods[severity] || sonnerToast;
    method(message, { icon: icons[severity === "warn" ? "warning" : severity] || icons.info });
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <Toaster
        position="bottom-center"
        closeButton
        icons={icons}
        style={{ "--vt-toast-duration": `${DURATION}ms`, "--width": "400px" }}
        toastOptions={{
          duration: DURATION,
          unstyled: true,
          classNames: {
            toast: "vt-toast",
            icon: "vt-toast-icon",
            content: "vt-toast-content",
            title: "vt-toast-title",
            description: "vt-toast-description",
            closeButton: "vt-toast-close",
            actionButton: "vt-toast-action",
            cancelButton: "vt-toast-cancel",
          },
        }}
      />
    </ToastContext.Provider>
  );
};

export default ToastProvider;
