export function formatNumber(x: number, digits = 0): string {
  if (!isFinite(x)) return "-";
  return x.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 원 단위 표기 — 정수면 그대로, 소수 입력(예: 99,999.99)은 소수점을 살린다.
 * v2.1.3: 진입 100,000 / 손절 99,999.99처럼 0.01원 차이를 반올림해 같은 값으로
 * 보이게 하지 않기 위해, 원 단위에서도 소수 둘째 자리까지 보존한다.
 */
export function formatWon(x: number): string {
  if (!isFinite(x)) return "-";
  if (Number.isInteger(x)) return formatNumber(x, 0);
  return x.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/**
 * 금액 표기 — 1원 미만(예: 극단 입력의 기댓값 0.18원)만 소수를 살리고
 * 그 이상은 원 단위 정수로 적는다(자금 궤적 9,614,686원).
 */
export function formatWonMoney(x: number): string {
  if (!isFinite(x)) return "-";
  const abs = Math.abs(x);
  if (abs > 0 && abs < 1) return x.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
  return formatNumber(x, 0);
}

export function formatPrice(x: number, unit: string): string {
  if (unit === "USD" || unit === "$") return `$${formatPriceNumber(x, unit)}`;
  return `${formatPriceNumber(x, unit)}${unit ? unit : ""}`;
}

/** 통화를 모를 때는 소수 2자리까지 두되 0은 붙이지 않는다. */
export function formatPriceNumber(x: number, unit: string): string {
  if (!isFinite(x)) return "-";
  if (unit === "원") return formatWon(x);
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

/**
 * 비율(0.0001 = 0.01%) 표기. 기본은 소수 1자리지만,
 * 0.00%로 뭉개져 값이 사라지는 아주 작은 비율은 소수 6자리까지 늘려 적는다.
 * 예) 1e-7 → "0.00001%" · 1e-5 → "0.001%"
 */
export function formatPct(x: number, digits = 1): string {
  if (!isFinite(x)) return "-";
  return formatPctValue(x * 100, digits);
}

/** 이미 % 단위로 계산된 값(예: 2.75 → "2.75%")을 적는다. 아주 작으면 자릿수를 늘린다. */
export function formatPctValue(v: number, digits = 2): string {
  if (!isFinite(v)) return "-";
  let d = Math.max(0, digits);
  while (d < 6 && v !== 0 && Math.abs(v) < 0.5 * Math.pow(10, -d)) d += 1;
  return `${v.toFixed(d)}%`;
}

/**
 * 배수 표기 — 0.01배 미만은 `<0.01`로 적어 0.00배로 값이 사라지지 않게 하고,
 * 1,000배 이상은 세 자리 쉼표로 읽기 쉽게 쓴다.
 */
export function formatMultiple(x: number, digits = 2): string {
  if (!isFinite(x)) return "-";
  const abs = Math.abs(x);
  if (abs === 0) return (0).toFixed(digits);
  if (abs < 0.01) return "<0.01";
  if (abs >= 1000) return x.toLocaleString("ko-KR", { maximumFractionDigits: digits });
  return x.toFixed(digits);
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
  if (unit === "원") return `${sign}${formatWonMoney(abs)}원`;
  return `${sign}${formatNumber(abs, 0)}`;
}

export function formatR(x: number): string {
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}R`;
}

export function priceLabel(x: number, unit: string): string {
  if (unit === "원") return `${formatWon(x)}원`;
  if (unit === "USD" || unit === "$") return `$${formatNumber(x, 2)}`;
  return formatNumber(x, 2);
}

export function moneyLabel(x: number, unit: string): string {
  if (unit === "원" || unit === "KRW") return `${formatWonMoney(x)}원`;
  if (unit === "USD" || unit === "$") return `$${formatNumber(x, 2)}`;
  return formatNumber(x, 0);
}
