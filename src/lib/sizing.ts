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
  /** 가정한 포지션 방향 */
  side: Side;
  riskPerShare: number;
  rewardPerShare: number;
  rr: number;
  /** 계좌 × 1회 허용 손실률 */
  lossBudget: number;
  shares: number;
  /** 수량 × 1주당 위험폭 */
  maxLoss: number;
  /** 수량 × 진입가 = 가정 포지션 금액(매도면 공매도 명목 금액) */
  cost: number;
  profitAtTarget: number;
  /** 수량 × 위험폭 × 평균 R (참고치) */
  expectedValue: number;
  /** 수량을 제한한 항목 */
  boundBy: "손실 한도" | "계좌 금액" | "없음";
  /** 화면에 쓰는 포지션 금액 라벨 — 매도에 '매수 금액'을 쓰지 않기 위한 분기 */
  positionLabel: "가정 매수 금액" | "가정 포지션 금액";
  /** 매도(공매도) 가정에만 붙는 한계 고지. 매수면 null */
  disclosure: string | null;
  warnings: string[];
}

/** 매도 포지션 계산의 한계 — 증거금·대주·비용을 반영하지 않았음을 밝힌다. */
export const SHORT_DISCLOSURE =
  "공매도 증거금·대주 가능 여부·수수료/이자는 반영되지 않은 단순 현금 한도 기준 참고 수량입니다.";

/**
 * 포지션 사이징 (참고 구현 trader-budget/size.py 의 축소 이식).
 *
 *   수량 = floor( min( 계좌 × 1회 최대 손실률 ÷ 1주당 위험폭, 계좌 ÷ 진입가 ) )
 *
 * 1주당 위험폭 = |진입가 - 손절가|. 정수 주만 산다.
 * 매수·매도 모두 '현금으로 그 가격만큼 살 수 있는 수량'을 상한으로 쓴다.
 * 매도(공매도)는 증거금률·대주 가능 수량·대차료를 반영하지 않으므로 참고 수량이다.
 */
export function sizePosition(input: SizeInput): SizeResult {
  const { entry, stop, target, account, riskPct, expectedR, side } = input;
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
    warnings.push(
      side === "sell"
        ? "손실 한도보다 계좌 금액이 먼저 걸려 수량이 제한됐습니다(공매도도 현금 한도 기준)."
        : "손실 한도보다 계좌 금액이 먼저 걸려 수량이 제한됐습니다(현금 매수 한도)."
    );
  }
  return {
    side,
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
    positionLabel: side === "sell" ? "가정 포지션 금액" : "가정 매수 금액",
    disclosure: side === "sell" ? SHORT_DISCLOSURE : null,
    warnings,
  };
}
