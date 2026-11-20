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

/**
 * 맨 위 신호등 — 판정 기준은 '1번에 평균 얼마가 남았나'(평균 금액)다.
 *
 * v2.2.4 — 배지 문구가 '더 많았어요 / 반반'처럼 **횟수**를 말하고 바로 아래 기준 줄은
 * '평균 금액 기준'이라고 적어 서로 모순이었다. 지는 판의 수가 더 적어도 한 번에 크게 잃으면
 * 평균은 손실이 되기 때문에(목표가 손절보다 가까운 입력에서 흔하다), 배지도 평균 기준으로 적는다.
 */
export const TRAFFIC_BADGES: Record<TrafficLevel, string> = {
  red: "🔴 1번 평균은 손실 쪽이에요",
  yellow: "🟡 1번 평균은 거의 본전이에요",
  green: "🟢 1번 평균은 이익 쪽이에요 (참고)",
  /** 4번째 상태 — 손절폭이 극단적으로 좁아 판정 자체를 보류한다(v2.2.1) */
  neutral: "⚪ 참고하기 어려워요",
};

/** 극단적으로 좁은 손절폭에서 판정을 보류하는 이유 — 화면에 그대로 적는다 */
export const EXTREME_STOP_REASON = "손절폭이 극단적으로 좁아 실제 체결·수수료 오차가 큽니다";

/**
 * v2.2.2 — 시뮬레이터 '5초 요약' 배너의 극단 입력 한 줄.
 * 평균 R을 초록으로 강조하지 않는 이유를 배너 안에서 바로 읽게 한다.
 */
export const EXTREME_BANNER_NOTE = "손절폭이 너무 좁아 참고하기 어려워요";

/**
 * v2.2.2 — '1만 번 모의 재생 결과' 카드의 평균 결과(+729.07R 등)에 붙이는 보조 문구.
 * 극단적으로 좁은 손절폭에서는 R이 부풀려 보인다는 점을 숫자 옆에서 밝힌다.
 */
export const EXTREME_AVG_R_NOTE = "극단적으로 좁은 손절폭이라 숫자가 크게 보일 수 있어요";

/**
 * v2.2.3 — '1만 번 모의 재생 결과' 카드의 초록 강조를 끈 이유.
 * 목표 도달 확률·이익 마감률은 사실 값이지만 극단 입력에서는 좋아 보이는 강조를 하지 않는다.
 */
export const EXTREME_POSITIVE_NOTE =
  "극단적으로 좁은 손절폭이라 목표·이익 쪽 숫자를 초록 강조 없이 중립으로 표시해요";

/** 평균 R 강조 색의 이름 — 극단 입력은 초록/빨강 대신 중립 회색을 쓴다(v2.2.2) */
export type AvgRTone = "pos" | "neg" | "neutral";

/**
 * 평균 R에 입힐 색 — 극단 입력(손절폭 < 진입가의 0.01%)이면 이익/손실 판정 대신 중립.
 * 5초 요약 배너·1만 번 결과 카드·리포트 접이식 통계가 모두 이 함수를 공유한다.
 */
export function avgRTone(avgR: number, extreme = false): AvgRTone {
  if (extreme) return "neutral";
  return avgR >= 0 ? "pos" : "neg";
}

/**
 * 긍정(초록) 강조의 색 이름 — 극단 입력이면 초록 대신 중립 회색(v2.2.3).
 * 목표 도달 확률·목표 수익 금액·이익 카드처럼 '좋아 보이는' 숫자에 붙는 `.pos` 를 한 곳에서 끈다.
 * 손절·손실(빨강 `.neg`)은 사실 그대로라 그대로 둔다.
 */
export function positiveTone(extreme = false): "pos" | "neutral" {
  return extreme ? "neutral" : "pos";
}

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
 * 비율들을 '기준 base번 중 몇 번' 정수로 나눈다(최대잔여법).
 * 합이 정확히 base가 되게 해서 아이가 더해 볼 수 있게 한다.
 */
export function perBase(values: number[], base = 100): number[] {
  if (!values.length) return [];
  const raw = values.map((v) => (isFinite(v) && v > 0 ? v * base : 0));
  const floors = raw.map((v) => Math.floor(v));
  let rest = base - floors.reduce((a, b) => a + b, 0);
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

/** 비율 3개를 '100번 중 몇 번' 정수로 나눈다 — 합이 정확히 100 */
export function perHundred(values: number[]): number[] {
  return perBase(values, 100);
}

/* ------------------------------------------------------ 퍼센트 표기 한 곳에서 */

/**
 * 비율들을 화면 퍼센트 문자열로 나눈다 — 합이 100.0%(또는 total)가 되고,
 * 0보다 큰 값이 0으로 지워지지 않는 **가장 짧은 소수 자릿수**를 스스로 고른다(v2.2.4).
 *
 * 0.1% 단위로 고정하면 1만 번 중 1번(0.01%)이 0.0%로 사라지고, 그 값이 다른 문장의
 * "1만 번 중 1번"과 어긋난다. 그래서 자릿수를 하나씩 늘려 가며 실제로 일어난 값을 살린다.
 */
function splitPctParts(values: number[], total = 1, minDigits = 1, maxDigits = 4) {
  // 이익 마감률 0%(전부 손실)처럼 나눌 값이 없으면 자릿수를 늘리지 않고 0으로 적는다
  if (!(total > 0)) return { parts: values.map(() => 0), digits: minDigits };
  let digits = maxDigits;
  let parts: number[] = [];
  for (let d = minDigits; d <= maxDigits; d++) {
    const base = Math.round(total * 100 * Math.pow(10, d));
    if (!(base > 0)) continue;
    const candidate = perBase(values, base);
    const keepsSmallValues = values.every((v, i) => !(v > 0) || candidate[i] > 0);
    if (keepsSmallValues) return { parts: candidate, digits: d };
    digits = d;
    parts = candidate;
  }
  const base = Math.max(0, Math.round(total * 100 * Math.pow(10, maxDigits)));
  return { parts: parts.length ? parts : perBase(values, base), digits };
}

/** 정수부(퍼센트 × 10^digits) → "24.2%" / "0.01%" */
function fmtPctParts(value: number, digits: number): string {
  return `${(value / Math.pow(10, digits)).toFixed(digits)}%`;
}

type ThreePct = { target: string; stop: string; neither: string };

/**
 * 목표 도달·손절 도달·미도달 세 비율의 화면 표기(v2.2.4).
 * 5초 요약 배너·결과 카드·리포트 접이식 통계가 **같은 문자열**을 쓰게 해서,
 * 같은 화면에서 24.2% / 24.3%처럼 서로 다른 반올림이 보이거나 세 값의 합이 100%가 되지 않는 일을 없앤다.
 */
export function pctThree(pTarget: number, pStop: number, pNeither: number): ThreePct {
  const { parts, digits } = splitPctParts([pTarget, pStop, pNeither], 1);
  return {
    target: fmtPctParts(parts[0], digits),
    stop: fmtPctParts(parts[1], digits),
    neither: fmtPctParts(parts[2], digits),
  };
}

type GreenPct = { total: string; target: string; extra: string };

/**
 * 이익 마감률과 그 구성(목표 도달 + 목표 미도달 유리 마감)의 표기(v2.2.4).
 * 두 구성값을 그대로 더하면 화면에 적힌 이익 마감률이 되도록 먼저 나눈 뒤 합을 쓴다 —
 * "목표 도달 3.3% + 유리 마감 0.1%"인데 이익 마감률은 3.5%로 적히던 반올림 모순을 없앤다.
 */
export function greenRatePct(pTarget: number, pGreen: number): GreenPct {
  const extra = Math.max(0, pGreen - pTarget);
  const share = pGreen > 0 ? [pTarget / pGreen, extra / pGreen] : [0, 0];
  const { parts, digits } = splitPctParts(share, pGreen);
  const [a, b] = parts;
  return {
    total: fmtPctParts(a + b, digits),
    target: fmtPctParts(a, digits),
    extra: fmtPctParts(b, digits),
  };
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
  /** 계산 수량이 0주일 때 붙이는 안내 — 금액이 아니라 가격 움직임만 본 판정임을 밝힌다 */
  note?: string;
}

/** 계산 수량 0주(무포지션)에서 판정의 성격을 밝히는 한 줄 */
export const ZERO_SHARES_NOTE =
  "계산 수량이 0주라 이 조건에서는 매매가 한 번도 실행되지 않아요. 위 판정은 금액이 아니라 손절폭 대비 평균 움직임(1회 평균 R)만 본 값이에요.";

/** 시뮬레이터 5초 요약 배너용 0주 안내 */
export const ZERO_SHARES_BANNER_NOTE =
  "계산 수량이 0주라 실제 매매는 일어나지 않아요 — 위 확률·평균은 가격 움직임만 본 값이에요";

/**
 * 1줄: 목표·손절·미도달 횟수 (전문 용어 없이).
 *
 * v2.2.4 — 100번 기준으로 나누면 목표 0.4%처럼 드문 경우가 0번이 되어, 1만 번 중 40번 있었던 일을
 * "목표 가격까지 간 경우는 없었고"라고 말하는 모순이 있었다. 100번 기준에서 0이 되지만 실제로
 * 일어난 비율이 하나라도 있으면 그 줄 전체를 실제 재생 횟수(1만 번) 기준으로 적는다.
 */
export function easyLine1(
  input: Pick<EasySummaryInput["sim"], "pTarget" | "pStop" | "pNeither"> & {
    side: Side;
    /** 재생 횟수 — 100번 기준에서 0번이 되는 드문 결과를 숨기지 않기 위해 */
    replays?: number;
  }
): string {
  const { pTarget, pStop, pNeither, side } = input;
  const replays = Math.max(1, Math.round(input.replays ?? 10000));
  const targetWord = side === "buy" ? "올라서" : "내려가서";
  const stopWord = side === "buy" ? "내려가서" : "올라가서";
  const ps = [pTarget, pStop, pNeither];
  const byHundred = perBase(ps, 100);
  const tooSmallForHundred = ps.some((p, i) => p > 0 && byHundred[i] === 0);
  const base = tooSmallForHundred ? replays : 100;
  const [t, s, n] = tooSmallForHundred ? perBase(ps, base) : byHundred;
  const basisText =
    base === 100 ? "100번" : base >= 10000 ? "1만 번" : `${base.toLocaleString("ko-KR")}번`;
  let out =
    t > 0
      ? `${basisText} 해보면 약 ${t}번은 목표 가격까지 ${targetWord} 기분 좋게 끝났고, `
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

/** 목표·손절 중 어느 쪽에 더 많이 닿았는지 — 같은 횟수나 0회를 '더 많다'고 말하지 않기 위한 구분 */
export type ReplayDirection = "stop" | "target" | "tie" | "bothZero";

export function replayDirection(pTarget: number, pStop: number): ReplayDirection {
  const tie = Math.abs(pTarget - pStop) < 1e-12;
  if (tie) return pTarget > 0 ? "tie" : "bothZero";
  return pStop > pTarget ? "stop" : "target";
}

/**
 * 3줄: 결과에 맞춰 달라지는 결론 (방향·손절폭·목표 배수 반영).
 *
 * v2.2.4 — 목표·손절 횟수가 같거나 둘 다 0회(전부 미도달)인데도 "목표에 먼저 닿는 경우가 더
 * 많았어요"라고 말하던 모순을 없앴다. 어느 쪽도 더 많지 않으면 그 사실을 그대로 적는다.
 */
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
  const dir = replayDirection(pTarget, pStop);
  /** 어느 쪽도 닿지 않은 재생만 있었는지 / 한쪽으로만 끝났는지 */
  const targetOnly = dir === "target" && pStop <= 0;
  const stopOnly = dir === "stop" && pTarget <= 0;
  const band: "tight" | "wide" | "even" =
    ratio > 0 && ratio < 0.6 ? "tight" : ratio > 1.8 ? "wide" : "even";

  const NARROW = "손절이 하루 흔들림보다 훨씬 좁";
  const WIDE = "손절이 하루 흔들림보다 넓";
  const EVEN = "하루 흔들림과 손절폭이 비슷하";
  let body: string;
  if (dir === "bothZero") {
    body = `이번 재생에서는 목표에도 손절에도 닿지 않고 장이 끝난 경우만 있었어요.`;
  } else if (dir === "tie") {
    body = `이번 재생에서는 목표에 먼저 닿은 횟수와 손절에 먼저 닿은 횟수가 똑같았어요.`;
  } else if (band === "tight") {
    body = stopOnly
      ? `${NARROW}아서, 이번 재생에서는 목표까지 가기 전에 손절로 끝난 경우만 있었어요.`
      : targetOnly
        ? `${NARROW}은데도, 이번 재생에서는 손절에 닿은 경우 없이 목표 쪽으로만 끝났어요.`
        : dir === "stop"
          ? "손절을 하루 흔들림보다 훨씬 가까이 두면, 잠깐만 흔들려도 손절부터 걸리기 쉬워요."
          : `${NARROW}은데도, 이번 재생에서는 목표 쪽이 먼저 닿는 경우가 더 많았어요.`;
  } else if (band === "wide") {
    body = stopOnly
      ? `${WIDE}은데도, 이번 재생에서는 목표까지 가지 못하고 손절로 끝난 경우만 있었어요.`
      : targetOnly
        ? `${WIDE}아서, 이번 재생에서는 손절에 닿은 경우 없이 목표 쪽으로만 끝났어요.`
        : dir === "stop"
          ? "손절이 하루 흔들림보다 넓어서 잠깐 흔들리는 정도로는 잘 안 걸리지만, 한 번 걸리면 잃는 돈이 커요."
          : "손절이 하루 흔들림보다 넓어서 잠깐 흔들리는 정도로는 잘 안 걸렸고, 목표에 닿는 쪽이 더 많았어요.";
  } else {
    body = stopOnly
      ? `하루 흔들림과 손절폭이 비슷해서, 목표까지 가기 전에 손절로 끝난 경우만 있었어요.`
      : targetOnly
        ? `${EVEN}은데도, 이번 재생에서는 손절에 닿은 경우 없이 목표 쪽으로만 끝났어요.`
        : dir === "stop"
          ? "하루 흔들림과 손절폭이 비슷해서, 조금만 반대로 움직여도 손절에 닿았어요."
          : `${EVEN}은데도 목표에 먼저 닿는 경우가 더 많았어요.`;
  }

  const tail =
    avgR < -FLAT_R
      ? rr >= 1.5 && dir === "stop"
        ? ` 목표를 손절의 ${formatNumber(rr, 2)}배로 멀리 둬도 지는 판이 더 무거워서, 1번 평균은 손실 쪽이었어요.`
        : " 이기는 판보다 지는 판이 더 무거워서, 1번 평균은 손실 쪽이었어요."
      : avgR > FLAT_R
        ? " 이길 때 버는 돈이 더 커서, 1번 평균은 이익 쪽이었어요."
        : " 이번에는 이익과 손실이 거의 반반이었어요.";
  // 극단 입력: '이익/손실 쪽'이라는 판정 문장을 쓰지 않고, 판정을 보류한 이유만 적는다(v2.2.1).
  if (extreme) {
    return `과거 ${sessions}일 흐름으로 ${replays.toLocaleString("ko-KR")}번 돌려보니, ${body} ${EXTREME_STOP_REASON} — 이 조건은 유리·손실을 판정하지 않고 '⚪ 참고하기 어려워요'로 표시했어요.`;
  }

  return `과거 ${sessions}일 흐름으로 ${replays.toLocaleString("ko-KR")}번 돌려보니, ${body}${tail}`;
}

/** 쉬운 3줄 + 신호등을 한 번에 만든다 */
export function easySummary(input: EasySummaryInput): EasySummaryResult {
  const lines: [string, string, string] = [
    easyLine1({
      pTarget: input.sim.pTarget,
      pStop: input.sim.pStop,
      pNeither: input.sim.pNeither,
      side: input.side,
      replays: input.sim.replays,
    }),
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
  return {
    level,
    badge: TRAFFIC_BADGES[level],
    lines,
    note: input.shares > 0 ? undefined : ZERO_SHARES_NOTE,
  };
}

/** 접이식 '숫자·전문 산식 자세히 보기' — 정확한 비율·R 분해·1만 회 조건을 그대로 남긴다 */
export function easyMathDetail(input: {
  sim: EasySummaryInput["sim"];
  oneR: number;
  unit: string;
}): string[] {
  const { sim, oneR, unit } = input;
  const b = avgRBreakdown(sim);
  /** 배너·결과 카드와 같은 0.1% 단위 표기를 써서, 산식의 두 값 합이 위 이익 마감률과 정확히 맞게 한다 */
  const p3 = pctThree(sim.pTarget, sim.pStop, sim.pNeither);
  const green = greenRatePct(sim.pTarget, sim.pGreen);
  return [
    `목표 도달 ${p3.target} · 손절 도달 ${p3.stop} · 장 마감 미도달 ${p3.neither} — 남은 봉 ${sim.barsLeft}개를 과거 봉 분포로 ${sim.replays.toLocaleString("ko-KR")}번 되감은 결과입니다.`,
    `이익 마감률 ${green.total} = 목표 도달 ${green.target} + 목표 미도달 유리 마감 ${green.extra}.`,
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

/** 표 머리의 손절 행 이름 — 내 계획의 몇 배인지 (호가 단위로 반올림된 실제 손절폭 기준) */
export function easyStopLevelLabel(levelPct: number, basePct: number): string {
  if (!(basePct > 0)) return "손절폭";
  const mult = levelPct / basePct;
  // v2.2.4 — 6% 차이까지 '내 계획 그대로'로 보아 1.05배를 1배처럼 읽히게 하던 폭을 0.5%로 좁힘
  if (Math.abs(mult - 1) < 0.005) return "내 계획 그대로";
  return `내 계획의 ${formatNumber(mult, 1)}배`;
}

/**
 * 조합표 열 이름 — 목표가가 손절폭의 몇 배 지점인지.
 * v2.2.4 — 요청한 배수(1.5배 등)가 아니라 **화면에 적힌 목표가로 다시 계산한 실제 배수**를 적는다.
 * (예: 진입 100,000 / 손절 99,999 → 1원 단위에서 1.5배는 100,001.5원이 될 수 없어 100,002원,
 *  실제로는 2배가 된다. 이때 '목표 1.5배'라고 적으면 목표가와 표기가 서로 모순된다.)
 */
export function easyTargetMultiple(x: number): string {
  if (!isFinite(x)) return "-";
  if (Math.abs(x) >= 1000) return `${formatNumber(x, 0)}배`;
  const text = x.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}배`;
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
  /** 1주 가격(진입가) — 0주 원인을 '1주 가격 vs 계좌 금액'으로 가른다 */
  entry: number;
  /** 1주당 위험폭(|진입가 − 손절가|) — 0주 원인을 '위험폭 vs 허용 손실'로 가른다 */
  riskPerShare: number;
  /** 손절폭이 진입가의 0.01% 미만인 극단 입력 */
  extreme: boolean;
}

export interface ZeroShareReasonInput {
  /** 1주당 위험폭(|진입가 − 손절가|) */
  riskPerShare: number;
  /** 계좌 × 1회 허용 손실률 = 1회 허용 손실 금액 */
  lossBudget: number;
  /** 1주 가격(진입가) */
  entry: number;
  account: number;
  unit: string;
}

/**
 * v2.2.3 — 수량이 0주가 된 원인을 실제로 걸린 항목만 골라 한 문장으로 말한다.
 *   · 1주 위험폭 > 1회 허용 손실  → "1주 위험폭(…원)이 1회 허용 손실(…원)보다 커서 0주가 됐어요"
 *   · 1주 가격 > 계좌 금액        → "1주 가격(…원)이 계좌 금액(…원)보다 커서 0주가 됐어요"
 *   · 둘 다                        → 두 이유를 함께 적는다
 * 두 원인을 한꺼번에 나열해 "손절폭이 너무 넓거나, 계좌 금액이 1주 값보다 작아요"처럼
 * 짐작으로 말하지 않는다(4호 봇 v2.2.3 지적).
 */
export function zeroShareReason(input: ZeroShareReasonInput): string {
  const { riskPerShare, lossBudget, entry, account, unit } = input;
  if (!(riskPerShare > 0)) {
    return "진입가와 손절가가 같아 1주 위험폭이 0이라 1주를 담을 수 없어 0주가 됐어요.";
  }
  const tooWide = riskPerShare > lossBudget;
  const tooPricey = entry > account;
  const riskText = `1주 위험폭(${moneyLabel(riskPerShare, unit)})`;
  const budgetText = `1회 허용 손실(${moneyLabel(lossBudget, unit)})`;
  const priceText = `1주 가격(${moneyLabel(entry, unit)})`;
  const accountText = `계좌 금액(${moneyLabel(account, unit)})`;
  if (tooWide && tooPricey) {
    return `${riskText}이 ${budgetText}보다 크고, ${priceText}도 ${accountText}보다 커서 0주가 됐어요.`;
  }
  if (tooWide) return `${riskText}이 ${budgetText}보다 커서 0주가 됐어요.`;
  if (tooPricey) return `${priceText}이 ${accountText}보다 커서 0주가 됐어요.`;
  return `${riskText}·${priceText} 기준으로는 1주도 담을 수 없어 0주가 됐어요.`;
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
    entry,
    riskPerShare,
    extreme,
  } = input;
  if (!(shares > 0)) {
    return `이 조건에서는 1주도 계산되지 않았어요. ${zeroShareReason({
      riskPerShare,
      lossBudget,
      entry,
      account,
      unit,
    })} 계좌 ${moneyLabel(account, unit)}의 ${formatPctValue(riskPct, 2)}(${moneyLabel(
      lossBudget,
      unit
    )}) 기준이에요.`;
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
