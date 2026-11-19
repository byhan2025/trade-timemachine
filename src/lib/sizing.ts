import type { Side } from "./types";

export interface SizeInput {
  entry: number;
  stop: number;
  target: number;
  account: number;
  /** 1회 허용 손실률 (%) */
  riskPct: number;
  side: Side;
  /** 시뮬레이션 평균 R (기댓값 참고치 계산용) */
  expectedR: number;
}

export interface SizeResult {
  riskPerShare: number;
  rewardPerShare: number;
  rr: number;
  /** 계좌 × 1회 허용 손실률 */
  lossBudget: number;
  shares: number;
  /** 수량 × 1주당 위험폭 */
  maxLoss: number;
  cost: number;
  profitAtTarget: number;
  /** 수량 × 위험폭 × 평균 R (참고치) */
  expectedValue: number;
  /** 수량을 제한한 항목 */
  boundBy: "손실 한도" | "계좌 금액" | "없음";
  warnings: string[];
}

/**
 * 포지션 사이징 (참고 구현 trader-budget/size.py 의 축소 이식).
 *
 *   수량 = floor( min( 계좌 × 1회 최대 손실률 ÷ 1주당 위험폭, 계좌 ÷ 진입가 ) )
 *
 * 1주당 위험폭 = |진입가 - 손절가|. 정수 주만 산다.
 */
export function sizePosition(input: SizeInput): SizeResult {
  const { entry, stop, target, account, riskPct, expectedR } = input;
  const riskPerShare = Math.abs(entry - stop);
  const rewardPerShare = Math.abs(target - entry);
  const lossBudget = account * (riskPct / 100);
  const byLoss = riskPerShare > 0 ? Math.floor(lossBudget / riskPerShare) : 0;
  const byAccount = entry > 0 ? Math.floor(account / entry) : 0;
  const shares = Math.max(0, Math.min(byLoss, byAccount));
  const warnings: string[] = [];
  if (riskPerShare <= 0) warnings.push("진입가와 손절가가 같아 위험폭이 0입니다.");
  if (shares === 0 && riskPerShare > 0) {
    warnings.push(
      "1주 위험폭이 허용 손실 금액보다 큽니다. 계좌 금액이나 허용 손실률을 키우거나 손절폭을 좁혀야 합니다."
    );
  }
  if (byAccount < byLoss) {
    warnings.push("손실 한도보다 계좌 금액이 먼저 걸려 수량이 제한됐습니다(현금 매수 한도).");
  }
  return {
    riskPerShare,
    rewardPerShare,
    rr: riskPerShare > 0 ? rewardPerShare / riskPerShare : 0,
    lossBudget,
    shares,
    maxLoss: shares * riskPerShare,
    cost: shares * entry,
    profitAtTarget: shares * rewardPerShare,
    expectedValue: shares * riskPerShare * expectedR,
    boundBy: riskPerShare <= 0 ? "없음" : byLoss <= byAccount ? "손실 한도" : "계좌 금액",
    warnings,
  };
}
