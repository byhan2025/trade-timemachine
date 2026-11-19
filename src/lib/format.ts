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

/** 숫자의 소수 자릿수 (최대 max자리) — 99,999.99 → 2, 196,400 → 0 */
export function decimalsOf(x: number, max = 6): number {
  if (!isFinite(x)) return 0;
  const text = String(x);
  if (text.includes("e-")) {
    // 아주 작은 값(1e-7)은 소수 자릿수로 직접 센다
    const exp = Number(text.split("e-")[1]);
    return Math.min(max, exp + (text.split("e-")[0].split(".")[1] ?? "").length);
  }
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : Math.min(max, text.length - dot - 1);
}

/**
 * 가격을 지정한 소수 자릿수로 반올림한다 (부동소수점 꼬리 제거).
 * 자릿수는 입력값의 정밀도에서 가져오므로 99,999.99의 0.01을 살린다.
 */
export function roundTo(x: number, decimals: number): number {
  if (!isFinite(x)) return x;
  const d = Math.max(0, Math.min(6, Math.trunc(decimals)));
  const scale = Math.pow(10, d);
  return Math.round((x + Number.EPSILON * Math.sign(x)) * scale) / scale;
}

/**
 * 진입가 기준 대칭 미러 가격 — 매수↔매도 방향 전환과 손익비 프리셋에 쓴다(v2.2.1).
 * 화면 단위(원)로 반올림하지 않고 **기존 입력값의 소수 자릿수**를 보존한다.
 * 진입 100,000 / 손절 99,999.99 → 100,000.01 (0.01을 0으로 지우지 않는다).
 */
export function mirrorPrice(entry: number, price: number, unit: string): number {
  if (!isFinite(entry) || !isFinite(price)) return price;
  const base = unit === "원" ? 0 : 2;
  const decimals = Math.max(base, decimalsOf(entry, 4), decimalsOf(price, 4));
  return roundTo(2 * entry - price, Math.min(4, decimals));
}

/**
 * 진입가에서 delta 만큼 떨어진 가격 — 입력 가격의 소수 정밀도를 보존한다.
 * (방향 전환과 같은 정밀도 규칙: 100,000 / 99,999.99에서 1R 목표는 100,000.01)
 */
export function offsetPrice(entry: number, delta: number, unit: string): number {
  const base = unit === "원" ? 0 : 2;
  const decimals = Math.max(base, decimalsOf(entry, 4), decimalsOf(delta, 4));
  return roundTo(entry + delta, Math.min(4, decimals));
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
  // 큰 R(예: 극단 입력의 +10,000R)도 세 자리 쉼표로 읽는다
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${formatNumber(Math.abs(x), 2)}R`;
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

/**
 * 그래프 축 눈금 글자 — 반올림 때문에 `100 · 100 · 100`처럼 겹치면
 * 소수 자릿수를 하나씩 늘려 서로 다른 눈금으로 읽히게 한다(v2.2).
 */
export function axisLabels(values: number[], maxDigits = 2): string[] {
  for (let d = 0; d <= maxDigits; d++) {
    const labels = values.map((v) => formatNumber(v, d));
    if (new Set(labels).size === labels.length) return labels;
  }
  return values.map((v) => String(v));
}

/** 변동이 눈에 보이지 않는 구간인지 — 100 기준 0.1% 미만이면 '변동 거의 없음'으로 적는다 */
export function isFlatSpan(min: number, max: number, tol = 0.1): boolean {
  if (!isFinite(min) || !isFinite(max)) return true;
  return Math.abs(max - min) < tol;
}
