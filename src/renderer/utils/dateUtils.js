const MX_TIMEZONE = "America/Mexico_City";

export const mxNow = () => {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: MX_TIMEZONE }));
};

export const mxToday = () => {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
};

export const toUTC = (date) => {
  if (typeof date === "string" && date.includes(" ")) {
    return date.replace(" ", "T") + "Z";
  }
  return date;
};

export const formatMXDate = (date, options = {}) => {
  const d = new Date(toUTC(date));
  return d.toLocaleDateString("es-MX", {
    timeZone: MX_TIMEZONE,
    ...options,
  });
};

export const formatMXTime = (date, options = {}) => {
  const d = new Date(toUTC(date));
  return d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MX_TIMEZONE,
    ...options,
  });
};

export const formatMXDateTime = (date) => {
  const d = new Date(toUTC(date));
  return `${formatMXDate(d)} ${formatMXTime(d)}`;
};

export const getMXDateString = (date) => {
  const d = new Date(toUTC(date));
  return d.toLocaleDateString("en-CA", { timeZone: MX_TIMEZONE });
};

export const mxWeekRange = () => {
  const now = mxNow();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  const start = monday.toLocaleDateString("en-CA", { timeZone: MX_TIMEZONE });
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const end = sunday.toLocaleDateString("en-CA", { timeZone: MX_TIMEZONE });
  return { start, end };
};
