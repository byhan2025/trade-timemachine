import type { Dataset } from "../lib/types";
import type { SimResult } from "../lib/simulate";
import { formatPriceNumber, formatR } from "../lib/format";
import {
  EXTREME_AVG_R_NOTE,
  EXTREME_POSITIVE_NOTE,
  avgRTone,
  greenRatePct,
  pctThree,
  positiveTone,
} from "../lib/easy";

/** "2026-11-20T00:03:36+09:00" -> "2026-11-20 00:03" (그 외 형식은 그대로) */
function shortTime(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (m) return `${m[1]} ${m[2]}`;
  return value;
}

/** 데이터 기준일·수집 시각·출처를 한 줄로 */
function basisLine(dataset?: Dataset): string {
  if (!dataset) return "";
  const m = dataset.meta;
  // v2.3.1 — 가상 체험·내 API 키·내 파일을 공개 시세로 오해하지 않게 출처를 정확히 적는다
  const source = dataset.custom
    ? "내가 올린 데이터 기준"
    : dataset.live
      ? "내 API 키로 조회한 시세 기준"
      : dataset.synthetic
        ? "가상 생성 통계 예시 기준(실제 시세 아님)"
        : "공개 시세 기준";
  return [
    `기준일 ${m.lastDate}`,
    `${dataset.live ? "조회" : "수집"} ${shortTime(m.fetchedAt)}`,
    `${m.sessionsUsed}세션`,
    m.interval,
    source,
  ].join(" · ");
}

export function ResultCards({
  sim,
  unit,
  dataset,
  extreme,
}: {
  sim: SimResult;
  unit: string;
  dataset?: Dataset;
  /** 손절폭이 진입가의 0.01% 미만인 극단 입력 — 평균 결과를 초록/빨강 대신 중립 회색으로 */
  extreme?: boolean;
}) {
  const avgRToneName = avgRTone(sim.avgR, extreme === true);
  /** 극단 입력이면 긍정(초록) 강조를 끈다 — 목표 카드·이익 마감률 모두 중립(v2.2.3) */
  const positive = positiveTone(extreme === true);
  const fmt = (x: number) => formatPriceNumber(x, unit);
  /** 세 칸·이익 마감률 구성의 표기는 easy.ts 한 곳에서 — 5초 요약 배너·리포트와 같은 문자열을 쓴다 */
  const p3 = pctThree(sim.pTarget, sim.pStop, sim.pNeither);
  const green = greenRatePct(sim.pTarget, sim.pGreen);
  const items = [
    {
      key: "target",
      label: "목표가 먼저 도달",
      value: sim.pTarget,
      text: p3.target,
      // 녹색 목표 카드는 '좋은 결과' 강조라 극단 입력에서는 중립 카드로 바꿔 끈다
      color: extreme === true ? "neutral" : "target",
      caption: `${Math.round(sim.pTarget * sim.replays).toLocaleString("ko-KR")}회`,
    },
    {
      key: "stop",
      label: "손절가 먼저 도달",
      value: sim.pStop,
      text: p3.stop,
      color: "stop",
      caption: `${Math.round(sim.pStop * sim.replays).toLocaleString("ko-KR")}회`,
    },
    {
      key: "neither",
      label: "장 마감까지 미도달",
      value: sim.pNeither,
      text: p3.neither,
      color: "neutral",
      caption: `${Math.round(sim.pNeither * sim.replays).toLocaleString("ko-KR")}회`,
    },
  ];
  return (
    <div className="result-block" aria-live="polite">
      <div className="result-head">
        <h3>1만 번 모의 재생 결과</h3>
        <span className="muted small">
          {sim.replays.toLocaleString("ko-KR")}회 · 시드 {sim.seed} · 남은 봉 {sim.barsLeft}개 ·{" "}
          {sim.ms.toFixed(0)}ms
        </span>
      </div>
      {dataset && (
        <p className="result-basis">
          <span className="result-basis-tag">데이터</span> {basisLine(dataset)}
        </p>
      )}
      <div className="cards3">
        {items.map((it) => (
          <div key={it.key} className={`stat-card stat-${it.color}`}>
            <span className="stat-label">{it.label}</span>
            <strong className="stat-value">{it.text}</strong>
            <span className="stat-caption">{it.caption}</span>
          </div>
        ))}
      </div>
      {extreme === true && (
        <p className="muted small extreme-note" data-testid="cards-extreme-note">
          {EXTREME_POSITIVE_NOTE}
        </p>
      )}
      <div className="insight-row">
        <div>
          <span className="insight-label">
            이익 마감률 <strong>(목표 도달 + 종가 유리 마감)</strong>
          </span>
          <strong className={positive} data-testid="green-close-rate">
            {green.total}
          </strong>
          <span className="muted small">
            {" "}
            (목표 도달 {green.target} + 목표 미도달이나 종가만 유리 {green.extra})
          </span>
        </div>
        <div data-testid="avg-r-row">
          <span className="insight-label">평균 결과</span>
          <strong className={avgRToneName} data-testid="avg-r-value">
            {formatR(sim.avgR)}
          </strong>
          <span className="muted small"> / 1회당</span>
          {extreme === true && (
            <span className="muted small extreme-note" data-testid="avg-r-extreme-note">
              {" "}
              · {EXTREME_AVG_R_NOTE}
            </span>
          )}
        </div>
        <div>
          <span className="insight-label">종료가 중앙값</span>
          <strong>{fmt(sim.medianClose)}</strong>
          <span className="muted small">
            {" "}
            (5~95% {fmt(sim.p5Close)} ~ {fmt(sim.p95Close)})
          </span>
        </div>
      </div>
    </div>
  );
}
