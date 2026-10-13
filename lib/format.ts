/** Client/server-safe display formatting. */

export function fmtMoney(cents: number, currency = "EUR", locale = "pt-PT"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function fmtMoneyShort(cents: number, currency = "EUR"): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")}k €`;
  return fmtMoney(cents, currency);
}

export function fmtQty(qtyMilli: number, unit = "un"): string {
  const value = qtyMilli / 1000;
  const text = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/\.?0+$/, "");
  return unit === "un" ? text : `${text.replace(".", ",")} ${unit}`;
}

export function fmtPct(bps: number, digits = 1): string {
  return `${(bps / 100).toFixed(digits).replace(".", ",")}%`;
}

export function fmtDate(ts: number | null | undefined, locale = "pt-PT"): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(locale);
}

export function fmtDateTime(ts: number | null | undefined, locale = "pt-PT"): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtTime(ts: number | null | undefined, locale = "pt-PT"): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  return `${h}h ${totalMin % 60}m`;
}

export function fmtAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return fmtDuration(ms);
}
