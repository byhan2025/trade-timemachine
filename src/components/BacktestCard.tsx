import type { BacktestResult } from "../lib/backtest";
import { formatPct, formatPrice, formatR } from "../lib/format";

export function BacktestCard({
  bt,
  unit,
  intervalMinutes,
}: {
  bt: BacktestResult;
  unit: string;
  intervalMinutes: number;
}) {
  const decided = bt.target + bt.stop;
  const hitAll = bt.triggered > 0 ? bt.target / bt.triggered : 0;
  const hitDecided = decided > 0 ? bt.target / decided : 0;
  const orMinutes = Math.round(bt.rule.orBars * intervalMinutes);
  const rows = bt.trades.slice(0, 8);
  return (
    <section className="card" data-testid="backtest">
      <div className="card-head">
        <h3 className="card-title">과거 실전 세션 참고 (오프닝 레인지 돌파 백테스트)</h3>
        <span className="badge">
          오프닝 레인지 {orMinutes}분 · {bt.rule.targetR.toFixed(2)}R
        </span>
      </div>
      <p className="card-desc">
        위 1만 회 재생과 <strong>다른 별도의 규칙</strong>입니다: 매 세션 첫 {orMinutes}분(봉{" "}
        {bt.rule.orBars}개)의 고가·저가를 오프닝 레인지로 잡고, 그 범위를 종가로 돌파한 봉에서 진입해
        진입가 대비 <strong>{(bt.rule.stopPct * 100).toFixed(2)}% 손절</strong>,{" "}
        <strong>{bt.rule.targetR.toFixed(2)}R 목표</strong>를 적용했습니다. 내가 입력한 진입가·손절가와는
        무관한 참고 비교입니다.
      </p>
      {bt.triggered === 0 && (
        <p className="alert warn small">
          이 규칙(오프닝 레인지 {orMinutes}분 돌파)으로는 과거 {bt.sessions}일 동안 진입이 한 번도
          발생하지 않았습니다. 봉 개수가 적거나 추세가 한쪽으로만 움직인 데이터에서는 흔한 결과입니다.
        </p>
      )}
      <div className="bt-stats">
        <div>
          <span className="stat-label">진입 발생</span>
          <strong>
            {bt.triggered}
            <span className="muted small"> / {bt.sessions}일</span>
          </strong>
        </div>
        <div>
          <span className="stat-label">목표 도달</span>
          <strong className="pos">{bt.target}</strong>
        </div>
        <div>
          <span className="stat-label">손절</span>
          <strong className="neg">{bt.stop}</strong>
        </div>
        <div>
          <span className="stat-label">미도달 종료</span>
          <strong>{bt.close}</strong>
        </div>
        <div>
          <span className="stat-label">목표 도달 비중 (전체 진입 기준)</span>
          <strong>{bt.triggered > 0 ? `${bt.target}/${bt.triggered} = ${formatPct(hitAll)}` : "-"}</strong>
        </div>
        <div>
          <span className="stat-label">목표 도달 비중 (종료 건 기준)</span>
          <strong>
            {decided > 0 ? `${bt.target}/${decided} = ${formatPct(hitDecided)}` : "-"}
          </strong>
        </div>
        <div>
          <span className="stat-label">평균 R</span>
          <strong className={bt.avgR === null ? "" : bt.avgR >= 0 ? "pos" : "neg"}>
            {bt.avgR === null ? "-" : formatR(bt.avgR)}
          </strong>
        </div>
        <div>
          <span className="stat-label">표본 세션</span>
          <strong>
            {bt.sessions}
            <span className="muted small">일</span>
          </strong>
        </div>
      </div>
      <p className="card-desc denom-note">
        분모를 둘 다 적었습니다. <strong>전체 진입 기준</strong>은 진입이 발생한 모든 건(종료 미도달
        포함)을 분모로, <strong>종료 건 기준</strong>은 목표·손절로 끝난 건만 분모로 셉니다. 미도달
        종료가 많을수록 두 수치가 크게 벌어집니다.
      </p>
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="trades">
            <caption className="sr-only">최근 백테스트 진입 {rows.length}건</caption>
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">진입</th>
                <th scope="col">결과</th>
                <th scope="col">R</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.date}-${t.entryTime}`}>
                  <td>
                    {t.date.slice(5)}
                    <span className="muted small"> {t.entryTime}</span>
                  </td>
                  <td>{formatPrice(t.entry, unit)}</td>
                  <td className={t.outcome === "target" ? "pos" : t.outcome === "stop" ? "neg" : ""}>
                    {t.outcome === "target" ? "목표" : t.outcome === "stop" ? "손절" : "종료"}
                  </td>
                  <td className={t.R >= 0 ? "pos" : "neg"}>{formatR(t.R)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="footnote">
        과거에 그 규칙이 어땠는지만 보여줍니다. 표본 {bt.sessions}일은 미래를 대표하지 않습니다.
      </p>
    </section>
  );
}
