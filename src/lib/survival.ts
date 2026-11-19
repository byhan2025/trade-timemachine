import { mulberry32, randInt } from "./prng";

export interface SurvivalInput {
  /** 1만 회 재생에서 나온 1회 R 값들 */
  rSamples: Float64Array;
  /** 연속 매매 횟수 (기본 20) */
  trades?: number;
  /** 1회 허용 손실률 (0.01 = 계좌의 1%) — 매매마다 현재 자금 기준 */
  riskPct: number;
  startEquity: number;
  scenarios?: number;
  seed?: number;
}

export interface SurvivalResult {
  trades: number;
  scenarios: number;
  /** 100 = 시작 자금. 길이 trades+1 */
  median: number[];
  p10: number[];
  p90: number[];
  finalMedianIdx: number;
  finalP10Idx: number;
  finalP90Idx: number;
  finalMedian: number;
  finalP10: number;
  finalP90: number;
  /** 20회 후 시작 자금보다 적을 확률 */
  belowStartProb: number;
  /** 최장 연속 손실 횟수의 중앙값 / 95% / 최대 */
  maxStreakMedian: number;
  maxStreakP95: number;
  maxStreakMax: number;
  /** 쓰인 1회 기대 R(표본 평균) */
  meanR: number;
  /** 계산에 쓴 1회 위험률(%) — 수량 카드의 유효 위험률과 같은 값 */
  riskPct: number;
  /** 시작 자금 기준 1R 금액 (startEquity × riskPct/100) */
  oneR: number;
  /**
   * 매매가 실행되지 않는 상태(계산 수량 0주) — 위험률 0으로 자금이 변하지 않는다.
   * 이때는 1% 위험을 적용한 것처럼 손실 확률을 보여 주지 않는다(v2.2.1).
   */
  noTrade: boolean;
}

function quantile(sorted: Float64Array, q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/**
 * 1만 회 재생의 R 분포를 그대로 20번 연속 적용해 계좌 궤적을 만든다.
 * - 매매마다 현재 자금 × 손실률 = 1R 로 계산(복리)
 * - 같은 분포에서 복원추출하므로 '이 순서가 온다'는 예측이 아니라 분포 가정이다
 */
export function simulateSurvival(input: SurvivalInput): SurvivalResult {
  const trades = input.trades ?? 20;
  const scenarios = input.scenarios ?? 4000;
  const risk = input.riskPct / 100;
  const rng = mulberry32(input.seed ?? 19);
  const n = input.rSamples.length;

  // 계산된 수량이 0주(무포지션)면 매매가 실행되지 않아 자금이 그대로다.
  // 계획 위험률(예: 1%)을 대신 넣어 손실 확률을 만들지 않는다 — 수량 카드(0원)와 모순되기 때문(v2.2.1).
  if (!(risk > 0)) {
    const flat = new Array(trades + 1).fill(100);
    let sumR = 0;
    for (let i = 0; i < n; i++) sumR += input.rSamples[i];
    return {
      trades,
      scenarios,
      median: flat.slice(),
      p10: flat.slice(),
      p90: flat.slice(),
      finalMedianIdx: 100,
      finalP10Idx: 100,
      finalP90Idx: 100,
      finalMedian: input.startEquity,
      finalP10: input.startEquity,
      finalP90: input.startEquity,
      belowStartProb: 0,
      maxStreakMedian: 0,
      maxStreakP95: 0,
      maxStreakMax: 0,
      meanR: n ? sumR / n : 0,
      riskPct: 0,
      oneR: 0,
      noTrade: true,
    };
  }

  if (!n || !(input.startEquity > 0)) {
    return {
      trades,
      scenarios: 0,
      median: new Array(trades + 1).fill(100),
      p10: new Array(trades + 1).fill(100),
      p90: new Array(trades + 1).fill(100),
      finalMedianIdx: 100,
      finalP10Idx: 100,
      finalP90Idx: 100,
      finalMedian: input.startEquity,
      finalP10: input.startEquity,
      finalP90: input.startEquity,
      belowStartProb: 0,
      maxStreakMedian: 0,
      maxStreakP95: 0,
      maxStreakMax: 0,
      meanR: 0,
      riskPct: input.riskPct,
      oneR: 0,
      noTrade: false,
    };
  }

  const columns: Float64Array[] = [];
  for (let t = 0; t <= trades; t++) columns.push(new Float64Array(scenarios));
  const streaks = new Float64Array(scenarios);
  let sumR = 0;
  for (let i = 0; i < n; i++) sumR += input.rSamples[i];

  for (let s = 0; s < scenarios; s++) {
    let equity = 1;
    let streak = 0;
    let maxStreak = 0;
    columns[0][s] = 100;
    for (let t = 1; t <= trades; t++) {
      const r = input.rSamples[randInt(rng, 0, n - 1)];
      equity *= 1 + risk * r;
      if (equity < 0) equity = 0;
      if (r < 0) {
        streak++;
        if (streak > maxStreak) maxStreak = streak;
      } else {
        streak = 0;
      }
      columns[t][s] = equity * 100;
    }
    streaks[s] = maxStreak;
  }

  const median: number[] = [];
  const p10: number[] = [];
  const p90: number[] = [];
  for (const col of columns) {
    const sorted = Float64Array.from(col).sort();
    p10.push(quantile(sorted, 0.1));
    median.push(quantile(sorted, 0.5));
    p90.push(quantile(sorted, 0.9));
  }
  const sortedStreak = Float64Array.from(streaks).sort();
  const finalCol = Float64Array.from(columns[trades]).sort();

  return {
    trades,
    scenarios,
    median,
    p10,
    p90,
    finalMedianIdx: median[trades],
    finalP10Idx: p10[trades],
    finalP90Idx: p90[trades],
    finalMedian: (median[trades] / 100) * input.startEquity,
    finalP10: (p10[trades] / 100) * input.startEquity,
    finalP90: (p90[trades] / 100) * input.startEquity,
    belowStartProb:
      finalCol.reduce((acc, v) => acc + (v < 100 ? 1 : 0), 0) / Math.max(1, finalCol.length),
    maxStreakMedian: quantile(sortedStreak, 0.5),
    maxStreakP95: quantile(sortedStreak, 0.95),
    maxStreakMax: sortedStreak.length ? sortedStreak[sortedStreak.length - 1] : 0,
    meanR: sumR / n,
    riskPct: input.riskPct,
    oneR: input.startEquity * risk,
    noTrade: false,
  };
}
