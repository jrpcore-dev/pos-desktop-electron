import { buildReceiptHTML } from "@/utils/receiptTemplate";
import { prepareTicketLogo } from "@/utils/logo";
import { maskInput } from "./serviceStatus";

// Comprobante de una recarga, pago o tarjeta de Taecel, al terminar: el ticket
// de la tienda con la compañía, el número (enmascarado), el monto y, abajo,
// el folio y la referencia del operador para cualquier aclaración.
const METHOD = { cash: "EFECTIVO", card: "TARJETA", transfer: "TRANSFERENCIA" };

export const printServiceReceipt = async (tx, { cashierName } = {}) => {
  const get = (key) => window.api.invoke("get-setting", key);
  const [storeName, storeLogo, headerNote, footerNote, paperWidthMm] = await Promise.all([
    get("store_name"),
    get("store_logo"),
    get("print_header_note"),
    get("print_footer_note"),
    get("paper_width_mm"),
  ]);
  const total = (Number(tx?.quote?.totalCents) || 0) / 100;
  const number = tx?.inputValue ? maskInput(tx.inputValue) : "";
  const name = `${tx?.operatorName || "Recarga"}${number ? ` ${number}` : ""}`;
  const proof = [
    tx?.folio ? `Folio: ${tx.folio}` : null,
    tx?.providerRef ? `Referencia: ${tx.providerRef}` : null,
    tx?.productName ? tx.productName : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const html = buildReceiptHTML({
    store: {
      name: (storeName || "MI TIENDA").toUpperCase(),
      logo: await prepareTicketLogo(storeLogo),
    },
    headerNote: headerNote || "",
    footerNote: [proof, footerNote || ""].filter(Boolean).join(" · "),
    ticketNum: tx?.saleFolio || tx?.folio || "",
    date: tx?.createdAt ? new Date(tx.createdAt) : new Date(),
    cashierName: cashierName || tx?.cashierName || "Usuario",
    items: [
      {
        name: name.length > 24 ? `${name.slice(0, 22)}..` : name,
        qtyDisplay: 1,
        unit: "",
        unitPrice: total,
        lineTotal: total,
        discountLabel: null,
      },
    ],
    subtotal: total,
    showDiscounts: false,
    discountTotal: 0,
    total,
    methodLabel: METHOD[tx?.paymentMethod] || "EFECTIVO",
    paperWidthMm: paperWidthMm ?? 58,
  });
  return window.api.invoke("print-receipt", html);
};
