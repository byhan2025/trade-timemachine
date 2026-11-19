import type { Side } from "./types";
import { riskFormula } from "./terms";

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
  /** 1주 가격(진입가) — 0주 원인을 '1주 가격 vs 계좌 금액'으로 가르기 위해 함께 돌려준다(v2.2.3) */
  entry: number;
  riskPerShare: number;
  rewardPerShare: number;
  rr: number;
  /** 계좌 × 1회 허용 손실률 */
  lossBudget: number;
  shares: number;
  /** 수량 × 1주당 위험폭 = 실제 1회 최대 손실(1R 금액) */
  maxLoss: number;
  /** 실제 1회 최대 손실 ÷ 계좌 (%) — 화면의 생존 시뮬레이션이 쓰는 유효 위험률. 수량 0주면 0 */
  effectiveRiskPct: number;
  /** 계좌 현금 한도 때문에 실제 위험률이 계획(riskPct)보다 작아졌는지 */
  riskLimitedByCash: boolean;
  /** 화면에 쓰는 1주당 위험폭 식 (매수·매도 부호 구분) */
  riskFormula: string;
  /** 수량 × 진입가 = 가정 포지션 금액(매도면 공매도 명목 금액) */
  cost: number;
  profitAtTarget: number;
  /** 기댓값 계산에 쓴 1회 평균 R (각주에 그대로 표기) */
  expectedR: number;
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

/** 손절폭이 진입가의 0.01% 미만이면 극단적으로 좁다고 본다(예: 100,000 / 99,999.99 = 0.00001%). */
export const EXTREME_STOP_RATIO = 0.0001;

/**
 * 포지션 사이징 (참고 구현 trader-budget/size.py 의 축소 이식).
 *
 *   수량 = floor( min( 계좌 × 1회 최대 손실률 ÷ 1주당 위험폭, 계좌 ÷ 진입가 ) )
 *
 * 1주당 위험폭 = |진입가 - 손절가|. 정수 주만 산다.
 * 매수·매도 모두 '현금으로 그 가격만큼 살 수 있는 수량'을 상한으로 쓴다.
 * 매도(공매도)는 증거금률·대주 가능 수량·대차료를 반영하지 않으므로 참고 수량이다.
 *
 * v2.1.3 — 계좌 현금 상한이 먼저 걸리면 실제 1회 최대 손실이 계획한 허용 손실보다
 * 훨씬 작아진다. 그래서 '실제 유효 위험률(effectiveRiskPct = 실제 최대 손실 ÷ 계좌)'을
 * 함께 돌려주고, 생존 시뮬레이션도 이 값을 쓴다(수량 카드와 같은 1R 기준).
 */
export function sizePosition(input: SizeInput): SizeResult {
  const { entry, stop, target, account, riskPct, expectedR, side } = input;
  const riskPerShare = Math.abs(entry - stop);
  const rewardPerShare = Math.abs(target - entry);
  const lossBudget = account * (riskPct / 100);
  const byLoss = riskPerShare > 0 ? Math.floor(lossBudget / riskPerShare) : 0;
  const byAccount = entry > 0 ? Math.floor(account / entry) : 0;
  const shares = Math.max(0, Math.min(byLoss, byAccount));
  const maxLoss = shares * riskPerShare;
  const warnings: string[] = [];
  if (riskPerShare <= 0) warnings.push("진입가와 손절가가 같아 위험폭이 0입니다.");
  if (riskPerShare > 0 && entry > 0 && riskPerShare / entry < EXTREME_STOP_RATIO) {
    warnings.push(
      `손절폭이 진입가의 0.01% 미만(진입 ${entry.toLocaleString("ko-KR")} / 손절 ${stop.toLocaleString(
        "ko-KR"
      )})으로 극단적으로 좁습니다. 호가 단위·체결 오차만으로도 손절이 즉시 걸릴 수 있어 결과를 참고용으로만 보세요.`
    );
  }
  if (shares === 0 && riskPerShare > 0) {
    // v2.2.3 — 0주의 원인을 하나로 뭉뚱그리지 않고 실제로 걸린 항목만 말한다.
    const tooWide = riskPerShare > lossBudget;
    const tooPricey = entry > account;
    const cause =
      tooWide && tooPricey
        ? "1주 위험폭이 1회 허용 손실 금액보다 크고, 1주 가격도 계좌 금액보다 큽니다"
        : tooWide
          ? "1주 위험폭이 1회 허용 손실 금액보다 큽니다"
          : tooPricey
            ? "1주 가격이 계좌 금액보다 큽니다"
            : "1주 위험폭·계좌 금액 기준으로 1주를 담을 수 없습니다";
    const advice =
      tooWide && tooPricey
        ? "계좌 금액이나 허용 손실률을 키우고, 손절폭도 좁혀야 합니다."
        : tooWide
          ? "계좌 금액이나 허용 손실률을 키우거나 손절폭을 좁혀야 합니다."
          : tooPricey
            ? "계좌 금액을 키우거나 1주 가격이 더 낮은 종목으로 확인해 보세요."
            : "계좌 금액·허용 손실률·손절폭을 다시 확인해 보세요.";
    warnings.push(`${cause} — ${advice}`);
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
    entry,
    riskPerShare,
    rewardPerShare,
    rr: riskPerShare > 0 ? rewardPerShare / riskPerShare : 0,
    lossBudget,
    shares,
    maxLoss,
    effectiveRiskPct: shares > 0 && account > 0 ? (maxLoss / account) * 100 : 0,
    riskLimitedByCash: shares > 0 && byAccount < byLoss,
    riskFormula: riskFormula(side),
    cost: shares * entry,
    profitAtTarget: shares * rewardPerShare,
    expectedR,
    expectedValue: maxLoss * expectedR,
    boundBy: riskPerShare <= 0 ? "없음" : byLoss <= byAccount ? "손실 한도" : "계좌 금액",
    positionLabel: side === "sell" ? "가정 포지션 금액" : "가정 매수 금액",
    disclosure: side === "sell" ? SHORT_DISCLOSURE : null,
    warnings,
  };
}
