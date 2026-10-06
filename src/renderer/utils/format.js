export const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const fmtInt = (n) => Number(n || 0).toLocaleString("es-MX");
