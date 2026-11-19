import type { Dataset } from "../lib/types";
import type { SimResult } from "../lib/simulate";
import { formatPriceNumber, formatR } from "../lib/format";
import { EXTREME_AVG_R_NOTE, avgRTone } from "../lib/easy";

function pctText(x: number): string {
  if (x > 0 && x < 0.0005) return "<0.1%";
  return `${(x * 100).toFixed(1)}%`;
}

/** 세 칸의 표시값 합이 정확히 100.0%가 되도록 최대잔여법으로 반올림 */
function splitHundred(values: number[]): number[] {
  const raw = values.map((v) => v * 1000);
  const floors = raw.map((v) => Math.floor(v));
  const rest = 1000 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = floors.slice();
  for (let k = 0; k < rest && k < order.length * 2; k++) out[order[k % order.length].i] += 1;
  return out;
}

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
  const source = dataset.custom
    ? "직접 입력 데이터"
    : /yahoo/i.test(m.source)
      ? "Yahoo Finance 공개 시세 기준"
      : /naver/i.test(m.source)
        ? "네이버증권 공개 시세 기준"
        : "공개 시세 기준";
  return [
    `기준일 ${m.lastDate}`,
    `수집 ${shortTime(m.fetchedAt)}`,
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
  const fmt = (x: number) => formatPriceNumber(x, unit);
  const tenths = splitHundred([sim.pTarget, sim.pStop, sim.pNeither]);
  const items = [
    {
      key: "target",
      label: "목표가 먼저 도달",
      value: sim.pTarget,
      tenths: tenths[0],
      color: "target",
      caption: `${Math.round(sim.pTarget * sim.replays).toLocaleString("ko-KR")}회`,
    },
    {
      key: "stop",
      label: "손절가 먼저 도달",
      value: sim.pStop,
      tenths: tenths[1],
      color: "stop",
      caption: `${Math.round(sim.pStop * sim.replays).toLocaleString("ko-KR")}회`,
    },
    {
      key: "neither",
      label: "장 마감까지 미도달",
      value: sim.pNeither,
      tenths: tenths[2],
      color: "neutral",
      caption: `${Math.round(sim.pNeither * sim.replays).toLocaleString("ko-KR")}회`,
    },
  ];
  const greenOnly = Math.max(0, sim.pGreen - sim.pTarget);
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
            <strong className="stat-value">
              {it.tenths === 0 && it.value > 0 ? "<0.1%" : `${(it.tenths / 10).toFixed(1)}%`}
            </strong>
            <span className="stat-caption">{it.caption}</span>
          </div>
        ))}
      </div>
      <div className="insight-row">
        <div>
          <span className="insight-label">
            이익 마감률 <strong>(목표 도달 + 종가 유리 마감)</strong>
          </span>
          <strong>{pctText(sim.pGreen)}</strong>
          <span className="muted small">
            {" "}
            (목표 도달 {pctText(sim.pTarget)} + 목표 미도달이나 종가만 유리 {pctText(greenOnly)})
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
