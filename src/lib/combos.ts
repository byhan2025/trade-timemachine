import type { Side } from "./types";
import type { ComboMode } from "./terms";
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
  /** 요청한 목표 배수(손절폭의 N배) */
  targetR: number;
  /** 화면·계산에 실제로 쓰인 목표가 (계산용 1원 단위 반올림 뒤) */
  target: number;
  /**
   * 실제 목표가와 손절가로 다시 계산한 배수 = |목표가 − 진입가| ÷ |진입가 − 손절가|.
   * v2.2.4 — 계산용 반올림 때문에 요청 배수와 달라질 수 있어, 표기는 이 값을 쓴다.
   */
  actualR: number;
  /** 같은 행에서 앞 칸과 목표가가 같아 다시 계산하지 않은 경우, 그 앞 칸의 목표 배수 */
  duplicateOfR?: number;
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** 이익 마감률 = 목표 도달 + 목표 미도달 유리 마감(종가 이익) */
  pGreen: number;
  avgR: number;
}

export interface ComboResult {
  cells: ComboCell[];
  levels: ComboLevel[];
  targetRs: number[];
  replays: number;
  /** 같은 목표가로 중복 계산을 건너뛴 칸 수 */
  duplicateCount: number;
  /** 9조합 전체 계산 시간(ms) */
  ms: number;
}

/** 손절폭 3단계: 내 계획의 0.6배 · 1배 · 1.5배 (가격 단위로 반올림) */
export const COMBO_STOP_MULTIPLIERS = [0.6, 1, 1.5];

/** 목표 3단계: 손절폭의 1배 · 1.5배 · 2배 */
export const COMBO_TARGET_MULTIPLES = [1, 1.5, 2];

const MULTIPLIERS = COMBO_STOP_MULTIPLIERS;

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
  /** 계산용 반올림 단위 ("원"이면 1원 단위 — 실제 거래소 호가 단위와는 다름) */
  unit?: string;
}): ComboResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { pool, entry, side, entryBar, levels } = input;
  const unit = input.unit ?? "";
  const targetRs = input.targetRs ?? COMBO_TARGET_MULTIPLES;
  const replays = input.replays ?? 2500;
  const seed = input.seed ?? 19;

  const cells: ComboCell[] = [];
  let duplicateCount = 0;
  for (const level of levels) {
    const risk = Math.abs(entry - level.stop);
    /** 같은 행에서 이미 쓴 목표가 — 계산용 반올림에서 두 배수가 같은 가격이 되면 한 번만 계산한다(v2.2.4) */
    const usedTargets: { targetR: number; target: number; cell: ComboCell }[] = [];
    for (const targetR of targetRs) {
      // 화면·표에 보이는 목표가와 계산에 쓰는 목표가를 같게 만든다(계산용 1원/0.01 단위 반올림).
      const raw = side === "buy" ? entry + targetR * risk : entry - targetR * risk;
      let target = roundPrice(raw, unit);
      if (target === entry) {
        const step = unit === "원" ? 1 : 0.01;
        target = roundPrice(side === "buy" ? entry + step : entry - step, unit);
      }
      /** 반올림 뒤 실제 배수 — 표기(열 이름·툴팁·고른 칸 설명)는 모두 이 값을 쓴다 */
      const actualR = risk > 0 ? Math.abs(target - entry) / risk : 0;
      const duplicate = usedTargets.find((u) => u.target === target);
      if (duplicate) {
        // 같은 목표가를 다시 재생하면 같은 결과가 나온다 — 결과만 그대로 옮기고 중복으로 표시한다.
        duplicateCount += 1;
        const cell: ComboCell = {
          stopPct: level.stopPct,
          stop: level.stop,
          targetR,
          target,
          actualR,
          duplicateOfR: duplicate.targetR,
          pTarget: duplicate.cell.pTarget,
          pStop: duplicate.cell.pStop,
          pNeither: duplicate.cell.pNeither,
          pGreen: duplicate.cell.pGreen,
          avgR: duplicate.cell.avgR,
        };
        cells.push(cell);
        continue;
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
      const cell: ComboCell = {
        stopPct: level.stopPct,
        stop: level.stop,
        targetR,
        target,
        actualR,
        pTarget: sim.pTarget,
        pStop: sim.pStop,
        pNeither: sim.pNeither,
        pGreen: sim.pGreen,
        avgR: sim.avgR,
      };
      usedTargets.push({ targetR, target, cell });
      cells.push(cell);
    }
  }
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return { cells, levels, targetRs, replays, duplicateCount, ms };
}

/** 중복 칸을 뺀 실제로 계산한 조합만 — 최고 칸 선택과 조합 수 표기에 쓴다 */
export function uniqueCells(cells: ComboCell[]): ComboCell[] {
  return cells.filter((c) => c.duplicateOfR === undefined);
}

export interface TargetColumn {
  /** 요청한 목표 배수 */
  targetR: number;
  /** 화면 열 이름에 적을 배수 — 요청대로 되었으면 요청값, 아니면 실제값 */
  label: number;
  /** 요청 배수와 실제 배수가 0.5% 넘게 다른 열(＊ 표시) */
  deviating: boolean;
  /** 그 열에 실제로 계산한 칸 수(중복 칸 제외) */
  computed: number;
}

/** 열 이름·실제 배수가 어긋나도 되는 폭 (0.5% ≈ 표기 소수 둘째 자리) */
export const COMBO_R_TOLERANCE = 0.005;

/**
 * 열 이름을 만들 때 쓸 배수 — 요청 배수(1.5배 등)와 그 열에 실제로 쓰인 목표가의 배수를 비교한다.
 * v2.2.4 — 진입 100,000 / 손절 99,999 같은 입력에서는 1원 단위 반올림 때문에 1.5배 목표가 100,002원이 되어
 * 실제로는 2배가 된다. 그때 열 이름을 '목표 1.5배'로 두면 목표가·칸 숫자와 서로 모순된다.
 */
export function targetColumnLabels(
  cells: ComboCell[],
  targetRs: number[]
): TargetColumn[] {
  return targetRs.map((targetR) => {
    const col = cells.filter((c) => c.targetR === targetR);
    const computed = col.filter((c) => c.duplicateOfR === undefined).length;
    if (!col.length) return { targetR, label: targetR, deviating: false, computed };
    const first = col[0].actualR;
    const agree = col.every((c) => Math.abs(c.actualR - first) <= COMBO_R_TOLERANCE);
    const matchesRequest = Math.abs(first - targetR) <= COMBO_R_TOLERANCE;
    const ok = agree && matchesRequest;
    return {
      targetR,
      label: ok ? targetR : agree ? first : targetR,
      deviating: !ok,
      computed,
    };
  });
}

/**
 * 조합표 성향 토글의 실제 선택 규칙.
 * - "green": 이익 마감률(pGreen) 최고 칸
 * - "avgR": 1회 평균 R(기댓값) 최고 칸 — 토글 이름도 이 기준 그대로 적는다
 * 같은 값이면 먼저 나온 칸을 쓴다(표 순서 고정).
 */
export function pickBestCell(cells: ComboCell[], mode: ComboMode): ComboCell | null {
  // 같은 목표가를 두 번 고르지 않도록 실제로 계산한 칸에서만 고른다(v2.2.4)
  const list = uniqueCells(cells);
  if (!list.length) return null;
  const score = (c: ComboCell) => (mode === "green" ? c.pGreen : c.avgR);
  let best = list[0];
  for (const c of list) if (score(c) > score(best)) best = c;
  return best;
}
