import type { Dataset } from "../lib/types";

/** 2026-11-20T00:29:07.624+09:00 -> 2026-11-20 00:29 */
function when(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? `${m[1]} ${m[2]}` : value;
}

export function DataNote({ dataset, warnings }: { dataset: Dataset; warnings: string[] }) {
  const m = dataset.meta;
  return (
    <section className="card data-note">
      <h3 className="card-title">데이터 출처 · 기준</h3>
      <dl className="kv compact">
        <div>
          <dt>데이터</dt>
          <dd>
            {dataset.name === dataset.symbol ? dataset.symbol : `${dataset.name} (${dataset.symbol})`} ·{" "}
            {dataset.market}
          </dd>
        </div>
        <div>
          <dt>출처</dt>
          <dd>{m.source}</dd>
        </div>
        <div>
          <dt>{dataset.custom ? "적용 시각" : "수집 기준일"}</dt>
          <dd>{when(m.fetchedAt)}</dd>
        </div>
        <div>
          <dt>봉 단위</dt>
          <dd>
            {m.interval} · 봉 시각은 {m.barTimestampMeans ?? "봉 시작 시각"} · 세션 {m.sessionStart}~{m.sessionEnd}
          </dd>
        </div>
        <div>
          <dt>사용 세션</dt>
          <dd>
            {m.sessionsUsed}일 ({m.firstDate} ~ {m.lastDate}) · 세션당 {m.sessionBars}봉
          </dd>
        </div>
        {m.sessionsDropped && m.sessionsDropped.length > 0 && (
          <div>
            <dt>제외 세션</dt>
            <dd>
              {m.sessionsDropped.map((s) => `${s.date}(${s.bars}봉)`).join(", ")} — 반장·누락·진행 중
            </dd>
          </div>
        )}
        {m.note && (
          <div>
            <dt>비고</dt>
            <dd>{m.note}</dd>
          </div>
        )}
      </dl>
      {m.sourceUrl && (
        <p className="footnote source-link-row">
          <span className="muted small">원본</span>
          <a className="source-link" href={m.sourceUrl} rel="noreferrer noopener" target="_blank">
            <span>{m.sourceUrl}</span>
          </a>
        </p>
      )}
      <p className="footnote noncommercial">
        이 앱은 <strong>개인 연구·참고용 비상업 통계 도구</strong>입니다. 위 공개 시세를 그대로 보여줄 뿐
        매매 신호·투자 권유가 아니며, 시세 데이터의 재배포나 상업적 이용을 목적으로 하지 않습니다.
      </p>
      {warnings.length > 0 && (
        <ul className="warn-list">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
