import { useEffect, useRef, useState } from "react";
import type { Thermometer } from "../lib/thermometer";
import { formatMultiple, formatPctValue } from "../lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 640);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * 🌡️ 하루 흔들림 온도계 (v2.2 쉬운 말 버전)
 * - 위: 보통 하루 출렁임(평균 일중 고저폭) vs 내 손절폭 게이지 — 큰 글자로 바로 읽히게
 * - 아래(접이식): 날짜별 흔들림 막대 + 상세 수치 (정확성은 그대로 남긴다)
 * 고저폭은 위아래로 움직인 전체 범위라 '±'를 붙이지 않는다(방향을 구분하지 않음).
 */
export function ThermometerView({ thermo }: { thermo: Thermometer }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const compact = width < 520;
  const W = Math.max(280, width);
  const H = compact ? 138 : 158;
  const padL = compact ? 34 : 40;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxY = Math.max(thermo.maxRangePct, thermo.stopPct * 100, 0.1) * 1.12;
  const bars = thermo.ranges;
  const step = bars.length ? plotW / bars.length : plotW;
  const barW = Math.max(1.5, Math.min(14, step * 0.72));
  const y = (v: number) => padT + plotH - (v / maxY) * plotH;
  const stopLine = thermo.stopPct * 100;
  const stopY = y(stopLine);

  const hasRemain = thermo.remainMedianPct > 0;
  const gaugeMax =
    Math.max(thermo.avgRangePct, hasRemain ? thermo.remainMedianPct : 0, stopLine) * 1.18 || 1;
  const avgW = Math.min(100, (thermo.avgRangePct / gaugeMax) * 100);
  const remainW = Math.min(100, (thermo.remainMedianPct / gaugeMax) * 100);
  const stopW = Math.min(100, (stopLine / gaugeMax) * 100);
  /** 하루 흔들림이 내 손절의 몇 배인지 (손절이 좁을수록 1보다 크다) */
  const dayVsStop = stopLine > 0 ? thermo.avgRangePct / stopLine : 0;

  return (
    <div className="thermo" data-testid="thermometer">
      <div className="thermo-gauge">
        <div className="thermo-row">
          <span className="thermo-row-label">보통 하루에 이만큼 출렁여요</span>
          <div className="thermo-track">
            <span className="thermo-fill avg" style={{ width: `${avgW}%` }} />
          </div>
          <strong className="thermo-row-value">{formatPctValue(thermo.avgRangePct, 2)}</strong>
        </div>
        {hasRemain && (
          <div className="thermo-row">
            <span className="thermo-row-label">진입하고 남은 {thermo.remainBars}봉은 이만큼</span>
            <div className="thermo-track">
              <span className="thermo-fill remain" style={{ width: `${remainW}%` }} />
            </div>
            <strong className="thermo-row-value">{formatPctValue(thermo.remainMedianPct, 2)}</strong>
          </div>
        )}
        <div className="thermo-row">
          <span className="thermo-row-label">내 손절폭</span>
          <div className="thermo-track">
            <span className="thermo-fill stop" style={{ width: `${stopW}%` }} />
          </div>
          <strong className="thermo-row-value">{formatPctValue(stopLine, 2)}</strong>
        </div>
        <p className="thermo-ratio">
          {dayVsStop > 0 && (
            <span className={`thermo-badge ${thermo.band}`} data-testid="thermo-day-badge">
              하루 흔들림이 내 손절의 {formatMultiple(dayVsStop)}배
            </span>
          )}
          {hasRemain && (
            <span className="thermo-badge light" data-testid="thermo-remain-badge">
              남은 구간이 내 손절의 {formatMultiple(thermo.remainMultipleStop)}배
            </span>
          )}
          <span className="muted small">
            {thermo.exceededSessions === 0
              ? `최근 ${thermo.sessions}일 중 내 손절폭보다 크게 움직인 날은 없었어요.`
              : thermo.exceededSessions >= thermo.sessions
                ? `최근 ${thermo.sessions}일 모두 내 손절폭보다 크게 움직였어요.`
                : `최근 ${thermo.sessions}일 중 ${thermo.exceededSessions}일(${(
                    thermo.exceededPct * 100
                  ).toFixed(0)}%)은 내 손절폭보다 크게 움직였어요.`}
          </span>
        </p>
      </div>

      <details className="chart-details">
        <summary>날짜별 흔들림 막대와 숫자 자세히 보기</summary>
        <div ref={ref} className="chart-wrap thermo-chart">
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`최근 ${thermo.sessions}일 하루 흔들림 막대. 보통 하루 ${formatPctValue(
              thermo.avgRangePct,
              2
            )}, 내 손절 ${formatPctValue(stopLine, 2)}.`}
          >
            <title>날짜별 하루 흔들림과 내 손절폭</title>
            <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
            {[0, 0.5, 1].map((f) => {
              const v = maxY * f;
              return (
                <g key={f}>
                  <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#eef2f8" strokeWidth={1} />
                  <text x={padL - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#7b8799">
                    {v.toFixed(1)}%
                  </text>
                </g>
              );
            })}
            {bars.map((b, i) => {
              const over = b.rangePct > stopLine;
              const top = y(b.rangePct);
              return (
                <rect
                  key={b.date}
                  x={padL + i * step + (step - barW) / 2}
                  y={top}
                  width={barW}
                  height={Math.max(0.8, padT + plotH - top)}
                  rx={1.4}
                  fill={over ? "#fca5a5" : "#bfd7fe"}
                />
              );
            })}
            <line
              x1={padL}
              x2={W - padR}
              y1={stopY}
              y2={stopY}
              stroke="#dc2626"
              strokeWidth={1.8}
              strokeDasharray="6 4"
            />
            <line
              x1={padL}
              x2={padL}
              y1={padT}
              y2={padT + plotH}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
            {bars.length > 0 && (
              <>
                <text x={padL} y={H - 8} fontSize={9} fill="#7b8799">
                  {bars[0].date.slice(5)}
                </text>
                <text x={W - padR} y={H - 8} fontSize={9} fill="#7b8799" textAnchor="end">
                  {bars[bars.length - 1].date.slice(5)}
                </text>
              </>
            )}
          </svg>
          <ul className="chart-legend thermo-legend">
            <li>
              <span className="swatch" style={{ background: "#fca5a5" }} /> 손절폭보다 크게 움직인 날{" "}
              {thermo.exceededSessions}일
            </li>
            <li>
              <span className="swatch" style={{ background: "#bfd7fe" }} /> 그 이하{" "}
              {Math.max(0, thermo.sessions - thermo.exceededSessions)}일
            </li>
            <li>
              <span className="swatch" style={{ background: "#dc2626" }} /> 내 손절{" "}
              {formatPctValue(stopLine, 2)}
            </li>
          </ul>
        </div>

        <p className="thermo-headline">{thermo.headline}</p>
        <p className="thermo-verdict">{thermo.verdict}</p>
        <ul className="thermo-facts" data-testid="thermo-facts">
          <li>가운데 날의 하루 흔들림 {formatPctValue(thermo.medianRangePct, 2)}</li>
          <li>
            가장 조용한 날 {formatPctValue(thermo.minRangePct, 2)} · 가장 많이 움직인 날{" "}
            {formatPctValue(thermo.maxRangePct, 2)}
          </li>
          <li>5분봉 한 개 평균 흔들림 {formatPctValue(thermo.avgBarRangePct, 2)}</li>
          {hasRemain && (
            <li data-testid="thermo-remain-fact">
              진입 후 남은 {thermo.remainBars}봉 흔들림 가운데 {formatPctValue(thermo.remainMedianPct, 2)}{" "}
              (내 손절의 {formatMultiple(thermo.remainMultipleStop)}배 · 손절 ÷ 남은 구간 ={" "}
              {formatMultiple(thermo.remainRatio)}배)
            </li>
          )}
        </ul>
        <p className="footnote thermo-caveat" data-testid="thermo-caveat">
          하루 흔들림은 그날 가장 높은 가격과 가장 낮은 가격 사이의 전체 폭이에요. 위로 갔는지 아래로
          갔는지(방향)와 진입 후 어떤 길로 움직였는지는 구분하지 않으니, 손절이 걸릴 수 있는지 보는
          참고 지표로만 보세요.
          <br />
          <strong>하루 흔들림 = (그날 고가 − 그날 저가) ÷ 그날 첫 봉 시가 × 100%</strong>
          <br />
          권유가 아닌 과거 변동폭 비교 참고치입니다.
        </p>
      </details>
    </div>
  );
}
