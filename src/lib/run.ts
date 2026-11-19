import type { Dataset, Side } from "./types";
import type { SimResult } from "./simulate";
import type { BacktestResult } from "./backtest";
import type { SizeResult } from "./sizing";

export interface RunPlan {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  entryBar: number;
  account: number;
  riskPct: number;
}

/** 1만 번 재생 한 번의 전체 결과 묶음 (시뮬레이터·최종 해석 리포트 공통) */
export interface RunResult {
  signature: string;
  sim: SimResult;
  size: SizeResult;
  bt: BacktestResult;
  dataset: Dataset;
  plan: RunPlan;
  warnings: string[];
}
