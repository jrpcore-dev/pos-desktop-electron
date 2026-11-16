import React, { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { HandCoins, ListOrdered, ReceiptText, Search } from "lucide-react";

import { useDbChanges } from "../../lib/useDbChanges";
import { fmtMoney } from "../../utils/format";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { StatCard } from "../ui/stat-card";
import { EmptyState } from "../ui/empty-state";
import { DateRangePicker } from "../ui/date-range-picker";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { CreditMovementList } from "./CreditMovementList";

// Historial general de fiado: ventas fiadas, abonos, ajustes y cancelaciones
// de todos los clientes en un periodo. Tocar una fila abre la cuenta del
// cliente (`onOpenCustomer`).

const ymd = (d) => d.format("YYYY-MM-DD");
const PRESETS = [
  { key: "today", label: "Hoy", get: () => ({ from: ymd(dayjs()), to: ymd(dayjs()) }) },
  { key: "week", label: "7 días", get: () => ({ from: ymd(dayjs().subtract(6, "day")), to: ymd(dayjs()) }) },
  { key: "month", label: "Este mes", get: () => ({ from: ymd(dayjs().startOf("month")), to: ymd(dayjs()) }) },
];

const TYPES = [
  { key: "all", label: "Todos" },
  { key: "charge", label: "Ventas fiadas" },
  { key: "payment", label: "Abonos" },
  { key: "adjustment", label: "Ajustes" },
  { key: "reversal", label: "Cancelaciones" },
];

const CreditHistory = ({ onOpenCustomer }) => {
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState(PRESETS[0].get);
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  // `silent` → refresco en vivo sin skeleton.
  const load = useCallback(
    async (silent = false) => {
      const id = ++reqId.current;
      if (!silent) setLoading(true);
      try {
        const res = await window.api.invoke("get-credit-movements", {
          startDate: range.from,
          endDate: range.to,
          type: type === "all" ? "" : type,
          query,
        });
        if (id === reqId.current) setData(res?.success ? res : { movements: [], totals: null, error: res?.error });
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [range, type, query],
  );

  // El buscador espera a que se deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => load(), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  useDbChanges(() => load(true), ["customers", "sales", "cash_register"]);

  const pickPreset = (key) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPreset(key);
    setRange(p.get());
  };

  const applyRange = (r) => {
    if (!r) return pickPreset("today");
    setPreset("custom");
    setRange({ from: r.from, to: r.to || r.from });
  };

  const totals = data?.totals;
  const movements = data?.movements || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          prominent
          size="sm"
          icon={<ReceiptText />}
          tone="destructive"
          label="Ventas fiadas"
          value={fmtMoney(totals?.charged || 0)}
          caption="en el periodo"
          loading={loading && !data}
        />
        <StatCard
          prominent
          size="sm"
          icon={<HandCoins />}
          tone="success"
          label="Cobrado (abonos)"
          value={fmtMoney(totals?.paid || 0)}
          caption="en el periodo"
          loading={loading && !data}
        />
        <StatCard
          prominent
          size="sm"
          icon={<ListOrdered />}
          tone="primary"
          label="Movimientos"
          value={totals?.count ?? 0}
          caption={totals && totals.count > movements.length ? `mostrando ${movements.length}` : "en el periodo"}
          loading={loading && !data}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={preset} onValueChange={pickPreset}>
          <TabsList aria-label="Periodo">
            {PRESETS.map((p) => (
              <TabsTrigger key={p.key} value={p.key}>
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DateRangePicker
          value={preset === "custom" ? range : null}
          onApply={applyRange}
          placeholder="Rango"
          align="start"
        />
        <div className="relative ml-auto w-full sm:w-64">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente…"
            className="h-10 pl-9"
            aria-label="Buscar cliente en los movimientos"
          />
        </div>
      </div>

      <Tabs value={type} onValueChange={setType}>
        <TabsList aria-label="Tipo de movimiento" className="h-auto flex-wrap justify-start">
          {TYPES.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="max-h-[calc(100vh-27rem)] min-h-48 overflow-auto rounded-xl border border-border bg-card shadow-md">
        {loading && !data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : movements.length === 0 ? (
          <EmptyState
            className="py-12"
            title={data?.error ? "No se pudo cargar el historial" : "Sin movimientos en este periodo"}
            description={
              data?.error ||
              "Aquí aparecen las ventas fiadas, abonos, ajustes y cancelaciones de todos los clientes."
            }
          />
        ) : (
          <CreditMovementList movements={movements} showCustomer onOpenCustomer={onOpenCustomer} />
        )}
      </div>
    </div>
  );
};

export default CreditHistory;
