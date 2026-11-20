import type { SizeResult } from "../lib/sizing";
import { EXTREME_STOP_RATIO } from "../lib/sizing";
import {
  formatMoneySigned,
  formatNumber,
  formatPctValue,
  formatPrice,
  moneyLabel,
} from "../lib/format";
import { expectedValueNote } from "../lib/terms";
import { easySizingLine } from "../lib/easy";

interface Props {
  size: SizeResult;
  unit: string;
  account: number;
  riskPct: number;
  /** 카드 제목 — 리포트는 '4. 한 번에 몇 주를 …', 시뮬레이터는 번호 없이 */
  heading?: string;
  headingId?: string;
  /** 손절폭이 진입가의 0.01% 미만인 극단 입력 (회색 중립 + 참고 안내) */
  extreme?: boolean;
}

/**
 * 수량·리스크 카드 (v2.2 쉬운 말 버전).
 * 항목 이름은 "1주가 손절되면 잃는 돈"처럼 일상어로 먼저 쓰고, 정확한 용어(1주당 위험폭·R:R·기댓값)는
 * 작은 글씨로 함께 남긴다. 계산식과 경고는 그대로 유지한다.
 */
export function SizingCard({
  size,
  unit,
  account,
  riskPct,
  heading,
  headingId,
  extreme,
}: Props) {
  const extremeStop = extreme === true;
  const buy = size.side === "buy";
  const title = heading ?? `한 번에 몇 주를 ${buy ? "사야" : "팔아야"} 할까요?`;
  const easy = easySizingLine({
    shares: size.shares,
    side: size.side,
    account,
    riskPct,
    lossBudget: size.lossBudget,
    maxLoss: size.maxLoss,
    effectiveRiskPct: size.effectiveRiskPct,
    riskLimitedByCash: size.riskLimitedByCash,
    unit,
    entry: size.entry,
    riskPerShare: size.riskPerShare,
    extreme: extremeStop,
  });
  /** 극단 입력의 기댓값·목표 수익은 회색 중립색으로 — 수익 예상처럼 읽히지 않게 */
  const neutralValue = extremeStop || !(size.shares > 0);
  /** 계산 수량 0주 — 매매가 실행되지 않는 무포지션 상태 */
  const noPosition = !(size.shares > 0);

  return (
    <section className="card sizing-card" aria-labelledby={headingId ?? "sizing-title"}>
      <h3 className="card-title" id={headingId ?? "sizing-title"}>
        {title}
      </h3>
      <p className="easy-line" data-testid="easy-sizing">
        {easy}
      </p>
      <dl className="kv sizing-kv" data-testid="sizing-kv">
        <div>
          <dt>
            1주가 손절되면 잃는 돈
            <span className="kv-term">1주당 위험폭 ({size.riskFormula})</span>
          </dt>
          <dd>{formatPrice(size.riskPerShare, unit)}</dd>
        </div>
        <div>
          <dt>
            이길 때 버는 돈 ÷ 질 때 잃는 돈
            <span className="kv-term">손익비 (R:R)</span>
          </dt>
          <dd>1 : {formatNumber(size.rr, 2)}</dd>
        </div>
        <div className="kv-highlight">
          <dt>
            한 번에 {buy ? "사면" : "팔면"} 되는 주식 수(참고)
            <span className="kv-term">손실 한도 기준 계산 수량</span>
          </dt>
          <dd>
            {formatNumber(size.shares, 0)}주
            <span className="kv-sub">
              {noPosition
                ? "1주도 살 수 없는 조건(무포지션)"
                : size.boundBy === "손실 한도"
                  ? "손실 한도 안에서 계산"
                  : size.boundBy === "계좌 금액"
                    ? "계좌 금액(현금)에서 제한"
                    : "제한 없음"}
            </span>
          </dd>
        </div>
        <div>
          <dt>
            손절되면 잃는 돈 (전체)
            <span className="kv-term">가정된 손절가 체결 기준 손실액</span>
          </dt>
          <dd className="neg">
            {moneyLabel(size.maxLoss, unit)}
            <span className="kv-sub">
              {" "}
              (허용 {moneyLabel(size.lossBudget, unit)}의{" "}
              {size.lossBudget > 0
                ? formatPctValue((size.maxLoss / size.lossBudget) * 100, 0)
                : "0%"}
              ) · 갭·미체결·슬리피지·수수료는 반영하지 않은 참고치예요
            </span>
          </dd>
        </div>
        <div data-testid="effective-risk-row">
          <dt>
            내 계좌에서 거는 위험 비율
            <span className="kv-term">실제 1회 위험률 (이 손실액 ÷ 계좌)</span>
          </dt>
          <dd>
            {formatPctValue(size.effectiveRiskPct, 2)}
            <span className="kv-sub" data-testid="effective-risk-note">
              {noPosition ? (
                "0주라 실제로 거는 돈이 없어요 — 자금 변동이 없으므로 아래 생존 시뮬레이션도 0%로 계산합니다."
              ) : (
                <>
                  계획한 허용 손실 {formatPctValue(riskPct, 2)} 기준으로는{" "}
                  {moneyLabel(size.lossBudget, unit)}이지만, 실제 수량 {formatNumber(size.shares, 0)}주 ×
                  위험폭 {formatPrice(size.riskPerShare, unit)} = {moneyLabel(size.maxLoss, unit)}이에요.
                  아래 생존 시뮬레이션도 이 비율로 계산합니다.
                </>
              )}
            </span>
          </dd>
        </div>
        <div>
          <dt>
            목표에 닿으면 버는 돈 (가정)
            <span className="kv-term">목표 도달 시 수익</span>
          </dt>
          {/* 극단 입력이면 목표 수익도 초록 강조 없이 중립 회색 (v2.2.3) */}
          <dd className={neutralValue ? "neutral" : "pos"} data-testid="profit-at-target">
            {moneyLabel(size.profitAtTarget, unit)}
            {noPosition ? (
              <span className="kv-sub" data-testid="profit-zero-note">
                0주라 목표에 닿아도 버는 돈이 없어요
              </span>
            ) : (
              extremeStop && (
                <span className="kv-sub" data-testid="profit-extreme-note">
                  극단적으로 좁은 손절폭이라 이 금액은 참고하기 어려워요
                </span>
              )
            )}
          </dd>
        </div>
        <div>
          <dt>
            1번 할 때 평균 (참고)
            <span className="kv-term">기댓값 = 실제 1R × 1회 평균 R</span>
          </dt>
          <dd className="kv-neutral" data-testid="expected-value">
            {formatMoneySigned(size.expectedValue, unit)}
            <span className="kv-sub" data-testid="expected-value-note">
              {expectedValueNote(size.side, size.expectedR)}
              {/*
                v2.2.4 — 0주(무포지션)와 극단 손절폭은 서로 다른 이유다.
                `neutralValue`(색)에 손절폭 경고를 묶어 두어, 0주인데 손절폭은 정상인 입력
                (진입 200,000 / 손절 199,000 / 계좌 100,000)에 "극단적으로 좁은 손절폭"이
                잘못 붙던 문제를 원인별 문구로 분리한다.
              */}
              {noPosition
                ? " · 0주라 1번에 거는 손절 금액이 없어 기댓값도 0원이에요"
                : extremeStop
                  ? " · 극단적으로 좁은 손절폭이라 참고하기 어려워요"
                  : ""}
            </span>
          </dd>
        </div>
        <div data-testid="position-value-row">
          <dt>
            {buy ? "이 포지션에 들어가는 돈" : "공매도로 파는 금액 (가정)"}
            <span className="kv-term">{size.positionLabel}</span>
          </dt>
          <dd>
            {moneyLabel(size.cost, unit)}
            {size.disclosure && (
              <span className="kv-sub" data-testid="sell-disclosure">
                {size.disclosure}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="footnote">
        계좌 {moneyLabel(account, unit)}의 1회 허용 손실 {formatPctValue(riskPct, 2)} ={" "}
        {moneyLabel(size.lossBudget, unit)}을 넘지 않도록 정수 주로 내림한{" "}
        <strong>계산 예시</strong>예요.
        {size.riskLimitedByCash && (
          <>
            {" "}
            다만 계좌 현금 한도가 먼저 걸려 실제로 잃는 돈은{" "}
            <strong>{moneyLabel(size.maxLoss, unit)}</strong>(계좌의{" "}
            {formatPctValue(size.effectiveRiskPct, 2)})예요.
          </>
        )}{" "}
        실제 체결 가격·수수료·세금에 따라 달라지고, 1번 평균은 과거 봉 분포의 평균일 뿐 미래 수익이
        아닙니다.
        {size.side === "sell" &&
          " 매도 가정은 공매도 증거금·대주 가능 여부·수수료/이자를 반영하지 않은 현금 한도 기준 참고 수량입니다."}
      </p>
      {size.warnings.length > 0 && (
        <ul className="warn-list">
          {size.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 진입가 대비 손절폭이 극단적으로 좁은지 — 리포트·시뮬레이터가 같은 기준을 쓴다 */
export function isExtremeStop(entry: number, stop: number): boolean {
  if (!(entry > 0)) return false;
  return Math.abs(entry - stop) / entry < EXTREME_STOP_RATIO;
}
