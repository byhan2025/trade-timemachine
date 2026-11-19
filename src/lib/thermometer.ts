import type { Dataset } from "./types";

export interface SessionRange {
  date: string;
  /** (세션 고가 − 세션 저가) ÷ 세션 첫 봉 시가 × 100 */
  rangePct: number;
}

export type ThermometerBand = "tight" | "narrow" | "similar" | "wide";

export interface Thermometer {
  sessions: number;
  /** 세션별 장중 고저폭(%) — 최근 순 */
  ranges: SessionRange[];
  /** 장중 평균 변동폭(%) */
  avgRangePct: number;
  medianRangePct: number;
  minRangePct: number;
  maxRangePct: number;
  /** 분봉 한 개의 평균 진폭(고−저 ÷ 종가) % = 이 데이터의 ATR 비율 */
  avgAtrPct: number;
  /** 진입 봉 이후 남은 구간(세션 고저폭 ÷ 진입가)의 중앙값·평균 (%) */
  remainMedianPct: number;
  remainAvgPct: number;
  /** 손절폭 ÷ 남은 구간 중앙 변동폭 */
  remainRatio: number;
  /** 남은 봉 수 */
  remainBars: number;
  /** 내 손절폭(%) */
  stopPct: number;
  /** 손절폭 ÷ 평균 장중 변동폭 */
  ratio: number;
  /** 손절폭보다 하루 변동폭이 컸던 세션 수 */
  exceededSessions: number;
  exceededPct: number;
  band: ThermometerBand;
  /** "평소 하루 평균 ±1.35% 출렁이는데 내 손절은 1.00%" */
  headline: string;
  /** 초보자용 한 줄 해석 */
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
 * 최근 세션들의 장중 변동폭과 내 손절폭을 비교하는 '흔들림 온도계'.
 * - 장중 변동폭 = 세션 고가와 저가의 폭 ÷ 세션 첫 봉 시가
 * - 분봉 진폭(ATR 비율) = 봉마다 (고가-저가) ÷ 종가 의 평균
 */
export function buildThermometer(
  dataset: Dataset,
  stopPct: number,
  entryBar?: number
): Thermometer {
  const ranges: SessionRange[] = [];
  const remain: number[] = [];
  let atrSum = 0;
  let atrCount = 0;
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
        atrSum += (b[1] - b[2]) / close;
        atrCount++;
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
  const ratio = avgRangePct > 0 ? stopPctPct / avgRangePct : 0;
  const exceededSessions = values.filter((v) => v > stopPctPct).length;
  const band: ThermometerBand =
    ratio < 0.5 ? "tight" : ratio < 1 ? "narrow" : ratio < 1.8 ? "similar" : "wide";

  const verdictByBand: Record<ThermometerBand, string> = {
    tight: `손절폭이 평소 하루 출렁임의 절반도 안 됩니다. 장중 잡음만으로도 자주 닿는 구조라, 손절이 잦고 승률이 낮게 나오기 쉽습니다.`,
    narrow: `손절폭이 평소 하루 출렁임보다 좁습니다. 흔들림에 자주 닿는 구조라 손절이 잦게 잡힐 수 있습니다.`,
    similar: `손절폭이 평소 하루 출렁임과 비슷한 범위입니다. 잡음은 어느 정도 견디지만, 갭이나 급한 흔들림에는 취약합니다.`,
    wide: `손절폭이 평소 하루 출렁임보다 넓습니다. 잡음에는 잘 견디는 대신, 한 번 손절될 때 줄어드는 금액이 커집니다.`,
  };

  return {
    sessions: ranges.length,
    ranges,
    avgRangePct,
    medianRangePct: quantile(values, 0.5),
    minRangePct: values.length ? Math.min(...values) : 0,
    maxRangePct: values.length ? Math.max(...values) : 0,
    avgAtrPct: atrCount ? (atrSum / atrCount) * 100 : 0,
    remainMedianPct: quantile(remain, 0.5),
    remainAvgPct: mean(remain),
    remainRatio:
      remain.length && quantile(remain, 0.5) > 0 ? stopPctPct / quantile(remain, 0.5) : 0,
    remainBars:
      entryBar !== undefined && dataset.sessions[0]
        ? Math.max(0, dataset.sessions[0].bars.length - 1 - entryBar)
        : 0,
    stopPct,
    ratio,
    exceededSessions,
    exceededPct: values.length ? exceededSessions / values.length : 0,
    band,
    headline: `평소 하루 평균 ±${avgRangePct.toFixed(2)}% 출렁이는데 내 손절은 ${stopPctPct.toFixed(
      2
    )}%입니다.`,
    verdict: verdictByBand[band],
  };
}
