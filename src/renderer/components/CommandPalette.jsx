import React from "react";
import {
  Banknote,
  CalendarDays,
  Keyboard,
  LogOut,
  Moon,
  RefreshCw,
  Scale,
  ScanLine,
  Settings,
  Sun,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Kbd } from "./ui/kbd";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────
   Paleta de comandos (Ctrl/⌘ + K).
   Busca pantallas (por nombre y por sección) y ejecuta acciones
   globales del sistema. Usa cmdk dentro de un Dialog de Radix.
──────────────────────────────────────────────────────────── */

function RowIcon({ children }) {
  return (
    <span className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">
      {children}
    </span>
  );
}

const CommandPalette = ({
  open,
  onOpenChange,
  sections = [],
  register,
  isDark,
  onToggleTheme,
  onOpenScale,
  onOpenTasks,
  onOpenShortcuts,
  onRefreshPulse,
  onLogout,
}) => {
  const navigate = useNavigate();

  const go = (path) => {
    onOpenChange(false);
    navigate(path);
  };

  const run = (fn) => {
    onOpenChange(false);
    fn?.();
  };

  const registerOpen = register?.status === "open";

  const actions = [
    {
      id: "sale",
      label: registerOpen ? "Ir a Corte de caja" : "Abrir caja",
      icon: <Banknote />,
      hint: "F5",
      onSelect: () => go("/end-of-day"),
    },
    {
      id: "terminal",
      label: "Ir a Terminal de Venta",
      icon: <ScanLine />,
      hint: "F5",
      onSelect: () => go("/"),
    },
    {
      id: "theme",
      label: isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
      icon: isDark ? <Sun /> : <Moon />,
      onSelect: () => run(onToggleTheme),
    },
    {
      id: "scale",
      label: "Conectar o probar báscula",
      icon: <Scale />,
      onSelect: () => run(onOpenScale),
    },
    {
      id: "tasks",
      label: "Tareas del día",
      icon: <CalendarDays />,
      onSelect: () => run(onOpenTasks),
    },
    {
      id: "pulse",
      label: "Generar pulso semanal",
      icon: <RefreshCw />,
      onSelect: () => run(onRefreshPulse),
    },
    {
      id: "config",
      label: "Abrir Configuración",
      icon: <Settings />,
      onSelect: () => go("/configuration"),
    },
    {
      id: "shortcuts",
      label: "Ver atajos de teclado",
      icon: <Keyboard />,
      hint: "F1",
      onSelect: () => run(onOpenShortcuts),
    },
    {
      id: "logout",
      label: "Cerrar sesión",
      icon: <LogOut />,
      onSelect: () => run(onLogout),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 border-border/80 p-0 shadow-2xl sm:rounded-xl">
        <DialogTitle className="sr-only">Buscar o ejecutar una acción</DialogTitle>

        <Command loop>
          <CommandInput
            placeholder="Busca una pantalla o una acción…"
            className="text-[15px]"
          />

          <CommandList className="max-h-[52vh] py-1.5">
            <CommandEmpty className="px-4 py-8 text-center text-sm text-muted-foreground">
              Sin resultados para esa búsqueda.
            </CommandEmpty>

            {sections.map((section) => (
              <CommandGroup
                key={section.title}
                heading={section.title}
                className="[&_[cmdk-group-heading]]:px-3.5"
              >
                {section.items.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`${item.text} ${section.title}`}
                    onSelect={() => go(item.path)}
                    className="mx-1.5 gap-0 px-2 py-2 data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-primary/40"
                  >
                    <RowIcon>{item.icon}</RowIcon>
                    <span className="truncate text-[14px] font-medium">
                      {item.text}
                    </span>
                    <span className="ml-auto pl-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {section.title}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            <CommandGroup
              heading="Acciones"
              className="[&_[cmdk-group-heading]]:px-3.5"
            >
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  value={action.label}
                  onSelect={action.onSelect}
                  className="mx-1.5 gap-0 px-2 py-2 data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-primary/40"
                >
                  <RowIcon>{action.icon}</RowIcon>
                  <span
                    className={cn(
                      "truncate text-[14px] font-medium",
                      action.id === "logout" && "text-destructive",
                    )}
                  >
                    {action.label}
                  </span>
                  {action.hint && (
                    <span className="ml-auto pl-3">
                      <Kbd className="h-5 px-1.5 text-[10px] shadow-none">
                        {action.hint}
                      </Kbd>
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">↑</Kbd>
              <Kbd className="h-5 px-1.5 text-[10px] shadow-none">↓</Kbd>
              navegar
              <Kbd className="ml-1 h-5 px-1.5 text-[10px] shadow-none">
                Enter
              </Kbd>
              abrir
              <Kbd className="ml-1 h-5 px-1.5 text-[10px] shadow-none">
                Esc
              </Kbd>
              cerrar
            </span>
            <span className="hidden font-medium tracking-wide uppercase sm:inline">
              Ctrl + K
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
