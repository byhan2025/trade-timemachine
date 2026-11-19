import type { SizeResult } from "../lib/sizing";
import { formatMoneySigned, formatNumber, formatPrice, moneyLabel } from "../lib/format";

interface Props {
  size: SizeResult;
  unit: string;
  account: number;
  riskPct: number;
}

export function SizingCard({ size, unit, account, riskPct }: Props) {
  return (
    <section className="card">
      <h3 className="card-title">손실 한도 기준 수량 &amp; 리스크 요약</h3>
      <dl className="kv sizing-kv">
        <div>
          <dt>1주당 위험폭 (진입−손절)</dt>
          <dd>{formatPrice(size.riskPerShare, unit)}</dd>
        </div>
        <div>
          <dt>손익비 (R:R)</dt>
          <dd>1 : {size.rr.toFixed(2)}</dd>
        </div>
        <div className="kv-highlight">
          <dt>손실 한도 기준 계산 수량(참고)</dt>
          <dd>
            {formatNumber(size.shares, 0)}주
            <span className="muted small">
              {" "}
              ·{" "}
              {size.boundBy === "손실 한도"
                ? "손실 한도 안에서 계산"
                : size.boundBy === "계좌 금액"
                  ? "계좌 금액(현금)에서 제한"
                  : "제한 없음"}
            </span>
          </dd>
        </div>
        <div>
          <dt>가정된 손절가 체결 기준 손실액</dt>
          <dd className="neg">
            {moneyLabel(size.maxLoss, unit)}
            <span className="muted small">
              {" "}
              (허용 {moneyLabel(size.lossBudget, unit)}의{" "}
              {size.lossBudget > 0 ? ((size.maxLoss / size.lossBudget) * 100).toFixed(0) : "0"}%)
            </span>
            <span className="kv-sub">갭·미체결·슬리피지·수수료는 반영되지 않은 참고치입니다</span>
          </dd>
        </div>
        <div>
          <dt>목표 도달 시 수익(가정)</dt>
          <dd className="pos">{moneyLabel(size.profitAtTarget, unit)}</dd>
        </div>
        <div>
          <dt>기댓값 (참고치)</dt>
          <dd className={size.expectedValue >= 0 ? "pos" : "neg"}>
            {formatMoneySigned(size.expectedValue, unit)}
            <span className="muted small"> · 수량 × 위험폭 × 평균 R</span>
          </dd>
        </div>
        <div data-testid="position-value-row">
          <dt>{size.positionLabel}</dt>
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
        계좌 {moneyLabel(account, unit)} × 1회 허용 손실 {riskPct}% = {moneyLabel(size.lossBudget, unit)}을
        넘지 않도록 정수 주로 내림한 <strong>계산 예시</strong>입니다. 실제 체결 가격·수수료·세금에 따라
        달라지며, 기댓값은 과거 봉 분포의 평균 R일 뿐 미래 수익이 아닙니다.
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
