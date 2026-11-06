import React, { useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";

import { fmtMoney } from "@/utils/format";
import { Button } from "./ui/button";
import { VendiaBolt, VendiaSeal } from "./TicketPrinter";

// SQLite guarda `closed_at` en UTC sin zona; un ISO ya trae la suya.
const fmtClosedAt = (value) => {
  if (!value) return "";
  const raw = String(value);
  const date = new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
};

// Caja cerrada: lo primero que se ve cada día. El botón sólo avisa a EndOfDay,
// que abre el mismo diálogo de siempre.
const OpenRegisterCard = ({ lastClose, salesToday = 0, salesCount = 0, onOpen }) => {
  const [storeName, setStoreName] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => window.api.invoke("get-setting", "store_name"))
      .then((name) => {
        if (alive && typeof name === "string") setStoreName(name.trim());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const hasLastClose = lastClose?.declared_close != null;
  const opening = hasLastClose ? Number(lastClose.declared_close) || 0 : 0;
  const closedAt = fmtClosedAt(lastClose?.closed_at);
  const today = useMemo(
    () =>
      new Date().toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    [],
  );

  return (
    <section className="vt-stage relative mb-3 grid items-center gap-6 overflow-hidden rounded-2xl p-8 text-white shadow-[0_1px_2px_hsl(222_47%_11%_/_0.1),0_16px_32px_-14px_hsl(222_47%_11%_/_0.4),0_40px_72px_-36px_hsl(222_47%_11%_/_0.5)] lg:grid-cols-[minmax(0,1fr)_290px]">
      <VendiaBolt className="pointer-events-none absolute right-[340px] top-1/2 h-[280px] w-[258px] -translate-y-1/2 text-white opacity-[0.09]" />

      <div className="relative flex min-w-0 flex-col items-start gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-white/70">Caja cerrada</span>
        <h2 className="text-4xl font-bold leading-tight tracking-tight">Todo listo para abrir tu caja</h2>
        <p className="max-w-md text-white/80">
          {hasLastClose
            ? "Empieza el turno con el efectivo que dejaste en el último cierre."
            : "Abre una caja para comenzar a vender."}
        </p>

        {(hasLastClose || salesCount > 0) && (
          <dl className="mt-2 flex flex-wrap gap-x-7 gap-y-2">
            {hasLastClose && (
              <div className="flex flex-col-reverse">
                <dt className="text-sm text-white/75">Último cierre</dt>
                <dd className="text-xl font-bold tabular-nums">{fmtMoney(lastClose.declared_close)}</dd>
              </div>
            )}
            {closedAt && (
              <div className="flex flex-col-reverse">
                <dt className="text-sm text-white/75">Fecha del cierre</dt>
                <dd className="text-xl font-bold tabular-nums">{closedAt}</dd>
              </div>
            )}
            {salesCount > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="text-sm text-white/75">
                  Vendido hoy · {salesCount} {salesCount === 1 ? "venta" : "ventas"}
                </dt>
                <dd className="text-xl font-bold tabular-nums">{fmtMoney(salesToday)}</dd>
              </div>
            )}
          </dl>
        )}

        <Button
          size="lg"
          onClick={onOpen}
          className="mt-4 bg-white text-slate-900 shadow-lg hover:bg-white/90"
        >
          <Store size={18} />
          Abrir caja
        </Button>
      </div>

      <div className="relative hidden w-[240px] rotate-[4deg] justify-self-center drop-shadow-[0_14px_18px_rgb(0_0_0_/_0.4)] lg:block" aria-hidden="true">
        <div className="vt-ticket">
          <h4>{storeName || "Tu negocio"}</h4>
          <div className="vt-sub">Turno nuevo · {today}</div>
          <hr />
          <div className="vt-row">
            <span>Fondo inicial</span>
            <span>{fmtMoney(opening)}</span>
          </div>
          <div className="vt-row">
            <span>Ventas</span>
            <span>{fmtMoney(0)}</span>
          </div>
          <hr />
          <div className="vt-row vt-total">
            <span>TOTAL</span>
            <span>{fmtMoney(opening)}</span>
          </div>
          <VendiaSeal />
        </div>
      </div>
    </section>
  );
};

export default OpenRegisterCard;
