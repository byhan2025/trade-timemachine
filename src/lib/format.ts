export function formatNumber(x: number, digits = 0): string {
  if (!isFinite(x)) return "-";
  return x.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPrice(x: number, unit: string): string {
  if (unit === "USD" || unit === "$") return `$${formatPriceNumber(x, unit)}`;
  return `${formatPriceNumber(x, unit)}${unit ? unit : ""}`;
}

/** 통화를 모를 때는 소수 2자리까지 두되 0은 붙이지 않는다. */
export function formatPriceNumber(x: number, unit: string): string {
  if (!isFinite(x)) return "-";
  if (unit === "원") return formatNumber(x, 0);
  if (!unit) return x.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return formatNumber(x, 2);
}

export function priceDigits(unit: string): number {
  return unit === "원" || unit === "KRW" ? 0 : 2;
}

export function roundPrice(x: number, unit: string): number {
  if (unit === "원") return Math.round(x);
  if (!unit) return Math.abs(x) >= 1000 ? Math.round(x) : Math.round(x * 100) / 100;
  return Math.round(x * 100) / 100;
}

export function formatPct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatSigned(x: number, digits = 0, suffix = ""): string {
  const s = formatNumber(Math.abs(x), digits);
  if (x > 0) return `+${s}${suffix}`;
  if (x < 0) return `−${s}${suffix}`;
  return `${s}${suffix}`;
}

export function formatMoneySigned(x: number, unit: string): string {
  const abs = Math.abs(x);
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  if (unit === "USD" || unit === "$") return `${sign}$${formatNumber(abs, 2)}`;
  if (unit === "원") return `${sign}${formatNumber(abs, 0)}원`;
  return `${sign}${formatNumber(abs, 0)}`;
}

export function formatR(x: number): string {
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}R`;
}

export function priceLabel(x: number, unit: string): string {
  if (unit === "원") return `${formatNumber(x, 0)}원`;
  if (unit === "USD" || unit === "$") return `$${formatNumber(x, 2)}`;
  return formatNumber(x, 2);
}

export function moneyLabel(x: number, unit: string): string {
  if (unit === "원" || unit === "KRW") return `${formatNumber(x, 0)}원`;
  if (unit === "USD" || unit === "$") return `$${formatNumber(x, 2)}`;
  return formatNumber(x, 0);
}
