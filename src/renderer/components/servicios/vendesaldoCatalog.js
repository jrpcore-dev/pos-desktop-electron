/**
 * Catálogo REAL de Vendesaldo (2026-10-08).
 * Snapshot de obtenerProductos: 23 operadores, 246 productos.
 * La respuesta del proveedor se normaliza a esta misma forma con el adaptador.
 */

export const AIRTIME = "airtime";
export const GIFTCARD = "giftcard";
export const BILL = "bill";

export const KIND_LABEL = {
  [AIRTIME]: "Tiempo aire",
  [GIFTCARD]: "Tarjeta",
  [BILL]: "Pago de servicio",
};

export const CAT_TABS = [
  { key: "all", name: "Todas" },
  { key: "telefonia", name: "Recargas" },
  { key: "paquetes", name: "Paquetes" },
  { key: "servicios", name: "Servicios" },
];

const PHONE = { kind: "phone", label: "Número de teléfono", placeholder: "10 dígitos", hint: "A nombre del titular", numeric: true, min: 10, max: 10 };
const CONTRACT = { kind: "contract", label: "Número de referencia", placeholder: "En tu recibo", hint: "Impreso en el recibo", numeric: true, min: 8, max: 12 };

export const OPERATORS = [
  {
    "key": "ABIB",
    "name": "Abib",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "50",
        "name": "ABIB 50",
        "amountCents": 5000
      },
      {
        "sku": "60",
        "name": "ABIB 60",
        "amountCents": 6000
      },
      {
        "sku": "80",
        "name": "ABIB 80",
        "amountCents": 8000
      },
      {
        "sku": "100",
        "name": "ABIB 100",
        "amountCents": 10000
      },
      {
        "sku": "130",
        "name": "ABIB 130",
        "amountCents": 13000
      },
      {
        "sku": "150",
        "name": "ABIB 150",
        "amountCents": 15000
      },
      {
        "sku": "155",
        "name": "ABIB 155",
        "amountCents": 15500
      },
      {
        "sku": "200",
        "name": "ABIB 200",
        "amountCents": 20000
      },
      {
        "sku": "240",
        "name": "ABIB 240",
        "amountCents": 24000
      }
    ]
  },
  {
    "key": "AXIOS",
    "name": "Axios",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "40",
        "name": "AXIOS 40",
        "amountCents": 4000
      },
      {
        "sku": "50",
        "name": "AXIOS 50",
        "amountCents": 5000
      },
      {
        "sku": "70",
        "name": "AXIOS 70",
        "amountCents": 7000
      },
      {
        "sku": "100",
        "name": "AXIOS 100 (30 dias)",
        "amountCents": 10000
      },
      {
        "sku": "130",
        "name": "AXIOS 130",
        "amountCents": 13000
      },
      {
        "sku": "150",
        "name": "AXIOS 150",
        "amountCents": 15000
      },
      {
        "sku": "190",
        "name": "AXIOS 190",
        "amountCents": 19000
      },
      {
        "sku": "250",
        "name": "AXIOS ILIMITADO 250",
        "amountCents": 25000
      },
      {
        "sku": "300",
        "name": "AXIOS ILIMITADO 300",
        "amountCents": 30000
      },
      {
        "sku": "500",
        "name": "AXIOS 500",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "BAIT",
    "name": "Bait",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "30",
        "name": "BAIT 30",
        "amountCents": 3000
      },
      {
        "sku": "50",
        "name": "BAIT 50",
        "amountCents": 5000
      },
      {
        "sku": "60",
        "name": "BAIT 60",
        "amountCents": 6000
      },
      {
        "sku": "99",
        "name": "BAIT Internet Casa 99",
        "amountCents": 9900
      },
      {
        "sku": "100",
        "name": "BAIT 100",
        "amountCents": 10000
      },
      {
        "sku": "110",
        "name": "BAIT Internet Portatil 110",
        "amountCents": 11000
      },
      {
        "sku": "120",
        "name": "BAIT 120",
        "amountCents": 12000
      },
      {
        "sku": "125",
        "name": "BAIT 125",
        "amountCents": 12500
      },
      {
        "sku": "135",
        "name": "BAIT 135 SALUD",
        "amountCents": 13500
      },
      {
        "sku": "200",
        "name": "BAIT 200",
        "amountCents": 20000
      },
      {
        "sku": "210",
        "name": "BAIT Internet Portatil 210",
        "amountCents": 21000
      },
      {
        "sku": "230",
        "name": "BAIT 230",
        "amountCents": 23000
      },
      {
        "sku": "300",
        "name": "BAIT 300",
        "amountCents": 30000
      },
      {
        "sku": "349",
        "name": "BAIT Internet Casa 349",
        "amountCents": 34900
      },
      {
        "sku": "410",
        "name": "BAIT Internet Portatil 410",
        "amountCents": 41000
      },
      {
        "sku": "550",
        "name": "BAIT Paquete 550",
        "amountCents": 55000
      },
      {
        "sku": "800",
        "name": "BAIT Paquete 800",
        "amountCents": 80000
      },
      {
        "sku": "1000",
        "name": "BAIT Paquete 1000",
        "amountCents": 100
      },
      {
        "sku": "1500",
        "name": "BAIT Paquete 1500",
        "amountCents": 100
      }
    ]
  },
  {
    "key": "BIENESTAR",
    "name": "Bienestar",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "50",
        "name": "INTERNET BIENESTAR 50",
        "amountCents": 5000
      },
      {
        "sku": "70",
        "name": "INTERNET BIENESTAR 70",
        "amountCents": 7000
      },
      {
        "sku": "99",
        "name": "INTERNET BIENESTAR 99 - 15 dias",
        "amountCents": 9900
      },
      {
        "sku": "100",
        "name": "INTERNET BIENESTAR 100 - 30 dias",
        "amountCents": 10000
      },
      {
        "sku": "130",
        "name": "INTERNET BIENESTAR 130",
        "amountCents": 13000
      },
      {
        "sku": "150",
        "name": "INTERNET BIENESTAR 150",
        "amountCents": 15000
      },
      {
        "sku": "190",
        "name": "INTERNET BIENESTAR 190",
        "amountCents": 19000
      },
      {
        "sku": "250",
        "name": "INTERNET BIENESTAR 250",
        "amountCents": 25000
      },
      {
        "sku": "300",
        "name": "INTERNET BIENESTAR 300",
        "amountCents": 30000
      }
    ]
  },
  {
    "key": "CFE",
    "name": "CFE",
    "logo": "cfe",
    "category": "servicios",
    "kind": "bill",
    "variant": "bill",
    "input": CONTRACT,
    "feeCents": 0,
    "products": [
      {
        "sku": "35",
        "name": "CFE 35",
        "amountCents": 3500
      },
      {
        "sku": "85",
        "name": "CFE 85",
        "amountCents": 8500
      },
      {
        "sku": "105",
        "name": "CFE 105",
        "amountCents": 10500
      },
      {
        "sku": "135",
        "name": "CFE 135",
        "amountCents": 13500
      },
      {
        "sku": "155",
        "name": "CFE 155",
        "amountCents": 15500
      },
      {
        "sku": "160",
        "name": "CFE 160",
        "amountCents": 16000
      },
      {
        "sku": "180",
        "name": "CFE 180",
        "amountCents": 18000
      },
      {
        "sku": "220",
        "name": "CFE 220",
        "amountCents": 22000
      },
      {
        "sku": "275",
        "name": "CFE 275",
        "amountCents": 27500
      },
      {
        "sku": "325",
        "name": "CFE 325",
        "amountCents": 32500
      },
      {
        "sku": "425",
        "name": "CFE 425",
        "amountCents": 42500
      },
      {
        "sku": "510",
        "name": "CFE 510",
        "amountCents": 51000
      }
    ]
  },
  {
    "key": "FLASH",
    "name": "Flash",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "10",
        "name": "RECARGA 10",
        "amountCents": 1000
      },
      {
        "sku": "20",
        "name": "RECARGA 20",
        "amountCents": 2000
      },
      {
        "sku": "30",
        "name": "RECARGA 30",
        "amountCents": 3000
      },
      {
        "sku": "40",
        "name": "RECARGA 40",
        "amountCents": 4000
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "60",
        "name": "RECARGA 60",
        "amountCents": 6000
      },
      {
        "sku": "70",
        "name": "RECARGA 70",
        "amountCents": 7000
      },
      {
        "sku": "80",
        "name": "RECARGA 80",
        "amountCents": 8000
      },
      {
        "sku": "120",
        "name": "RECARGA 120",
        "amountCents": 12000
      },
      {
        "sku": "150",
        "name": "RECARGA 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      },
      {
        "sku": "250",
        "name": "RECARGA 250",
        "amountCents": 25000
      },
      {
        "sku": "300",
        "name": "RECARGA 300",
        "amountCents": 30000
      },
      {
        "sku": "400",
        "name": "RECARGA 400",
        "amountCents": 40000
      },
      {
        "sku": "500",
        "name": "RECARGA 500",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "IUSACELL_ATT",
    "name": "AT&T",
    "logo": "att",
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "20",
        "name": "RECARGA 20",
        "amountCents": 2000
      },
      {
        "sku": "30",
        "name": "RECARGA 30",
        "amountCents": 3000
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "70",
        "name": "RECARGA 70",
        "amountCents": 7000
      },
      {
        "sku": "100",
        "name": "RECARGA 100",
        "amountCents": 10000
      },
      {
        "sku": "120",
        "name": "RECARGA 120",
        "amountCents": 12000
      },
      {
        "sku": "150",
        "name": "RECARGA 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      },
      {
        "sku": "300",
        "name": "RECARGA 300",
        "amountCents": 30000
      },
      {
        "sku": "500",
        "name": "RECARGA 500",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "JESNER",
    "name": "Jesner",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "15",
        "name": "CONTIGO $15 - 1 DIA 500 MB",
        "amountCents": 1500
      },
      {
        "sku": "45",
        "name": "CONTIGO $45 - 3 DIAS 2GB",
        "amountCents": 4500
      },
      {
        "sku": "70",
        "name": "CONTIGO $70 - 7 DIAS 6GB",
        "amountCents": 7000
      },
      {
        "sku": "110",
        "name": "CONTIGO $110 - 30 DIAS 2GB",
        "amountCents": 11000
      },
      {
        "sku": "140",
        "name": "CONTIGO $140 15 DIAS 10GB",
        "amountCents": 14000
      },
      {
        "sku": "160",
        "name": "CONTIGO $160 - 30 DIAS 4GB",
        "amountCents": 16000
      },
      {
        "sku": "200",
        "name": "CONTIGO $200 - 30 DIAS 10GB",
        "amountCents": 20000
      },
      {
        "sku": "250",
        "name": "CONTIGO $250 - 30 DIAS 12GB",
        "amountCents": 25000
      },
      {
        "sku": "350",
        "name": "CONTIGO $350 - 30 DIAS 24GB",
        "amountCents": 35000
      }
    ]
  },
  {
    "key": "MIMOVIL",
    "name": "Mi Móvil",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "50",
        "name": "MI MOVIL 50",
        "amountCents": 5000
      },
      {
        "sku": "80",
        "name": "MI MOVIL 80",
        "amountCents": 8000
      },
      {
        "sku": "100",
        "name": "MI MOVIL 100",
        "amountCents": 10000
      },
      {
        "sku": "150",
        "name": "MI MOVIL 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "MI MOVIL 200",
        "amountCents": 20000
      },
      {
        "sku": "280",
        "name": "MI MOVIL 280",
        "amountCents": 28000
      },
      {
        "sku": "400",
        "name": "MI MOVIL 400",
        "amountCents": 40000
      }
    ]
  },
  {
    "key": "MOVISTAR",
    "name": "Movistar",
    "logo": "movistar",
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "10",
        "name": "RECARGA 10",
        "amountCents": 1000
      },
      {
        "sku": "20",
        "name": "RECARGA 20",
        "amountCents": 2000
      },
      {
        "sku": "30",
        "name": "RECARGA 30",
        "amountCents": 3000
      },
      {
        "sku": "40",
        "name": "RECARGA 40",
        "amountCents": 4000
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "60",
        "name": "RECARGA 60",
        "amountCents": 6000
      },
      {
        "sku": "70",
        "name": "RECARGA 70",
        "amountCents": 7000
      },
      {
        "sku": "80",
        "name": "RECARGA 80",
        "amountCents": 8000
      },
      {
        "sku": "100",
        "name": "RECARGA 100",
        "amountCents": 10000
      },
      {
        "sku": "120",
        "name": "RECARGA 120",
        "amountCents": 12000
      },
      {
        "sku": "150",
        "name": "RECARGA 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      },
      {
        "sku": "250",
        "name": "RECARGA 250",
        "amountCents": 25000
      },
      {
        "sku": "300",
        "name": "RECARGA 300",
        "amountCents": 30000
      },
      {
        "sku": "400",
        "name": "RECARGA 400",
        "amountCents": 40000
      },
      {
        "sku": "500",
        "name": "RECARGA 500",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "NEWWW",
    "name": "Newww",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "80",
        "name": "NEWWW 80 6gb",
        "amountCents": 8000
      },
      {
        "sku": "130",
        "name": "NEWWW 130 2gb",
        "amountCents": 13000
      },
      {
        "sku": "180",
        "name": "NEWWW 180 4gb",
        "amountCents": 18000
      },
      {
        "sku": "250",
        "name": "NEWWW 250 12gb",
        "amountCents": 25000
      },
      {
        "sku": "300",
        "name": "NEWWW 300 24gb",
        "amountCents": 30000
      },
      {
        "sku": "500",
        "name": "NEWWW 500 ilim",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "NEXTEL",
    "name": "Nextel",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "30",
        "name": "RECARGA 30",
        "amountCents": 3000
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "100",
        "name": "RECARGA 100",
        "amountCents": 10000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      }
    ]
  },
  {
    "key": "OUI",
    "name": "Oui",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "10",
        "name": "OUI 10",
        "amountCents": 1000
      },
      {
        "sku": "15",
        "name": "OUI 15",
        "amountCents": 1500
      },
      {
        "sku": "20",
        "name": "OUI 20",
        "amountCents": 2000
      },
      {
        "sku": "25",
        "name": "OUI 25",
        "amountCents": 2500
      },
      {
        "sku": "30",
        "name": "OUI 30",
        "amountCents": 3000
      },
      {
        "sku": "35",
        "name": "OUI 35",
        "amountCents": 3500
      },
      {
        "sku": "40",
        "name": "OUI 40",
        "amountCents": 4000
      },
      {
        "sku": "45",
        "name": "OUI 45",
        "amountCents": 4500
      },
      {
        "sku": "50",
        "name": "OUI 50",
        "amountCents": 5000
      },
      {
        "sku": "60",
        "name": "OUI 60",
        "amountCents": 6000
      },
      {
        "sku": "80",
        "name": "OUI 80",
        "amountCents": 8000
      },
      {
        "sku": "100",
        "name": "OUI 100",
        "amountCents": 10000
      },
      {
        "sku": "120",
        "name": "OUI 120",
        "amountCents": 12000
      },
      {
        "sku": "150",
        "name": "OUI 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "OUI 200",
        "amountCents": 20000
      },
      {
        "sku": "240",
        "name": "OUI 240",
        "amountCents": 24000
      },
      {
        "sku": "300",
        "name": "OUI 300",
        "amountCents": 30000
      },
      {
        "sku": "350",
        "name": "OUI 350",
        "amountCents": 35000
      }
    ]
  },
  {
    "key": "PILLOFON",
    "name": "Pillofón",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "49",
        "name": "PILLOFON 49",
        "amountCents": 4900
      },
      {
        "sku": "99",
        "name": "PILLOFON 99",
        "amountCents": 9900
      },
      {
        "sku": "149",
        "name": "PILLOFON 149",
        "amountCents": 14900
      },
      {
        "sku": "229",
        "name": "PILLOFON 229",
        "amountCents": 22900
      },
      {
        "sku": "299",
        "name": "PILLOFON 299",
        "amountCents": 29900
      },
      {
        "sku": "399",
        "name": "PILLOFON 399",
        "amountCents": 39900
      },
      {
        "sku": "499",
        "name": "PILLOFON 499",
        "amountCents": 49900
      },
      {
        "sku": "699",
        "name": "PILLOFON 699",
        "amountCents": 69900
      }
    ]
  },
  {
    "key": "TELCEL",
    "name": "Telcel",
    "logo": "telcel",
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "10",
        "name": "RECARGA 10",
        "amountCents": 1000
      },
      {
        "sku": "20",
        "name": "RECARGA 20",
        "amountCents": 2000
      },
      {
        "sku": "30",
        "name": "RECARGA 30",
        "amountCents": 3000
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "80",
        "name": "RECARGA 80",
        "amountCents": 8000
      },
      {
        "sku": "100",
        "name": "RECARGA 100",
        "amountCents": 10000
      },
      {
        "sku": "150",
        "name": "RECARGA 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      },
      {
        "sku": "300",
        "name": "RECARGA 300",
        "amountCents": 30000
      },
      {
        "sku": "500",
        "name": "RECARGA 500",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "TELCEL_INTERNET_AMIGO",
    "name": "Telcel Internet Amigo",
    "logo": "telcel",
    "category": "paquetes",
    "kind": "airtime",
    "variant": "paquete",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "15",
        "name": "15 x 2 HORAS SOLO INTERNET",
        "amountCents": 1500
      },
      {
        "sku": "10005",
        "name": "INTERNET AMIGO 10 - 70MB WHATSAPP ILIMITADO 1d",
        "amountCents": 1000
      },
      {
        "sku": "20005",
        "name": "INTERNET AMIGO 20 - 120MB y 200MB REDES 2d",
        "amountCents": 2000
      },
      {
        "sku": "30005",
        "name": "INTERNET AMIGO 30 - 150MB  y 300MB REDES 3d",
        "amountCents": 3000
      },
      {
        "sku": "50005",
        "name": "INTERNET AMIGO 50 - 500MB y 750MB REDES 7d",
        "amountCents": 5000
      },
      {
        "sku": "100005",
        "name": "INTERNET AMIGO 100 - 1.6GB y Redes ilimitado 15d",
        "amountCents": 10000
      },
      {
        "sku": "150005",
        "name": "INTERNET AMIGO 150 - 2.5G y redes ilimitado 26d",
        "amountCents": 15000
      },
      {
        "sku": "200005",
        "name": "INTERNET AMIGO 200 - 3.5G  y redes ilimitado 30d",
        "amountCents": 20000
      },
      {
        "sku": "300005",
        "name": "INTERNET AMIGO 300 - 5GB  y redes ilimitado 30d",
        "amountCents": 30000
      },
      {
        "sku": "500005",
        "name": "INTERNET AMIGO 500 - 8G  y redes ilimitado 30d",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "TELCEL_SIN_LIMITE",
    "name": "Telcel Sin Límite",
    "logo": "telcel",
    "category": "paquetes",
    "kind": "airtime",
    "variant": "paquete",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "10006",
        "name": "$10 x 1 HORA SOLO INTERNET",
        "amountCents": 1000
      },
      {
        "sku": "10007",
        "name": "SIN LIMITE $10 - 50MB SMS LLAM 1d",
        "amountCents": 1000
      },
      {
        "sku": "20006",
        "name": "SIN LIMITE $20 - 100MB SMS LLAM 2d",
        "amountCents": 2000
      },
      {
        "sku": "25006",
        "name": "$25 x 4 HORAS SOLO INTERNET",
        "amountCents": 2500
      },
      {
        "sku": "30006",
        "name": "SIN LIMITE $30 - 160MB SMS LLAM 3d",
        "amountCents": 3000
      },
      {
        "sku": "50006",
        "name": "SIN LIMITE $50 - 400MB SMS LLAM 7d",
        "amountCents": 5000
      },
      {
        "sku": "80006",
        "name": "SIN LIMITE $80 - 1.5GB SMS LLAM 12d",
        "amountCents": 8000
      },
      {
        "sku": "100006",
        "name": "SIN LIMITE $100 - 1.3GB SMS LLAM 15d",
        "amountCents": 10000
      },
      {
        "sku": "150006",
        "name": "SIN LIMITE $150 - 2GB SMS LLAM 25d",
        "amountCents": 15000
      },
      {
        "sku": "200006",
        "name": "SIN LIMITE $200 - 3GB SMS LLAM 30d",
        "amountCents": 20000
      },
      {
        "sku": "270006",
        "name": "SIN LIMITE $270 - 3GB SMS LLAM 30d",
        "amountCents": 27000
      },
      {
        "sku": "300006",
        "name": "SIN LIMITE $300 - 4GB SMS LLAM 30d",
        "amountCents": 30000
      },
      {
        "sku": "400006",
        "name": "SIN LIMITE $400 - 5.5GB SMS LLAM 30d",
        "amountCents": 40000
      },
      {
        "sku": "500006",
        "name": "SIN LIMITE $500 - 8GB SMS LLAM 30d",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "TURBOCEL",
    "name": "Turbocel",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "40",
        "name": "TURBOCEL 40",
        "amountCents": 4000
      },
      {
        "sku": "80",
        "name": "TURBOCEL 80",
        "amountCents": 8000
      },
      {
        "sku": "250",
        "name": "TURBOCEL 250",
        "amountCents": 25000
      }
    ]
  },
  {
    "key": "ULTRACEL",
    "name": "Ultracel",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "55",
        "name": "ULTRACEL 55",
        "amountCents": 5500
      },
      {
        "sku": "80",
        "name": "ULTRACEL 80",
        "amountCents": 8000
      },
      {
        "sku": "99",
        "name": "ULTRACEL HOGAR 99",
        "amountCents": 9900
      },
      {
        "sku": "105",
        "name": "ULTRACEL 105",
        "amountCents": 10500
      },
      {
        "sku": "110",
        "name": "ULTRACEL 110",
        "amountCents": 11000
      },
      {
        "sku": "125",
        "name": "ULTRACEL PORTATIL 125",
        "amountCents": 12500
      },
      {
        "sku": "150",
        "name": "ULTRACEL 150",
        "amountCents": 15000
      },
      {
        "sku": "160",
        "name": "ULTRACEL 160",
        "amountCents": 16000
      },
      {
        "sku": "170",
        "name": "ULTRACEL 170",
        "amountCents": 17000
      },
      {
        "sku": "210",
        "name": "ULTRACEL 210",
        "amountCents": 21000
      },
      {
        "sku": "250",
        "name": "ULTRACEL PORTATIL 250",
        "amountCents": 25000
      },
      {
        "sku": "270",
        "name": "ULTRACEL 270",
        "amountCents": 27000
      },
      {
        "sku": "299",
        "name": "ULTRACEL HOGAR 299",
        "amountCents": 29900
      },
      {
        "sku": "359",
        "name": "ULTRACEL HOGAR 359",
        "amountCents": 35900
      },
      {
        "sku": "399",
        "name": "ULTRACEL HOGAR 399",
        "amountCents": 39900
      },
      {
        "sku": "429",
        "name": "ULTRACEL HOGAR 429",
        "amountCents": 42900
      },
      {
        "sku": "495",
        "name": "ULTRACEL PORTATIL 495",
        "amountCents": 49500
      },
      {
        "sku": "625",
        "name": "ULTRACEL PORTATIL 625",
        "amountCents": 62500
      }
    ]
  },
  {
    "key": "UNEFON",
    "name": "Unefon",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "10",
        "name": "RECARGA 10",
        "amountCents": 1000
      },
      {
        "sku": "20",
        "name": "RECARGA 20",
        "amountCents": 2000
      },
      {
        "sku": "30",
        "name": "RECARGA 30",
        "amountCents": 3000
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "70",
        "name": "RECARGA 70",
        "amountCents": 7000
      },
      {
        "sku": "100",
        "name": "RECARGA 100",
        "amountCents": 10000
      },
      {
        "sku": "120",
        "name": "RECARGA 120",
        "amountCents": 12000
      },
      {
        "sku": "150",
        "name": "RECARGA 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      },
      {
        "sku": "300",
        "name": "RECARGA 300",
        "amountCents": 30000
      }
    ]
  },
  {
    "key": "VALOR_TELECOMM",
    "name": "Valor Telecom",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "70",
        "name": "VALOR TELECOMM TAE 70",
        "amountCents": 7000
      },
      {
        "sku": "95",
        "name": "VALOR TELECOMM TAE 95",
        "amountCents": 9500
      },
      {
        "sku": "99",
        "name": "VALOR TELECOMM CASA 99",
        "amountCents": 9900
      },
      {
        "sku": "100",
        "name": "VALOR TELECOMM TAE 100",
        "amountCents": 10000
      },
      {
        "sku": "110",
        "name": "VALOR TELECOMM 110",
        "amountCents": 11000
      },
      {
        "sku": "115",
        "name": "VALOR TELECOMM CASA 115",
        "amountCents": 11500
      },
      {
        "sku": "150",
        "name": "VALOR TELECOMM TAE 150",
        "amountCents": 15000
      },
      {
        "sku": "160",
        "name": "VALOR TELECOMM 160",
        "amountCents": 16000
      },
      {
        "sku": "245",
        "name": "VALOR TELECOMM 245",
        "amountCents": 24500
      },
      {
        "sku": "250",
        "name": "VALOR TELECOMM TAE 250",
        "amountCents": 25000
      },
      {
        "sku": "349",
        "name": "VALOR TELECOMM  CASA 349",
        "amountCents": 34900
      },
      {
        "sku": "350",
        "name": "VALOR TELECOMM TAE 350",
        "amountCents": 35000
      },
      {
        "sku": "375",
        "name": "VALOR TELECOMM 375",
        "amountCents": 37500
      }
    ]
  },
  {
    "key": "VIRGIN",
    "name": "Virgin",
    "logo": "virgin",
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "25",
        "name": "RECARGA 25",
        "amountCents": 2500
      },
      {
        "sku": "50",
        "name": "RECARGA 50",
        "amountCents": 5000
      },
      {
        "sku": "75",
        "name": "RECARGA 75",
        "amountCents": 7500
      },
      {
        "sku": "100",
        "name": "RECARGA 100",
        "amountCents": 10000
      },
      {
        "sku": "150",
        "name": "RECARGA 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "RECARGA 200",
        "amountCents": 20000
      },
      {
        "sku": "300",
        "name": "RECARGA 300",
        "amountCents": 30000
      },
      {
        "sku": "500",
        "name": "RECARGA 500",
        "amountCents": 50000
      }
    ]
  },
  {
    "key": "WIMO_TELECOM",
    "name": "Wimo Telecom",
    "logo": null,
    "category": "telefonia",
    "kind": "airtime",
    "variant": "recarga",
    "input": PHONE,
    "feeCents": 0,
    "products": [
      {
        "sku": "75",
        "name": "WIMO TELECOM 75",
        "amountCents": 7500
      },
      {
        "sku": "100",
        "name": "WIMO TELECOM 100",
        "amountCents": 10000
      },
      {
        "sku": "140",
        "name": "WIMO TELECOM 140",
        "amountCents": 14000
      },
      {
        "sku": "150",
        "name": "WIMO TELECOM 150",
        "amountCents": 15000
      },
      {
        "sku": "200",
        "name": "WIMO TELECOM 200",
        "amountCents": 20000
      },
      {
        "sku": "250",
        "name": "WIMO TELECOM 250",
        "amountCents": 25000
      },
      {
        "sku": "280",
        "name": "WIMO TELECOM 280",
        "amountCents": 28000
      },
      {
        "sku": "350",
        "name": "WIMO TELECOM 350",
        "amountCents": 35000
      }
    ]
  }
];

export const getOperator = (key) => OPERATORS.find((o) => o.key === key) || null;

export const operatorsByKind = (kind) => OPERATORS.filter((o) => o.kind === kind);

export const filterOperators = (category, query) => {
  const q = String(query || "").trim().toLowerCase();
  return OPERATORS.filter((o) => {
    if (category !== "all" && o.category !== category) return false;
    if (!q) return true;
    return o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q.replace(/\s+/g, ""));
  });
};

export const quote = (operator, amountCents) => {
  if (!operator || !Number.isFinite(amountCents) || amountCents <= 0) return null;
  const feeCents = operator.feeCents || 0;
  return { amountCents, feeCents, totalCents: amountCents + feeCents };
};

export const validateInput = (operator, value) => {
  const spec = operator?.input;
  if (!spec || spec.kind === "none") return { ok: true };
  const v = String(value || "").trim();
  if (!v) return { ok: false, error: spec.label + " es obligatorio" };
  if (spec.numeric && !/^\d+$/.test(v)) return { ok: false, error: "Solo números, sin espacios ni guiones" };
  if (v.length < spec.min || v.length > spec.max) return { ok: false, error: "Debe tener entre " + spec.min + " y " + spec.max + " dígitos" };
  return { ok: true };
};
