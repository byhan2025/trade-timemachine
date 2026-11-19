import type { Session, Side } from "./types";

export interface BacktestRule {
  /** 오프닝 레인지 봉 수 */
  orBars: number;
  /** 진입가 대비 손절폭 비율 (0.01 = 1%) */
  stopPct: number;
  /** 목표 손익비 (R) */
  targetR: number;
  side: Side;
}

export interface BacktestTrade {
  date: string;
  entryTime: string;
  entry: number;
  stop: number;
  target: number;
  outcome: "target" | "stop" | "close";
  R: number;
  closePrice: number;
}

export interface BacktestResult {
  sessions: number;
  triggered: number;
  target: number;
  stop: number;
  close: number;
  green: number;
  avgR: number | null;
  rule: BacktestRule;
  trades: BacktestTrade[];
}

/**
 * 과거 세션 동일 셋업 백테스트 (참고 구현 timemachine.py 의 history_replay 이식).
 *
 * 같은 규칙을 과거의 모든 완전 세션에 그대로 적용한다.
 *  - 오프닝 레인지: 세션 첫 orBars 봉의 고가/저가
 *  - 진입: 그 범위를 처음으로 종가 돌파한 봉의 종가 (매수는 위, 매도는 아래)
 *  - 손절/목표: 진입가 × (1 ± 손절폭), 목표 = 진입가 ± 목표R × 위험폭
 *  - 진입 다음 봉부터 손절 먼저, 목표 나중 (한 봉에서 둘 다 닿으면 손절)
 */
export function historyReplay(
  sessions: Session[],
  times: string[],
  rule: BacktestRule
): BacktestResult {
  const long = rule.side === "buy";
  const n = Math.max(1, Math.min(rule.orBars, Math.floor(times.length / 4)));
  const trades: BacktestTrade[] = [];

  for (const session of sessions) {
    const bars = session.bars;
    if (bars.length !== times.length) continue;
    let orHigh = -Infinity;
    let orLow = Infinity;
    for (let i = 0; i < n; i++) {
      orHigh = Math.max(orHigh, bars[i][1]);
      orLow = Math.min(orLow, bars[i][2]);
    }
    let k = -1;
    for (let i = n; i < bars.length - 1; i++) {
      if (long ? bars[i][3] > orHigh : bars[i][3] < orLow) {
        k = i;
        break;
      }
    }
    if (k < 0) continue;
    const entry = bars[k][3];
    const risk = entry * rule.stopPct;
    if (!(risk > 0)) continue;
    const stop = long ? entry - risk : entry + risk;
    const target = long ? entry + rule.targetR * risk : entry - rule.targetR * risk;

    let outcome: BacktestTrade["outcome"] = "close";
    for (let i = k + 1; i < bars.length; i++) {
      const hi = bars[i][1];
      const lo = bars[i][2];
      if (long ? lo <= stop : hi >= stop) {
        outcome = "stop";
        break;
      }
      if (long ? hi >= target : lo <= target) {
        outcome = "target";
        break;
      }
    }
    const closePrice = bars[bars.length - 1][3];
    const R =
      outcome === "target"
        ? rule.targetR
        : outcome === "stop"
          ? -1
          : (long ? closePrice - entry : entry - closePrice) / risk;

    trades.push({
      date: session.date,
      entryTime: times[k + 1] ?? times[k],
      entry: round2(entry),
      stop: round2(stop),
      target: round2(target),
      outcome,
      R: Math.round(R * 100) / 100,
      closePrice: round2(closePrice),
    });
  }

  const sum = trades.reduce((a, t) => a + t.R, 0);
  return {
    sessions: sessions.length,
    triggered: trades.length,
    target: trades.filter((t) => t.outcome === "target").length,
    stop: trades.filter((t) => t.outcome === "stop").length,
    close: trades.filter((t) => t.outcome === "close").length,
    green: trades.filter((t) => t.R > 0).length,
    avgR: trades.length ? Math.round((sum / trades.length) * 1000) / 1000 : null,
    rule,
    trades: trades.slice().reverse(),
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
