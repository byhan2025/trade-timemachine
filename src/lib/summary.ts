import type { SimResult } from "./simulate";
import { formatPct, formatPrice, formatR } from "./format";
import { GREEN_LABEL } from "./terms";

/** 초보자가 5초에 읽는 요약 3줄에 필요한 값만 받는다 */
export interface SummaryInput {
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
  target: number;
  stop: number;
  rr: number;
  unit: string;
}

export interface AvgRBreakdown {
  /** 목표·손절 두 값만 확률로 더한 값 (미도달 0R로 보는 단순 계산) */
  twoValueR: number;
  /** 미도달(장 마감) 건들이 만든 R의 평균 — 두 값만 더한 값과 실제 평균의 차이를 메운다 */
  neitherAvgR: number | null;
  /** 실제 1회 평균 R */
  avgR: number;
}

/**
 * 1회 평균 R의 분해 — "목표 +2R · 손절 −1R"만 더한 값과 실제 평균이 왜 다른지
 * 화면에서 바로 보이도록 미도달 몫을 되돌려 계산한다.
 */
export function avgRBreakdown(
  sim: Pick<SimResult, "pTarget" | "pStop" | "pNeither" | "avgR" | "rAtTarget">
): AvgRBreakdown {
  const twoValueR = sim.pTarget * sim.rAtTarget - sim.pStop;
  const neitherAvgR = sim.pNeither > 0 ? (sim.avgR - twoValueR) / sim.pNeither : null;
  return { twoValueR, neitherAvgR, avgR: sim.avgR };
}

/** 요약 1줄: 1만 번 중 목표/손절 도달 */
function firstLine(s: SummaryInput): string {
  return `${s.sim.replays.toLocaleString("ko-KR")}번 중 ${formatPct(
    s.sim.pTarget
  )}는 목표 ${formatPrice(s.target, s.unit)}에 먼저 닿았고, ${formatPct(
    s.sim.pStop
  )}는 손절 ${formatPrice(s.stop, s.unit)}에 먼저 닿았습니다.`;
}

/**
 * 요약 2줄: 1회 평균 R.
 * v2.1.3 — "미도달 포함"을 명시하고, 목표·손절 두 값만 더한 값과 실제 평균의 차이를
 * 같은 줄에서 바로 비교할 수 있게 미도달 몫까지 적는다.
 */
function secondLine(s: SummaryInput): string {
  const { sim } = s;
  const mood = Math.abs(sim.avgR) < 0.02 ? "거의 본전" : sim.avgR > 0 ? "이익 쪽" : "손실 쪽";
  const b = avgRBreakdown(sim);
  const bothOnly = `목표 ${formatR(sim.rAtTarget)}·손절 −1R 두 값만 확률로 더하면 ${formatR(
    b.twoValueR
  )}`;
  const neither =
    b.neitherAvgR === null
      ? "미도달 0%라 그대로 실제 평균입니다"
      : `미도달 ${formatPct(sim.pNeither)}의 종가 R(평균 ${formatR(b.neitherAvgR)})까지 더해야 위 값이 됩니다`;
  return `1회 평균은 미도달 포함 ${formatR(sim.avgR)} — ${bothOnly}이고, ${neither}. 통계상 ${mood}입니다.`;
}

/** 요약 3줄: 이익 마감률·손익비 */
function thirdLine(s: SummaryInput): string {
  const greenOnly = Math.max(0, s.sim.pGreen - s.sim.pTarget);
  return `${GREEN_LABEL} ${formatPct(s.sim.pGreen)}(목표 도달 ${formatPct(
    s.sim.pTarget
  )} + 목표 미도달 유리 마감 ${formatPct(greenOnly)}), 손익비 1:${(s.rr || 0).toFixed(
    2
  )} 구조입니다. 남은 ${s.sim.barsLeft}봉을 과거 봉 분포로 ${s.sim.replays.toLocaleString(
    "ko-KR"
  )}번 되감은 결과입니다.`;
}

export function summaryLines(s: SummaryInput): string[] {
  return [firstLine(s), secondLine(s), thirdLine(s)];
}
