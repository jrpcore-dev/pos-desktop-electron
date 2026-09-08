import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

/**
 * Primitivas de re-dimensionado propias (sin dependencia externa).
 * Implementan la API de `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle`
 * de shadcn/ui usando primitivas ya presentes en el proyecto
 * (`@radix-ui/react-slot` + lógica de puntero con cleanup).
 *
 * Las medidas (`defaultSize`, `minSize`, `maxSize`) se trabajan en píxeles,
 * coherente con la lógica original del panel del carrito.
 *
 * Un `ResizableHandle` redimensiona el `ResizablePanel` que le precede en el DOM.
 */

const ResizableContext = React.createContext(null);

const RESIZE_ORIENTATIONS = {
  horizontal: { flex: "flex-row", cursor: "col-resize", aria: "horizontal" },
  vertical: { flex: "flex-col", cursor: "row-resize", aria: "vertical" },
};

const ResizablePanelGroup = React.forwardRef(
  ({ className, orientation = "horizontal", asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    const containerRef = React.useRef(null);
    React.useImperativeHandle(ref, () => containerRef.current, []);

    const panelsRef = React.useRef([]);

    const registerPanel = React.useCallback((el, setSize, minSize, maxSize, maxSizeFraction) => {
      const panels = panelsRef.current;
      const existing = panels.findIndex((p) => p.el === el);
      const entry = { el, setSize, minSize, maxSize, maxSizeFraction };
      if (existing >= 0) panels[existing] = entry;
      else panels.push(entry);
      return () => {
        const idx = panels.findIndex((p) => p.el === el);
        if (idx >= 0) panels.splice(idx, 1);
      };
    }, []);

    const resizePanel = React.useCallback(
      (panelEl, nextPx) => {
        const panel = panelsRef.current.find((p) => p.el === panelEl);
        if (!panel) return;
        const container = containerRef.current;
        const bound = container
          ? orientation === "horizontal"
            ? container.clientWidth
            : container.clientHeight
          : nextPx;
        const fractionBound = bound * (panel.maxSizeFraction ?? 1);
        const max = panel.maxSize != null ? Math.min(panel.maxSize, fractionBound) : fractionBound;
        const clamped = Math.min(Math.max(nextPx, panel.minSize), max);
        panel.setSize(clamped);
      },
      [orientation]
    );

    return (
      <ResizableContext.Provider
        value={{ orientation, registerPanel, resizePanel }}
      >
        <Comp
          ref={containerRef}
          data-orientation={orientation}
          className={cn(
            "flex h-full w-full gap-0 overflow-hidden",
            RESIZE_ORIENTATIONS[orientation].flex,
            className
          )}
          {...props}
        >
          {children}
        </Comp>
      </ResizableContext.Provider>
    );
  }
);
ResizablePanelGroup.displayName = "ResizablePanelGroup";

const ResizablePanel = React.forwardRef(
  (
    { className, defaultSize = 0, minSize = 0, maxSize, maxSizeFraction, collapsed = false, onResizeEnd, style, ...props },
    ref
  ) => {
    const context = React.useContext(ResizableContext);
    const outerRef = React.useRef(null);
    React.useImperativeHandle(ref, () => outerRef.current, []);

    const [size, setSize] = React.useState(defaultSize);
    const onResizeEndRef = React.useRef(onResizeEnd);
    onResizeEndRef.current = onResizeEnd;

    const applySize = React.useCallback(
      (value) => {
        setSize(value);
        onResizeEndRef.current?.(value);
      },
      []
    );

    React.useEffect(() => {
      if (!outerRef.current || !context) return;
      const unregister = context.registerPanel(outerRef.current, applySize, minSize, maxSize, maxSizeFraction);
      return unregister;
    }, [context, applySize, minSize, maxSize, maxSizeFraction]);

    const isVertical = context?.orientation === "vertical";
    const displaySize = collapsed ? minSize : size;

    return (
      <div
        ref={outerRef}
        style={{
          ...style,
          [isVertical ? "height" : "width"]: displaySize,
        }}
        data-collapsed={collapsed ? "" : undefined}
        {...props}
        className={cn("relative", className)}
      />
    );
  }
);
ResizablePanel.displayName = "ResizablePanel";

const ResizableHandle = React.forwardRef(
  ({ className, withHandle = false, target = "prev", onMouseDown: onMouseDownProp, ...props }, ref) => {
    const context = React.useContext(ResizableContext);
    const handleRef = React.useRef(null);
    React.useImperativeHandle(ref, () => handleRef.current, []);

    const orientation = context?.orientation ?? "horizontal";
    const { flex, cursor, aria } = RESIZE_ORIENTATIONS[orientation];
    const isHorizontal = orientation === "horizontal";
    const dragRef = React.useRef(null);

    const cleanup = React.useCallback(() => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.onMove) window.removeEventListener("mousemove", drag.onMove);
      if (drag.onUp) window.removeEventListener("mouseup", drag.onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragRef.current = null;
    }, []);

    const onUp = React.useCallback(() => {
      cleanup();
    }, [cleanup]);

    const onMove = React.useCallback(
      (ev) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = isHorizontal ? ev.clientX - drag.startX : ev.clientY - drag.startY;
        const nextSize =
          target === "next" ? drag.startSize - delta : drag.startSize + delta;
        context?.resizePanel?.(drag.panelEl, Math.max(0, nextSize));
      },
      [context, isHorizontal, target]
    );

    const startDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onMouseDownProp?.(e);

      const panelEl =
        target === "next"
          ? handleRef.current?.nextElementSibling
          : handleRef.current?.previousElementSibling;
      if (!panelEl) return;

      const rect = panelEl.getBoundingClientRect?.();
      if (rect == null) return;

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startSize: isHorizontal ? rect.width : rect.height,
        panelEl,
        onMove,
        onUp,
      };
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    return (
      <div
        ref={handleRef}
        role="separator"
        tabIndex={0}
        aria-orientation={aria}
        onMouseDown={startDrag}
        className={cn(
          "relative flex items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isHorizontal
            ? "w-[7px] cursor-col-resize"
            : "h-[7px] cursor-row-resize",
          className
        )}
        {...props}
      >
        {withHandle ? (
          <span
            className={cn(
              "z-10 flex items-center justify-center rounded-full border border-border bg-background",
              isHorizontal ? "h-10 w-1.5" : "h-1.5 w-10"
            )}
          />
        ) : null}
      </div>
    );
  }
);
ResizableHandle.displayName = "ResizableHandle";

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };