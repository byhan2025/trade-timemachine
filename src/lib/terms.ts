import type { Side } from "./types";
import { formatR } from "./format";

/**
 * v2.1.3 — 리포트에 쓰는 용어·수식의 단일 출처.
 * 4호 봇·부이 대리 지적: 매도(short)에서 '진입가 − 손절가'만 쓰면 부호가 뒤집히고,
 * '승률'·'손익비 추구형' 같은 이름이 실제 계산식과 어긋났다.
 * 그래서 화면 문구와 토글 이름을 여기 한 곳에서 만들고 단위 테스트로 고정한다.
 */

/** 손절폭(1R)의 방향별 식 — 매수는 진입가 − 손절가, 매도는 손절가 − 진입가. */
export function riskFormula(side: Side): string {
  return side === "buy" ? "진입가 − 손절가" : "손절가 − 진입가";
}

/** 방향과 무관한 1R 정의 — 항상 양수인 폭. */
export const RISK_FORMULA_ABS = "|진입가 − 손절가|";

/** 목표 도달 + 목표 미도달 유리 마감을 모두 포함하는 비율의 정확한 이름 */
export const GREEN_LABEL = "이익 마감률";
/** 이익 마감률의 구성 (한 줄 설명) */
export const GREEN_BREAKDOWN = "목표 도달 + 목표 미도달 유리 마감";

export type ComboMode = "green" | "avgR";

/** 조합표 성향 토글 — 이름과 실제 선택 기준을 1:1로 맞춘다. */
export const COMBO_MODES: { key: ComboMode; label: string; hint: string }[] = [
  {
    key: "green",
    label: `${GREEN_LABEL} 우선`,
    hint: "목표 도달 + 유리 마감 1위 칸",
  },
  {
    key: "avgR",
    label: "평균 R(기댓값) 우선",
    hint: "평균 R 1위 칸",
  },
];

export function comboModeHint(mode: ComboMode): string {
  return mode === "green"
    ? `${GREEN_LABEL}(${GREEN_BREAKDOWN})이 가장 높은 칸`
    : "1회 평균 R(기댓값)이 가장 높은 칸";
}

/** 조합표 '최고 칸' 배지 — 전부 마이너스면 추천처럼 읽히지 않게 중립 표기 */
export function bestBadgeText(mode: ComboMode, allNegative: boolean): string {
  const criterion = mode === "green" ? GREEN_LABEL : "평균 R";
  // 전부 마이너스일 때도 어떤 기준으로 고른 칸인지는 밝힌다(추천으로 읽히지 않게 '참고').
  if (allNegative) return `가장 높았던 칸(참고) · ${criterion} 기준`;
  return mode === "green" ? `${GREEN_LABEL} 최고` : "평균 R 최고";
}

/** 용어 풀이 — R배수 (매수·매도 부호를 구분해 적는다) */
export function rGloss(side: Side): string {
  return (
    `내가 정한 손절폭, 즉 ${RISK_FORMULA_ABS}(항상 양수)이 1R입니다. ` +
    `지금 가정은 ${side === "buy" ? "매수" : "매도"}라서 1R = ${riskFormula(side)}입니다. ` +
    (side === "sell" ? "매도는 진입가보다 위에서 손절하므로 부호가 반대입니다. " : "") +
    "목표까지 2배 떨어져 있으면 +2R, 손절되면 −1R입니다. 금액이 아니라 손절 대비 몇 배로 세는 단위라 종목이 달라도 비교할 수 있습니다."
  );
}

/** 용어 풀이 — 이익 마감률 (목표 도달률과의 차이를 명확히) */
export function greenGloss(): string {
  return (
    `${GREEN_LABEL}은 ${GREEN_BREAKDOWN}을 합친 비율입니다. ` +
    "목표 도달률(목표가에 먼저 닿은 비율)과 다릅니다 — 목표에 닿지 못하고 장이 끝났어도 종가가 진입가보다 유리하면 이익 마감으로 셉니다. " +
    "손절이나 불리한 종가는 세지 않습니다. 그래서 이 값은 항상 목표 도달률보다 크거나 같습니다."
  );
}

/**
 * 수량 카드 기댓값 각주 — 어느 방향·어떤 평균 R로 곱했는지 밝힌다.
 * 9조합표·3줄 요약의 평균 R과 방향을 바로 대조할 수 있게 하기 위한 표기.
 */
export function expectedValueNote(side: Side, expectedR: number): string {
  return `${side === "buy" ? "매수" : "매도"} 가정 · 평균 ${formatR(expectedR)} 단순 곱 · 수수료·세금·갭 미반영`;
}
