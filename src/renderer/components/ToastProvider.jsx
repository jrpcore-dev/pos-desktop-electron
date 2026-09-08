import React, { createContext, useContext, useCallback } from "react";
import { Toaster, toast as sonnerToast } from "sonner";
import { CheckCircle2, XCircle, TriangleAlert, Info } from "lucide-react";

const ToastContext = createContext(null);

export const useToast = () => useContext(ToastContext);

const toastMethods = {
  info: sonnerToast.info,
  warning: sonnerToast.warning,
  warn: sonnerToast.warning,
  error: sonnerToast.error,
  success: sonnerToast.success,
};

const icons = {
  info: <Info className="h-[22px] w-[22px]" />,
  warning: <TriangleAlert className="h-[22px] w-[22px]" />,
  error: <XCircle className="h-[22px] w-[22px]" />,
  success: <CheckCircle2 className="h-[22px] w-[22px]" />,
};

const ToastProvider = ({ children }) => {
  const notify = useCallback((message, severity = "success") => {
    const method = toastMethods[severity] || sonnerToast;
    method(message, { icon: icons[severity] || icons.info });
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <Toaster
        position="bottom-center"
        closeButton
        richColors
        icons={icons}
        toastOptions={{
          duration: 3500,
          classNames: {
            toast:
              "!px-4 !py-3 !shadow-lg !rounded-lg !border-l-4 !border-solid",
            success: "!border-l-success",
            error: "!border-l-destructive",
            warning: "!border-l-warning",
            info: "!border-l-info",
            title: "!text-base !font-bold",
            description: "!text-sm",
            icon: "!h-[24px] !w-[24px]",
            closeButton: "!size-6",
          },
        }}
      />
    </ToastContext.Provider>
  );
};

export default ToastProvider;