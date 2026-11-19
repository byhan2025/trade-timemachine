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
      <h3 className="card-title">적정 수량 & 리스크 요약</h3>
      <dl className="kv">
        <div>
          <dt>1주당 위험폭 (진입−손절)</dt>
          <dd>{formatPrice(size.riskPerShare, unit)}</dd>
        </div>
        <div>
          <dt>손익비 (R:R)</dt>
          <dd>1 : {size.rr.toFixed(2)}</dd>
        </div>
        <div className="kv-highlight">
          <dt>적정 매수 수량</dt>
          <dd>
            {formatNumber(size.shares, 0)}주
            <span className="muted small"> · {size.boundBy} 기준</span>
          </dd>
        </div>
        <div>
          <dt>예상 최대 손실액</dt>
          <dd className="neg">
            {moneyLabel(size.maxLoss, unit)}
            <span className="muted small">
              {" "}
              (허용 {moneyLabel(size.lossBudget, unit)}의{" "}
              {size.lossBudget > 0 ? ((size.maxLoss / size.lossBudget) * 100).toFixed(0) : "0"}%)
            </span>
          </dd>
        </div>
        <div>
          <dt>목표 도달 시 수익</dt>
          <dd className="pos">{moneyLabel(size.profitAtTarget, unit)}</dd>
        </div>
        <div>
          <dt>기댓값 (참고치)</dt>
          <dd className={size.expectedValue >= 0 ? "pos" : "neg"}>
            {formatMoneySigned(size.expectedValue, unit)}
            <span className="muted small"> · 수량 × 위험폭 × 평균 R</span>
          </dd>
        </div>
        <div>
          <dt>매수 금액</dt>
          <dd>{moneyLabel(size.cost, unit)}</dd>
        </div>
      </dl>
      <p className="footnote">
        계좌 {moneyLabel(account, unit)} × 1회 허용 손실 {riskPct}% = {moneyLabel(size.lossBudget, unit)}을
        넘지 않도록 정수 주로 내림했습니다. 기댓값은 과거 봉 분포의 평균 R일 뿐 미래 수익이 아닙니다.
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
