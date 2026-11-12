import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { VendiaBolt } from "../TicketPrinter";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      "sheet-overlay fixed inset-0 z-[1300] bg-black/50 backdrop-blur-sm",
      className
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-[1300] flex flex-col gap-4 rounded-lg bg-background shadow-lg",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b",
        bottom: "inset-x-0 bottom-0 border-t",
        // Laterales: debajo de la franja de la barra de título, así su
        // encabezado y su ✕ nunca quedan bajo los botones de Windows.
        left: "bottom-0 left-0 top-[var(--titlebar-h)] w-3/4 border-r sm:max-w-lg",
        right:
          "sheet-content-right bottom-0 right-0 top-[var(--titlebar-h)] w-3/4 border-l sm:max-w-lg",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
);

const SheetContent = React.forwardRef(
  ({ side = "right", className, children, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col space-y-2 border-b px-6 py-4",
      className
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }) => (
  <div
    className={cn(
      // Botones anchos sobre una franja suave (identidad de los paneles).
      "mt-auto flex flex-col-reverse gap-2 border-t bg-muted/50 px-6 py-4 sm:flex-row sm:justify-end sm:[&>button]:flex-1",
      className
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold tracking-tight text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

// Encabezado de marca de los paneles (igual que los modales): ficha azul
// marino, degradado suave arriba y el rayo de fondo. `children` va debajo
// (p. ej. píldoras o pestañas del panel).
const SheetBrandHeader = ({ icon, title, description, className, children }) => (
  <div className={cn("vt-sheet-band relative shrink-0 overflow-hidden px-6 pb-4 pt-5 pr-14", className)}>
    <VendiaBolt className="vt-sheet-bolt" />
    <div className="relative flex items-center gap-3">
      {icon && (
        <span className="vt-stage flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md [&>svg]:h-[19px] [&>svg]:w-[19px]">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <SheetTitle className="truncate text-base font-bold">{title}</SheetTitle>
        {description && (
          <SheetDescription className="mt-0.5 text-xs leading-snug">{description}</SheetDescription>
        )}
      </div>
    </div>
    {children && <div className="relative mt-3">{children}</div>}
  </div>
);
SheetBrandHeader.displayName = "SheetBrandHeader";

export {
  SheetBrandHeader,
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
