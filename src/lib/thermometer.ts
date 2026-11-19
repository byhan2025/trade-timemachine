import type { Dataset } from "./types";

export interface SessionRange {
  date: string;
  /** 일중 고저폭(%) = (세션 고가 − 세션 저가) ÷ 세션 첫 봉 시가 × 100 */
  rangePct: number;
}

export type ThermometerBand = "tight" | "narrow" | "similar" | "wide";

export interface Thermometer {
  sessions: number;
  /** 세션별 일중 고저폭(%) — 최근 순 */
  ranges: SessionRange[];
  /** 일중 고저폭 평균(%) */
  avgRangePct: number;
  medianRangePct: number;
  minRangePct: number;
  maxRangePct: number;
  /**
   * 분봉 한 개 평균 고저폭(%) = 봉마다 (고가 − 저가) ÷ 종가 의 평균.
   * 표준 Wilder ATR(전일 종가 대비 갭·True Range 평활)이 아니므로 ATR로 부르지 않는다.
   */
  avgBarRangePct: number;
  /** 진입 봉 이후 남은 구간(세션 고저폭 ÷ 진입가)의 중앙값·평균 (%) */
  remainMedianPct: number;
  remainAvgPct: number;
  /** 손절폭 ÷ 남은 구간 중앙 고저폭 — '남은 구간 대비 내 손절은 몇 배인가' (손절이 좁으면 1 미만) */
  remainRatio: number;
  /** 남은 구간 중앙 고저폭 ÷ 손절폭 — '남은 구간은 내 손절의 몇 배인가' (손절이 좁으면 1 초과) */
  remainMultipleStop: number;
  /** 남은 봉 수 */
  remainBars: number;
  /** 내 손절폭(%) */
  stopPct: number;
  /** 손절폭 ÷ 평균 일중 고저폭 */
  ratio: number;
  /** 손절폭보다 일중 고저폭이 컸던 세션 수 */
  exceededSessions: number;
  exceededPct: number;
  band: ThermometerBand;
  /** "평소 하루 평균 일중 고저폭 4.22%인데 내 손절은 1.00%입니다." */
  headline: string;
  /** 초보자용 한 줄 해석 (방향·경로를 단정하지 않는 중립 문장) */
  verdict: string;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/**
 * 최근 세션들의 일중 고저폭(고가−저가 전체 범위)과 내 손절폭을 비교하는 '흔들림 온도계'.
 * - 일중 고저폭 = (세션 고가 − 세션 저가) ÷ 세션 첫 봉 시가
 *   · 양방향 편차가 아니라 하루 안에서 위아래로 움직인 전체 폭이다. 그래서 ±를 쓰지 않는다.
 * - 분봉 한 개 평균 고저폭 = 봉마다 (고가 − 저가) ÷ 종가 의 평균
 *   · 표준 Wilder ATR이 아니므로 'ATR'로 표기하지 않는다.
 */
export function buildThermometer(
  dataset: Dataset,
  stopPct: number,
  entryBar?: number
): Thermometer {
  const ranges: SessionRange[] = [];
  const remain: number[] = [];
  let barRangeSum = 0;
  let barRangeCount = 0;
  for (const session of dataset.sessions) {
    const bars = session.bars;
    if (!bars.length) continue;
    let high = -Infinity;
    let low = Infinity;
    for (const b of bars) {
      if (b[1] > high) high = b[1];
      if (b[2] < low) low = b[2];
      const close = b[3];
      if (close > 0) {
        barRangeSum += (b[1] - b[2]) / close;
        barRangeCount++;
      }
    }
    const open = bars[0][0];
    if (!(open > 0) || !isFinite(high) || !isFinite(low)) continue;
    ranges.push({ date: session.date, rangePct: ((high - low) / open) * 100 });

    // 진입 봉 종가 이후 남은 구간만의 고저폭 — 손절이 실제로 겪는 흔들림
    if (entryBar !== undefined && entryBar >= 0 && bars.length > entryBar + 1) {
      const ref = bars[entryBar][3];
      let rh = -Infinity;
      let rl = Infinity;
      for (let i = entryBar + 1; i < bars.length; i++) {
        if (bars[i][1] > rh) rh = bars[i][1];
        if (bars[i][2] < rl) rl = bars[i][2];
      }
      if (ref > 0 && isFinite(rh) && isFinite(rl)) remain.push(((rh - rl) / ref) * 100);
    }
  }

  const values = ranges.map((r) => r.rangePct);
  const avgRangePct = mean(values);
  const stopPctPct = stopPct * 100;
  const remainMedianPct = quantile(remain, 0.5);
  const ratio = avgRangePct > 0 ? stopPctPct / avgRangePct : 0;
  const exceededSessions = values.filter((v) => v > stopPctPct).length;
  const band: ThermometerBand =
    ratio < 0.5 ? "tight" : ratio < 1 ? "narrow" : ratio < 1.8 ? "similar" : "wide";

  // 고저폭은 방향·진입 후 경로를 구분하지 않으므로 band 별 문장도 사실만 말한다.
  const bandFact: Record<ThermometerBand, string> = {
    tight: `손절폭 ${stopPctPct.toFixed(2)}%는 최근 ${ranges.length}세션 평균 일중 고저폭 ${avgRangePct.toFixed(
      2
    )}%의 ${ratio.toFixed(2)}배로, 평균 고저폭보다 좁습니다.`,
    narrow: `손절폭 ${stopPctPct.toFixed(2)}%는 평균 일중 고저폭 ${avgRangePct.toFixed(
      2
    )}%의 ${ratio.toFixed(2)}배로, 평균보다 조금 좁습니다.`,
    similar: `손절폭 ${stopPctPct.toFixed(2)}%는 평균 일중 고저폭 ${avgRangePct.toFixed(
      2
    )}%의 ${ratio.toFixed(2)}배로, 평균과 비슷한 범위입니다.`,
    wide: `손절폭 ${stopPctPct.toFixed(2)}%는 평균 일중 고저폭 ${avgRangePct.toFixed(
      2
    )}%의 ${ratio.toFixed(2)}배로, 평균보다 넓습니다.`,
  };
  const neutral =
    `일중 고저폭(고가−저가)이 내 손절폭보다 큰 날이 ${exceededSessions}일 있었으나, ` +
    "고저폭은 방향과 진입 후 경로를 구분하지 않는 단순 참고 지표입니다. " +
    "실제 분포는 1만 번 재생·백테스트 결과를 기준으로 확인하세요.";

  return {
    sessions: ranges.length,
    ranges,
    avgRangePct,
    medianRangePct: quantile(values, 0.5),
    minRangePct: values.length ? Math.min(...values) : 0,
    maxRangePct: values.length ? Math.max(...values) : 0,
    avgBarRangePct: barRangeCount ? (barRangeSum / barRangeCount) * 100 : 0,
    remainMedianPct,
    remainAvgPct: mean(remain),
    // 분자·분모를 뒤집지 않는다: 배지는 '손절 ÷ 남은 구간', 문장은 '남은 구간 ÷ 손절'.
    remainRatio: remainMedianPct > 0 ? stopPctPct / remainMedianPct : 0,
    remainMultipleStop:
      remainMedianPct > 0 && stopPctPct > 0 ? remainMedianPct / stopPctPct : 0,
    remainBars:
      entryBar !== undefined && dataset.sessions[0]
        ? Math.max(0, dataset.sessions[0].bars.length - 1 - entryBar)
        : 0,
    stopPct,
    ratio,
    exceededSessions,
    exceededPct: values.length ? exceededSessions / values.length : 0,
    band,
    headline: `평소 하루 평균 일중 고저폭(고가−저가) ${avgRangePct.toFixed(
      2
    )}%인데 내 손절은 ${stopPctPct.toFixed(2)}%입니다.`,
    verdict: `${bandFact[band]} ${neutral}`,
  };
}
