import type { Pool } from "./pool";
import type { Side } from "./types";
import { mulberry32, randInt } from "./prng";

export interface SimInput {
  pool: Pool;
  entry: number;
  stop: number;
  target: number;
  side: Side;
  /** 진입이 일어난 봉의 인덱스 (0-based). 이 봉의 종가 이후부터 재생한다. */
  entryBar: number;
  /** 재생을 멈추는 봉 (기본: 세션 마지막 봉) */
  lastBar?: number;
  replays?: number;
  seed?: number;
  /** 같은 슬롯 주변 ±window 슬롯에서 봉을 뽑는다 (기본 2) */
  window?: number;
  samplePaths?: number;
  bandPaths?: number;
}

export interface SimResult {
  replays: number;
  seed: number;
  window: number;
  barsLeft: number;
  /** 목표가 먼저 닿은 비율 */
  pTarget: number;
  /** 손절가 먼저 닿은 비율 (한 봉에서 둘 다 닿으면 손절로 계산) */
  pStop: number;
  /** 장 마감까지 둘 다 안 닿은 비율 */
  pNeither: number;
  /** 목표 도달 또는 종료가 진입가보다 유리한 비율 */
  pGreen: number;
  avgR: number;
  rAtTarget: number;
  medianClose: number;
  p5Close: number;
  p95Close: number;
  /** 경로 분포 밴드: [단계][p5,p25,p50,p75,p95] */
  bands: number[][];
  /** 10~20개 샘플 궤적 (진입가에서 시작) */
  samplePaths: number[][];
  /** 계산에 걸린 시간(ms) */
  ms: number;
}

function pct(sorted: Float64Array, q: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

/**
 * 몬테카를로 재생 (참고 구현 sim.py / timemachine.py 의 simulate 이식).
 *
 * - 진입가에서 시작해 남은 봉을 한 봉씩 걷는다.
 * - i번째 봉은 j = i + randint(-window, window) (1..slots-1로 제한) 슬롯에서
 *   과거 봉 하나를 무작위로 골라 현재 가격에 곱한다(open/high/low/close 모두).
 * - 한 봉 안에서 손절가와 목표가가 모두 닿으면 손절로 센다(보수적).
 * - 목표/손절 어느 쪽도 안 닿으면 lastBar 종가 기준 '미도달'.
 */
export function simulate(input: SimInput): SimResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { pool, entry, stop, target, side } = input;
  const replays = input.replays ?? 10000;
  const seed = input.seed ?? 19;
  const window = input.window ?? 2;
  const samplePaths = input.samplePaths ?? 20;
  const bandPaths = input.bandPaths ?? 2000;
  const entryBar = input.entryBar;
  const lastBar = Math.min(input.lastBar ?? pool.slots - 1, pool.slots - 1);
  const slots = pool.slots;
  const long = side === "buy";
  const risk = long ? entry - stop : stop - entry;
  const rAtTarget = Math.round(((long ? target - entry : entry - target) / risk) * 10000) / 10000;

  const rng = mulberry32(seed);
  const { h, l, c, sessions } = pool;
  const paths: number[][] = [];
  const closes = new Float64Array(replays);
  let countTarget = 0;
  let countStop = 0;
  let countClose = 0;
  let green = 0;
  let sumR = 0;

  for (let n = 0; n < replays; n++) {
    let p = entry;
    let outcome = 0; // 0 = 미도달, 1 = 목표, -1 = 손절
    const keep = n < samplePaths;
    const path: number[] = keep ? [entry] : [];
    for (let i = entryBar + 1; i <= lastBar; i++) {
      let j = i;
      if (window !== 0) {
        j = i + randInt(rng, -window, window);
        if (j < 1) j = 1;
        else if (j > slots - 1) j = slots - 1;
      }
      const idx = Math.floor(rng() * sessions);
      const hi = p * h[j][idx];
      const lo = p * l[j][idx];
      const cl = p * c[j][idx];
      if (outcome === 0) {
        if (long) {
          if (lo <= stop) outcome = -1;
          else if (hi >= target) outcome = 1;
        } else {
          if (hi >= stop) outcome = -1;
          else if (lo <= target) outcome = 1;
        }
      }
      p = cl;
      if (keep) path.push(p);
    }
    closes[n] = p;
    if (outcome === 1) {
      countTarget++;
      sumR += rAtTarget;
      green++;
    } else if (outcome === -1) {
      countStop++;
      sumR -= 1;
    } else {
      countClose++;
      const rr = (long ? p - entry : entry - p) / risk;
      sumR += rr;
      if (rr > 0) green++;
    }
    if (keep) paths.push(path);
  }

  const sortedCloses = Float64Array.from(closes).sort();

  // 밴드: 같은 시드로 2,000개 경로를 한 번 더 걷는다 (참고 구현과 동일)
  const brng = mulberry32(seed);
  const steps = lastBar - entryBar + 1;
  const columns: Float64Array[] = [];
  for (let s = 0; s < steps; s++) columns.push(new Float64Array(bandPaths));
  for (let n = 0; n < bandPaths; n++) {
    let p = entry;
    columns[0][n] = entry;
    for (let i = entryBar + 1; i <= lastBar; i++) {
      let j = i;
      if (window !== 0) {
        j = i + randInt(brng, -window, window);
        if (j < 1) j = 1;
        else if (j > slots - 1) j = slots - 1;
      }
      const idx = Math.floor(brng() * sessions);
      p = p * c[j][idx];
      columns[i - entryBar][n] = p;
    }
  }
  const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
  const bands: number[][] = columns.map((col) => {
    const sorted = Float64Array.from(col).sort();
    return qs.map((q) => pct(sorted, q));
  });

  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;

  return {
    replays,
    seed,
    window,
    barsLeft: lastBar - entryBar,
    pTarget: countTarget / replays,
    pStop: countStop / replays,
    pNeither: countClose / replays,
    pGreen: green / replays,
    avgR: sumR / replays,
    rAtTarget,
    medianClose: pct(sortedCloses, 0.5),
    p5Close: pct(sortedCloses, 0.05),
    p95Close: pct(sortedCloses, 0.95),
    bands,
    samplePaths: paths,
    ms,
  };
}
