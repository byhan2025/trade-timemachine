import type { Side } from "./types";
import type { Thermometer } from "./thermometer";
import type { SimResult } from "./simulate";
import {
  formatMoneySigned,
  formatMultiple,
  formatNumber,
  formatPct,
  formatPctValue,
  formatR,
  moneyLabel,
} from "./format";
import { avgRBreakdown } from "./summary";

/**
 * v2.2 — 초등학생도 읽는 쉬운 리포트의 문구 엔진.
 *
 * 원칙
 * 1. 맨 위 3줄은 전문 용어(R·백분위·미도달 종가)를 쓰지 않고 **100번 기준 횟수**와 **원화 금액**으로만 말한다.
 * 2. 모든 숫자는 이미 계산된 결과(sim·size·thermometer)에서만 가져온다. 새로 추정하지 않는다.
 * 3. 반올림 때문에 문장이 사실과 어긋나지 않게, 100번 기준 횟수는 최대잔여법으로 합이 정확히 100이 되게 나눈다.
 * 4. 수학적 근거는 문장에 섞지 않고 `easyMathDetail`로 분리해 접이식에 그대로 남긴다(정확성·투명성 유지).
 */

export type TrafficLevel = "red" | "yellow" | "green" | "neutral";

/** 맨 위 신호등 — 판정 기준은 '1번에 평균 얼마가 남았나'(평균 금액)'다 */
export const TRAFFIC_BADGES: Record<TrafficLevel, string> = {
  red: "🔴 손실 쪽이 더 많았어요",
  yellow: "🟡 반반에 가까워요",
  green: "🟢 유리한 편이에요 (참고)",
  /** 4번째 상태 — 손절폭이 극단적으로 좁아 판정 자체를 보류한다(v2.2.1) */
  neutral: "⚪ 참고하기 어려워요",
};

/** 극단적으로 좁은 손절폭에서 판정을 보류하는 이유 — 화면에 그대로 적는다 */
export const EXTREME_STOP_REASON = "손절폭이 극단적으로 좁아 실제 체결·수수료 오차가 큽니다";

/** 배지가 무엇을 기준으로 한 판정인지 배지 바로 밑에 적는다 */
export const TRAFFIC_BASIS = "평균 금액 기준";

/** 1회 평균 R이 이 값보다 작으면 '거의 본전(반반)'으로 본다 */
export const FLAT_R = 0.02;

/**
 * 신호등 단계 — extreme(손절폭이 진입가의 0.01% 미만)이면 유리/손실 판정 대신 중립을 돌려준다.
 * 평균 R이 +729R처럼 부풀려져도 실제 체결 오차 안에서 갈리는 조건이라 판정할 수 없다.
 */
export function trafficLevel(avgR: number, extreme = false): TrafficLevel {
  if (extreme) return "neutral";
  if (!isFinite(avgR)) return "yellow";
  if (avgR <= -FLAT_R) return "red";
  if (avgR >= FLAT_R) return "green";
  return "yellow";
}

export function trafficBadge(avgR: number, extreme = false): string {
  return TRAFFIC_BADGES[trafficLevel(avgR, extreme)];
}

/**
 * 비율 3개를 '100번 중 몇 번' 정수로 나눈다(최대잔여법).
 * 셋의 합이 정확히 100이 되게 해서 "24 + 70 + 6 = 100"처럼 아이가 더해 볼 수 있게 한다.
 */
export function perHundred(values: number[]): number[] {
  if (!values.length) return [];
  const raw = values.map((v) => (isFinite(v) && v > 0 ? v * 100 : 0));
  const floors = raw.map((v) => Math.floor(v));
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  let k = 0;
  while (rest > 0 && k < order.length * 2) {
    out[order[k % order.length].i] += 1;
    rest -= 1;
    k += 1;
  }
  return out;
}

/**
 * 읽기 쉬운 금액 반올림 — "약 17,700원"처럼 앞자리만 남긴다.
 * 10원 미만의 아주 작은 값(극단 입력의 0.18원)은 반올림해 0원으로 지우지 않고 소수를 살린다.
 */
export function approxMoney(x: number, unit: string): string {
  const abs = Math.abs(x);
  if (!isFinite(abs)) return "-";
  if (abs < 10) return moneyLabel(Math.round(abs * 10000) / 10000, unit);
  if (abs < 1000) return moneyLabel(Math.round(abs), unit);
  if (abs < 10000) return moneyLabel(Math.round(abs / 10) * 10, unit);
  return moneyLabel(Math.round(abs / 100) * 100, unit);
}

/** 손절 금액(1R)을 1번 걸 때의 평균 손익 — 수량 카드의 실제 1R 금액 기준 */
export function avgMoneyPerTrade(avgR: number, oneR: number): number {
  if (!isFinite(avgR) || !isFinite(oneR)) return 0;
  return avgR * oneR;
}

/** 신호등 바로 아래 한 줄 — 3줄보다 짧게 '1번에 평균 얼마'만 */
export function easyMoneyChip(input: {
  avgR: number;
  oneR: number;
  unit: string;
  shares: number;
  /** 손절폭이 극단적으로 좁은 입력이면 금액 비교를 보류한다 */
  extreme?: boolean;
}): string {
  const { avgR, oneR, unit, shares, extreme } = input;
  if (extreme) return "손절폭이 극단적으로 좁아 금액 비교를 보류했어요";
  if (!(shares > 0) || !(oneR > 0)) {
    const mood = avgR < -FLAT_R ? "손실" : avgR > FLAT_R ? "이익" : "반반";
    return `1번 결과 평균은 ${mood} 쪽`;
  }
  if (Math.abs(avgR) < 0.005) return "1번에 평균 거의 본전";
  const money = avgMoneyPerTrade(avgR, oneR);
  return `1번에 평균 ${approxMoney(Math.abs(money), unit)} ${money < 0 ? "손해" : "이익"}`;
}

/* ------------------------------------------------------------------ 3줄 요약 */

export interface EasySummaryInput {
  sim: Pick<
    SimResult,
    | "replays"
    | "pTarget"
    | "pStop"
    | "pNeither"
    | "pGreen"
    | "avgR"
    | "rAtTarget"
    | "barsLeft"
  >;
  /** 수량 카드의 실제 1R 금액(손절되면 잃는 돈) */
  oneR: number;
  /** 계산 수량(주) — 0주면 금액 대신 '손실/이익 쪽'으로만 말한다 */
  shares: number;
  unit: string;
  side: Side;
  /** 손절폭 ÷ 평균 일중 고저폭 */
  ratio: number;
  /** 목표 ÷ 손절폭 배수 */
  rr: number;
  /** 데이터에 쓰인 세션(거래일) 수 */
  sessions: number;
  /** 손절폭이 진입가의 0.01% 미만인 극단 입력 */
  extreme?: boolean;
}

export interface EasySummaryResult {
  level: TrafficLevel;
  badge: string;
  lines: [string, string, string];
}

/** 1줄: 100번 중 목표·손절·미도달 횟수 (전문 용어 없이) */
export function easyLine1(input: Pick<EasySummaryInput["sim"], "pTarget" | "pStop" | "pNeither"> & {
  side: Side;
}): string {
  const [t, s, n] = perHundred([input.pTarget, input.pStop, input.pNeither]);
  const targetWord = input.side === "buy" ? "올라서" : "내려가서";
  const stopWord = input.side === "buy" ? "내려가서" : "올라가서";
  let out =
    t > 0
      ? `100번 해보면 약 ${t}번은 목표 가격까지 ${targetWord} 기분 좋게 끝났고, `
      : "목표 가격까지 간 경우는 없었고, ";
  out +=
    s > 0
      ? `${s}번은 손절 가격까지 ${stopWord} 먼저 끝났어요.`
      : "손절 가격까지 간 경우도 없었어요.";
  if (n > 0) out += ` 나머지 ${n}번은 장 끝날 때까지 둘 다 안 닿았어요.`;
  return out;
}

/** 2줄: 1번에 걸는 손절 금액 대비 평균 손익 (원화 기준) */
export function easyLine2(input: {
  avgR: number;
  oneR: number;
  unit: string;
  shares: number;
  /** 손절폭이 극단적으로 좁은 입력이면 금액이 실제보다 커 보일 수 있다고 말한다 */
  extreme?: boolean;
}): string {
  const { avgR, oneR, unit, shares, extreme } = input;
  const caution = extreme
    ? " 다만 극단적으로 좁은 손절폭이라 이 금액은 참고하기 어려워요."
    : "";
  if (!(shares > 0) || !(oneR > 0)) {
    const mood = avgR < -FLAT_R ? "손실" : avgR > FLAT_R ? "이익" : "거의 반반";
    return `수량이 0주라 1번에 거는 손절 금액이 없어요. 그래도 1번 결과를 평균 내면 ${mood} 쪽이었어요.`;
  }
  const money = avgMoneyPerTrade(avgR, oneR);
  if (Math.abs(avgR) < 0.005) {
    return `내가 정한 손절 금액 ${moneyLabel(oneR, unit)}을 1번 걸 때마다, 평균적으로는 거의 그대로였어요.${caution}`;
  }
  const flow = money < 0 ? "줄어드는" : "늘어나는";
  return `내가 정한 손절 금액 ${moneyLabel(oneR, unit)}을 1번 걸 때마다, 평균적으로 약 ${approxMoney(
    Math.abs(money),
    unit
  )}씩 ${flow} 흐름이었어요.${caution}`;
}

/** 3줄: 결과에 맞춰 달라지는 결론 (방향·손절폭·목표 배수 반영) */
export function easyConclusion(input: {
  avgR: number;
  pTarget: number;
  pStop: number;
  ratio: number;
  rr: number;
  sessions: number;
  replays: number;
  /** 손절폭이 극단적으로 좁은 입력이면 결론도 참고 불가로 표시한다 */
  extreme?: boolean;
}): string {
  const { avgR, pTarget, pStop, ratio, rr, sessions, replays, extreme } = input;
  const stopFirst = pStop > pTarget;
  let body: string;
  if (ratio > 0 && ratio < 0.6) {
    body = stopFirst
      ? "손절을 하루 흔들림보다 훨씬 가까이 두면, 잠깐만 흔들려도 손절부터 걸리기 쉬워요."
      : "손절이 하루 흔들림보다 훨씬 좁은데도, 이번 재생에서는 목표 쪽이 먼저 닿는 경우가 더 많았어요.";
  } else if (ratio > 1.8) {
    body = stopFirst
      ? "손절이 하루 흔들림보다 넓어서 잠깐 흔들리는 정도로는 잘 안 걸리지만, 한 번 걸리면 잃는 돈이 커요."
      : "손절이 하루 흔들림보다 넓어서 잠깐 흔들리는 정도로는 잘 안 걸렸고, 목표에 닿는 쪽이 더 많았어요.";
  } else if (stopFirst) {
    body = "하루 흔들림과 손절폭이 비슷해서, 조금만 반대로 움직여도 손절에 닿았어요.";
  } else {
    body = "하루 흔들림과 손절폭이 비슷한데도 목표에 먼저 닿는 경우가 더 많았어요.";
  }

  const tail =
    avgR < -FLAT_R
      ? rr >= 1.5 && stopFirst
        ? ` 목표를 손절의 ${formatNumber(rr, 2)}배로 멀리 둬도 지는 판이 더 무거워서, 1번 평균은 손실 쪽이었어요.`
        : " 이기는 판보다 지는 판이 더 무거워서, 1번 평균은 손실 쪽이었어요."
      : avgR > FLAT_R
        ? " 이길 때 버는 돈이 더 커서, 1번 평균은 이익 쪽이었어요."
        : " 이번에는 이익과 손실이 거의 반반이었어요.";
  // 극단 입력: 계산된 결론 문장을 지우지 않되, 판정이 아니라 참고 불가임을 같은 줄에서 밝힌다.
  const caution = extreme ? ` ${EXTREME_STOP_REASON} — 이 결론은 판정이 아니라 참고하기 어려워요.` : "";

  return `과거 ${sessions}일 흐름으로 ${replays.toLocaleString("ko-KR")}번 돌려보니, ${body}${tail}${caution}`;
}

/** 쉬운 3줄 + 신호등을 한 번에 만든다 */
export function easySummary(input: EasySummaryInput): EasySummaryResult {
  const lines: [string, string, string] = [
    easyLine1({ pTarget: input.sim.pTarget, pStop: input.sim.pStop, pNeither: input.sim.pNeither, side: input.side }),
    easyLine2({
      avgR: input.sim.avgR,
      oneR: input.oneR,
      unit: input.unit,
      shares: input.shares,
      extreme: input.extreme,
    }),
    easyConclusion({
      avgR: input.sim.avgR,
      pTarget: input.sim.pTarget,
      pStop: input.sim.pStop,
      ratio: input.ratio,
      rr: input.rr,
      sessions: input.sessions,
      replays: input.sim.replays,
      extreme: input.extreme,
    }),
  ];
  const level = trafficLevel(input.sim.avgR, input.extreme === true);
  return { level, badge: TRAFFIC_BADGES[level], lines };
}

/** 접이식 '숫자·전문 산식 자세히 보기' — 정확한 비율·R 분해·1만 회 조건을 그대로 남긴다 */
export function easyMathDetail(input: {
  sim: EasySummaryInput["sim"];
  oneR: number;
  unit: string;
}): string[] {
  const { sim, oneR, unit } = input;
  const b = avgRBreakdown(sim);
  const greenOnly = Math.max(0, sim.pGreen - sim.pTarget);
  return [
    `목표 도달 ${formatPct(sim.pTarget)} · 손절 도달 ${formatPct(sim.pStop)} · 장 마감 미도달 ${formatPct(
      sim.pNeither
    )} — 남은 봉 ${sim.barsLeft}개를 과거 봉 분포로 ${sim.replays.toLocaleString("ko-KR")}번 되감은 결과입니다.`,
    `이익 마감률 ${formatPct(sim.pGreen)} = 목표 도달 ${formatPct(sim.pTarget)} + 목표 미도달 유리 마감 ${formatPct(
      greenOnly
    )}.`,
    `1회 평균 ${formatR(sim.avgR)} = 목표 ${formatR(sim.rAtTarget)}×${formatPct(sim.pTarget)} + 손절 −1R×${formatPct(
      sim.pStop
    )} = ${formatR(b.twoValueR)}${
      b.neitherAvgR === null
        ? " (미도달 0%라 그대로 같습니다)."
        : ` + 미도달 ${formatPct(sim.pNeither)}×${formatR(b.neitherAvgR)} (장 마감 종가 R 기준).`
    }`,
    `1R 금액 ${moneyLabel(oneR, unit)} × 1회 평균 ${formatR(sim.avgR)} = ${formatMoneySigned(
      sim.avgR * oneR,
      unit
    )} — 2줄의 금액은 수량 카드의 실제 1회 최대 손실로 계산했습니다.`,
    "같은 봉 안에서 손절·목표에 동시에 닿으면 손절로 셉니다. 1만 회 빈도는 미래 확률이 아니라 과거 봉 재표본 모형 결과입니다.",
  ];
}

/* ------------------------------------------------------------------ 온도계 */

/** "보통 하루에 4.22%씩 출렁이는데, 내 손절폭(1.00%)이 그보다 4.22배나 좁아서 …" */
export function easyThermometerLine(thermo: Thermometer): string {
  const stopPctPct = thermo.stopPct * 100;
  const avg = thermo.avgRangePct;
  if (!(avg > 0)) {
    return `내 손절폭은 ${formatPctValue(stopPctPct, 2)}예요. 비교할 만한 하루 흔들림 기록이 없어서 배율은 참고하지 마세요.`;
  }
  if (!(stopPctPct > 0)) {
    return `보통 하루에 ${formatPctValue(avg, 2)}씩 출렁여요. 내 손절폭은 0이라 손절선을 정하지 않은 셈이에요.`;
  }
  const mult = avg / stopPctPct;
  if (mult >= 1000) {
    return `보통 하루에 ${formatPctValue(avg, 2)}씩 출렁이는데, 내 손절폭(${formatPctValue(
      stopPctPct,
      2
    )})은 그에 비해 사실상 0에 가까울 만큼 좁아요. 극단적으로 좁은 손절폭이라 참고하기 어려워요.`;
  }
  if (mult >= 1.05) {
    return `보통 하루에 ${formatPctValue(avg, 2)}씩 출렁이는데, 내 손절폭(${formatPctValue(
      stopPctPct,
      2
    )})이 그보다 ${formatMultiple(mult)}배나 좁아서 지나가는 바람에도 툭 닿을 수 있어요.`;
  }
  if (mult <= 0.95) {
    return `보통 하루에 ${formatPctValue(avg, 2)}씩 출렁이는데, 내 손절폭(${formatPctValue(
      stopPctPct,
      2
    )})이 그보다 ${formatMultiple(1 / mult)}배 넓어서 잠깐 흔들리는 정도로는 잘 안 닿아요.`;
  }
  return `보통 하루에 ${formatPctValue(avg, 2)}씩 출렁이는데, 내 손절폭(${formatPctValue(
    stopPctPct,
    2
  )})도 거의 비슷해요.`;
}

/* ------------------------------------------------------------------ 조합표 */

/** 칸의 큰 값 — "100번 중 29번 이익" (1% 미만은 1,000번 기준으로 바꿔 0번으로 보이지 않게) */
export function easyProfitCount(pGreen: number): string {
  if (!(pGreen > 0)) return "100번 중 0번 이익";
  const per100 = pGreen * 100;
  if (per100 < 0.5) return `1,000번 중 ${Math.max(1, Math.round(pGreen * 1000))}번 이익`;
  return `100번 중 ${Math.round(per100)}번 이익`;
}

/** 칸의 작은 값 — "평균 +0.13배" (매우 작은 값은 0.00으로 지우지 않는다) */
export function easyAvgMultiple(avgR: number): string {
  if (!isFinite(avgR)) return "평균 -";
  const abs = Math.abs(avgR);
  if (abs < 0.005) return "평균 ±0.00배";
  const sign = avgR > 0 ? "+" : "−";
  if (abs < 0.01) return `평균 ${sign}<0.01배`;
  return `평균 ${sign}${formatNumber(abs, 2)}배`;
}

/** 표 머리의 손절 행 이름 — 내 계획의 몇 배인지 */
export function easyStopLevelLabel(levelPct: number, basePct: number): string {
  if (!(basePct > 0)) return "손절폭";
  const mult = levelPct / basePct;
  if (Math.abs(mult - 1) < 0.06) return "내 계획 그대로";
  return `내 계획의 ${formatNumber(mult, 1)}배`;
}

/* ------------------------------------------------------------------ 수량 카드 */

export interface EasySizingInput {
  shares: number;
  side: Side;
  account: number;
  riskPct: number;
  lossBudget: number;
  maxLoss: number;
  effectiveRiskPct: number;
  riskLimitedByCash: boolean;
  unit: string;
  /** 손절폭이 진입가의 0.01% 미만인 극단 입력 */
  extreme: boolean;
}

/** "계좌 …의 1.00%까지만 잃기로 하고 계산하면 100주예요. 이만큼 사면 손절될 때 약 98,200원을 잃어요." */
export function easySizingLine(input: EasySizingInput): string {
  const {
    shares,
    side,
    account,
    riskPct,
    lossBudget,
    maxLoss,
    effectiveRiskPct,
    riskLimitedByCash,
    unit,
    extreme,
  } = input;
  if (!(shares > 0)) {
    return `이 조건에서는 1주도 계산되지 않았어요. 손절폭이 너무 넓거나, 계좌 금액이 1주 값보다 작아요. 계좌 ${moneyLabel(
      account,
      unit
    )}의 ${formatPctValue(riskPct, 2)}(${moneyLabel(lossBudget, unit)})로는 1주 위험폭을 감당하지 못해요.`;
  }
  const verb = side === "buy" ? "사면" : "(빌려서) 팔면";
  let out = `계좌 ${moneyLabel(account, unit)}의 ${formatPctValue(riskPct, 2)}(${moneyLabel(
    lossBudget,
    unit
  )})까지만 잃기로 하고 계산하면 ${formatNumber(shares, 0)}주예요. 이만큼 ${verb} 손절될 때 약 ${moneyLabel(
    maxLoss,
    unit
  )}을 잃어요.`;
  if (riskLimitedByCash) {
    out += ` 다만 계좌 금액 한도에 먼저 걸려서, 실제로 거는 돈은 계좌의 ${formatPctValue(
      effectiveRiskPct,
      2
    )}뿐이에요.`;
  }
  if (extreme) {
    out += " 극단적으로 좁은 손절폭이라 이 숫자는 참고하기 어려워요.";
  }
  return out;
}

/* ------------------------------------------------------------------ 생존 그래프 */

/** 20회 후 자금 지수 — 변동이 거의 없으면 소수 둘째 자리까지 적어 100·100·100 겹침을 피한다 */
export function survivalIndexText(value: number, flat: boolean): string {
  if (!isFinite(value)) return "-";
  return value.toFixed(flat ? 2 : 1);
}

/** "변동 거의 없음 (99.99~100.01)" — 0.1% 미만 변동 안내 */
export function survivalFlatNote(min: number, max: number): string {
  return `변동 거의 없음 (${min.toFixed(2)}~${max.toFixed(2)})`;
}
