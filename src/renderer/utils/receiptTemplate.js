const pad = (n) =>
  Number(n || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function buildReceiptHTML(model) {
  const {
    store = {},
    headerNote = "",
    footerNote = "",
    ticketNum = "",
    date = new Date(),
    cashierName = "Usuario Principal",
    items = [],
    subtotal = 0,
    showDiscounts = false,
    discountTotal = 0,
    total = 0,
    methodLabel = "EFECTIVO",
    isCash = false,
    received = 0,
    change = 0,
  } = model || {};

  const lines = [];

  lines.push(
    `<div style="text-align:center;font-weight:bold;font-size:18px;line-height:1.1;margin:0;text-transform:uppercase;letter-spacing:0.5px">${esc(store.name || "MI TIENDA POS")}</div>`,
  );
  if (store.logo) {
    lines.push(
      `<div style="text-align:center;margin:2px 0 0"><img src="${store.logo}" style="max-height:75px;max-width:48mm;width:auto;height:auto;display:inline-block"/></div>`,
    );
  }
  lines.push(
    `<div style="text-align:center;font-size:10px;letter-spacing:0.5px;margin-top:2px">${esc(headerNote || "Sistema de Punto de Venta")}</div>`,
  );
  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="text-align:center;font-size:10px">${date.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Mexico_City" })}<br>${date.toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}</div>`,
  );
  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="font-size:11px;display:flex;justify-content:space-between"><span>Cajero:</span><span>${esc(cashierName)}</span></div>`,
  );
  lines.push(
    `<div style="font-size:11px;display:flex;justify-content:space-between"><span>Ticket #:</span><span>${esc(ticketNum)}</span></div>`,
  );
  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="text-align:center;font-weight:bold;font-size:12px">DETALLE DE COMPRA</div>`,
  );
  lines.push(`<div class="sep"></div>`);

  items.forEach((it) => {
    lines.push(
      `<div style="font-weight:bold;font-size:12px">${esc(it.name)}</div>`,
    );
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-size:10px"><span>${it.qtyDisplay} ${it.unit} x $${pad(it.unitPrice)}</span><span>$${pad(it.lineTotal)}</span></div>`,
    );
    if (it.promoLabel) {
      lines.push(
        `<div style="text-align:center;font-size:10px;color:purple">${esc(it.promoLabel)}</div>`,
      );
    }
    if (it.discountLabel) {
      lines.push(
        `<div style="text-align:center;font-size:10px;color:red">Descuento: ${esc(it.discountLabel)}</div>`,
      );
    }
    lines.push(
      `<div style="border-bottom:1px dotted #ccc;margin:3px 0"></div>`,
    );
  });

  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Subtotal:</span><span>$${pad(subtotal)}</span></div>`,
  );
  if (showDiscounts) {
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Descuentos:</span><span>-$${pad(discountTotal)}</span></div>`,
    );
  }
  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:1px 0"><span>TOTAL:</span><span>$${pad(total)}</span></div>`,
  );
  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Metodo:</span><span><strong>${esc(methodLabel)}</strong></span></div>`,
  );
  if (isCash) {
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Recibido:</span><span>$${pad(received)}</span></div>`,
    );
    lines.push(
      `<div style="display:flex;justify-content:space-between;font-size:11px"><span>Cambio:</span><span>$${pad(change)}</span></div>`,
    );
  }
  lines.push(`<div class="sep"></div>`);
  lines.push(
    `<div style="text-align:center;font-weight:bold;font-size:13px">${esc(footerNote || "¡GRACIAS POR SU COMPRA!")}</div>`,
  );
  lines.push(
    `<div style="text-align:center;font-size:10px">Conserve este ticket</div>`,
  );
  lines.push(
    `<div style="text-align:center;font-size:9px;margin-top:5px">Vendia</div>`,
  );
  lines.push(`<div style="height:20px"></div>`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:58mm auto;margin:0}
      *{box-sizing:border-box}
      body{font-family:'Courier New',monospace;font-size:11px;margin:0 auto;padding:2px 2px;width:48mm;max-width:48mm;background:white;color:black;overflow-wrap:break-word}
      .sep{border-top:1px dashed #333;margin:5px 0}
    </style></head><body>${lines.join("")}</body></html>`;
}
