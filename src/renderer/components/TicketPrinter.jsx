import React, { forwardRef, useId } from "react";

import { cn } from "@/lib/utils";

// Tiempos de la escena de primera configuración; la animación vive en index.css
// (.vt-*) y `SETUP_TICKET_MS` le dice al asistente cuándo salir.
export const SETUP_TICKET_MS = 4000;

const STATUS = [
  { title: "Guardando tu negocio", text: "Nombre y datos de la tienda", at: 200, length: 1200 },
  { title: "Protegiendo tu acceso", text: "NIP del administrador", at: 1350, length: 1050 },
  { title: "Preparando tu caja", text: "Moneda y ajustes de cobro", at: 2350, length: 1000 },
];

// Figura del logo en una sola tinta, para usarla de fondo. Conserva las tres
// piezas de build/brand/vendia-icon-oscuro.svg con distinta intensidad: sin el
// doblez del rayo la silueta se lee como otra figura. Va completa, sin recortar.
export const VendiaBolt = ({ className }) => (
  <svg className={className} viewBox="20 30 330 360" fill="currentColor" aria-hidden="true">
    <polygon points="178.8,262 339.4,48 200,380" opacity=".75" />
    <polygon points="130.7,215 164.3,181.4 200,380" opacity=".5" />
    <polygon points="32,102 94,40 116.1,163 154.1,125 164.3,181.4 130.7,215 94.6,251.1" />
  </svg>
);

// Sello de tinta con la figura del logo, en una sola tinta como un sello real.
export const VendiaSeal = () => {
  const arc = useId();
  return (
    <svg className="vt-seal" viewBox="0 0 100 100" role="img" aria-label="Sello de Vendia">
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path id={arc} d="M50 12a38 38 0 1 1-.01 0" fill="none" />
      <text fill="currentColor" fontSize="10.5" fontWeight="600">
        <textPath href={`#${arc}`} textLength="234" lengthAdjust="spacing">
          VENDIA • PUNTO DE VENTA •
        </textPath>
      </text>
      <g fill="currentColor" transform="translate(50 50) scale(.125) translate(-185.7 -214)">
        <polygon points="178.8,262 339.4,48 200,380" />
        <polygon points="32,102 94,40 116.1,163 154.1,125 200,380 130.7,215 94.6,251.1" opacity=".72" />
      </g>
    </svg>
  );
};

// Impresora con el papel saliendo. `ticketClassName` decide cómo avanza: sola en
// la configuración o al ritmo de la descarga real.
export const TicketPrinter = forwardRef(({ ticketClassName, children }, ref) => (
  <div className="vt-printer">
    <div className="vt-slot" />
    <div className="vt-feed">
      <div ref={ref} className={cn("vt-ticket", ticketClassName)}>
        {children}
        <VendiaSeal />
        <span className="vt-stamp">LISTO</span>
      </div>
    </div>
  </div>
));
TicketPrinter.displayName = "TicketPrinter";

// Cierre de la primera configuración. Los datos ya se guardaron antes de que
// aparezca: el ticket confirma lo guardado, no representa una espera real.
export const SetupTicketScene = ({ storeName, currency, children }) => {
  const today = new Date().toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return (
    <div className="vt-stage vt-scene-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 overflow-y-auto p-6 text-center text-white">
      {children}
      <TicketPrinter ticketClassName="vt-auto">
        <h4>{storeName}</h4>
        <div className="vt-sub">Caja principal · {today}</div>
        <hr />
        <div className="vt-row"><span>Tu negocio</span><em>✓</em></div>
        <div className="vt-row"><span>NIP de admin</span><em>✓</em></div>
        <div className="vt-row"><span>Moneda {currency}</span><em>✓</em></div>
        <div className="vt-row"><span>Caja de cobro</span><em>✓</em></div>
        <hr />
        <div className="vt-row vt-total"><span>TOTAL</span><span>$0.00</span></div>
        <div className="vt-sub vt-left">Folio 0001</div>
      </TicketPrinter>
      <div className="vt-status" aria-live="polite">
        {STATUS.map((s) => (
          <div key={s.title} style={{ "--vt-at": `${s.at}ms`, "--vt-length": `${s.length}ms` }}>
            <b>{s.title}</b>
            <span>{s.text}</span>
          </div>
        ))}
        <div className="vt-last" style={{ "--vt-at": "3350ms" }}>
          <b>¡Todo listo!</b>
          <span>Entrando a tu caja de cobro</span>
        </div>
      </div>
    </div>
  );
};
