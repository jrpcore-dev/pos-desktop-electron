import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { VendiaBolt } from "../TicketPrinter";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[1300] bg-black/60 backdrop-blur-sm",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// `brand`: quita el relleno para usar DialogBrandHeader, cuerpo propio y
// DialogBrandFooter. El degradado y el rayo son del fondo de todo modal (ver
// .dialog-content en index.css): no mueven el contenido.
const BRAND_CONTENT = "gap-0 p-0";

const DialogContent = React.forwardRef(({ className, children, overlayClassName, brand = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "dialog-content fixed left-[50%] top-[50%] z-[1301] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 bg-background p-6 shadow-[0_0_0_1px_hsl(var(--border)/0.6),0_16px_32px_-14px_hsl(222_47%_11%_/_0.4),0_40px_72px_-36px_hsl(222_47%_11%_/_0.5)] sm:rounded-2xl overflow-hidden",
        brand && BRAND_CONTENT,
        className
      )}
      {...props}
    >
      <VendiaBolt className="vt-dialog-bolt" />
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-sm p-1 opacity-70 ring-offset-background transition-all hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Cerrar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

// Encabezado de marca para los momentos clave: chip con el degradado fuerte.
const DialogBrandHeader = ({ icon, title, description, className }) => (
  <div className={cn("px-6 pb-1 pt-5", className)}>
    <div className="relative flex items-center gap-3 pr-20">
      <span className="vt-stage flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
        {icon}
      </span>
      <div className="min-w-0">
        <DialogTitle className="text-base font-bold">{title}</DialogTitle>
        {description && (
          <DialogDescription className="mt-0.5 text-xs leading-snug">{description}</DialogDescription>
        )}
      </div>
    </div>
  </div>
);

const DialogBrandFooter = ({ className, ...props }) => (
  <div
    className={cn("flex items-center justify-between gap-2 px-6 pb-6 pt-1", className)}
    {...props}
  />
);

export {
  DialogBrandHeader,
  DialogBrandFooter,
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
