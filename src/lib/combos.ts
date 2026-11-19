import type { Side } from "./types";
import type { Pool } from "./pool";
import { simulate } from "./simulate";
import { roundPrice } from "./format";

export interface ComboLevel {
  /** 진입가 대비 손절폭 (0.01 = 1%) */
  stopPct: number;
  stop: number;
}

export interface ComboCell {
  stopPct: number;
  stop: number;
  targetR: number;
  target: number;
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** 이익으로 끝난 비율(목표 도달 + 종가 이익 마감) = 승률 */
  pGreen: number;
  avgR: number;
}

export interface ComboResult {
  cells: ComboCell[];
  levels: ComboLevel[];
  targetRs: number[];
  replays: number;
  /** 9조합 전체 계산 시간(ms) */
  ms: number;
}

/** 손절폭 3단계: 내 계획의 0.6배 · 1배 · 1.5배 (가격 단위로 반올림) */
const MULTIPLIERS = [0.6, 1, 1.5];

export function buildStopLevels(
  entry: number,
  baseStopPct: number,
  unit: string,
  side: Side
): ComboLevel[] {
  const out: ComboLevel[] = [];
  const candidates = [...MULTIPLIERS, 0.35, 2.2, 3];
  for (const m of candidates) {
    if (out.length >= 3) break;
    const p = baseStopPct * m;
    if (!(p > 0)) continue;
    let stop = roundPrice(side === "buy" ? entry * (1 - p) : entry * (1 + p), unit);
    const minStep = unit === "원" || !unit ? 1 : Math.max(0.01, entry * 0.0005);
    if (side === "buy" && stop >= entry) stop = roundPrice(entry - minStep, unit);
    if (side === "sell" && stop <= entry) stop = roundPrice(entry + minStep, unit);
    const stopPct = Math.abs(entry - stop) / entry;
    if (!(stopPct > 0)) continue;
    if (out.some((o) => Math.abs(o.stopPct - stopPct) < 0.0002)) continue;
    out.push({ stopPct, stop });
  }
  return out.sort((a, b) => a.stopPct - b.stopPct);
}

/**
 * 손절 3단계 × 목표 3단계(1R·1.5R·2R) = 9조합을 실제 재생 엔진으로 빠르게 비교한다.
 * 밴드·샘플 궤적은 만들지 않는다(light). 같은 시드라 같은 입력이면 같은 결과.
 */
export function compareCombos(input: {
  pool: Pool;
  entry: number;
  side: Side;
  entryBar: number;
  levels: ComboLevel[];
  targetRs?: number[];
  replays?: number;
  seed?: number;
  /** 호가 단위 반올림용 통화 단위 ("원"이면 1원 단위) */
  unit?: string;
}): ComboResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { pool, entry, side, entryBar, levels } = input;
  const unit = input.unit ?? "";
  const targetRs = input.targetRs ?? [1, 1.5, 2];
  const replays = input.replays ?? 2500;
  const seed = input.seed ?? 19;

  const cells: ComboCell[] = [];
  for (const level of levels) {
    const risk = Math.abs(entry - level.stop);
    for (const targetR of targetRs) {
      // 화면·표에 보이는 목표가와 계산에 쓰는 목표가를 같게 만든다(호가 단위 반올림).
      const raw = side === "buy" ? entry + targetR * risk : entry - targetR * risk;
      let target = roundPrice(raw, unit);
      if (target === entry) {
        const step = unit === "원" ? 1 : 0.01;
        target = roundPrice(side === "buy" ? entry + step : entry - step, unit);
      }
      const sim = simulate({
        pool,
        entry,
        stop: level.stop,
        target,
        side,
        entryBar,
        replays,
        seed,
        light: true,
      });
      cells.push({
        stopPct: level.stopPct,
        stop: level.stop,
        targetR,
        target,
        pTarget: sim.pTarget,
        pStop: sim.pStop,
        pNeither: sim.pNeither,
        pGreen: sim.pGreen,
        avgR: sim.avgR,
      });
    }
  }
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return { cells, levels, targetRs, replays, ms };
}
