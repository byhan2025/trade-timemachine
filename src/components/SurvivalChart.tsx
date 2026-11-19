import { useEffect, useRef, useState } from "react";
import type { SurvivalResult } from "../lib/survival";
import { formatPctValue, moneyLabel } from "../lib/format";

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

/** 📉 연속 20회 매매 생존 시뮬레이션 — 자금 궤적(중앙값 · 10번째 백분위 · 90번째 백분위) */
export function SurvivalChart({
  survival,
  unit,
  account,
  riskPct,
  planRiskPct,
  cashLimited,
  oneR,
}: {
  survival: SurvivalResult;
  unit: string;
  account: number;
  /** 실제 계산에 쓴 1회 위험률(%) — 수량 카드의 유효 위험률 */
  riskPct: number;
  /** 사용자가 입력한 계획 허용 손실률(%) */
  planRiskPct: number;
  /** 계좌 현금 한도 때문에 수량이 줄어 실제 위험률이 계획보다 작아졌는지 */
  cashLimited: boolean;
  /** 시작 자금 기준 1R 금액(원) */
  oneR: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const compact = width < 520;
  const W = Math.max(280, width);
  const H = compact ? 208 : 244;
  const padL = compact ? 42 : 52;
  const padR = compact ? 8 : 12;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const all = [...survival.p10, ...survival.p90, 100];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;
  const x = (i: number) => padL + (i / Math.max(1, survival.trades)) * plotW;
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH;

  const line = (pts: number[]) =>
    pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");

  const upper = survival.p90.map((v, i) => [x(i), y(v)] as number[]);
  const lower = survival.p10
    .slice()
    .reverse()
    .map((v, i) => [x(survival.trades - i), y(v)] as number[]);
  const bandPath = `${upper
    .concat(lower)
    .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`)
    .join(" ")} Z`;

  const yTicks = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.12];
  const xTicks = [0, 5, 10, 15, survival.trades].filter((v) => v <= survival.trades);
  /** 정수 주 내림 때문에 계획보다 아주 조금 작아진 경우(현금 한도와 구분해 적는다) */
  const roundingOnly = !cashLimited && Math.abs(riskPct - planRiskPct) > 1e-9;

  return (
    <div ref={ref} className="chart-wrap survival" data-testid="survival-chart">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${survival.trades}회 연속 매매 시 자금 궤적. 중앙값 ${survival.finalMedianIdx.toFixed(
          1
        )}%, 10번째 백분위(하위 10% 흐름) ${survival.finalP10Idx.toFixed(1)}%, 90번째 백분위(상위 10% 흐름) ${survival.finalP90Idx.toFixed(1)}%.`}
      >
        <title>{survival.trades}회 연속 매매 자금 궤적</title>
        <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#eef2f8" strokeWidth={1} />
            <text x={padL - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#7b8799">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        <path d={bandPath} fill="#2563eb" fillOpacity={0.14} />
        <line
          x1={padL}
          x2={W - padR}
          y1={y(100)}
          y2={y(100)}
          stroke="#94a3b8"
          strokeWidth={1.2}
          strokeDasharray="4 4"
        />
        <text x={padL + 3} y={y(100) - 4} fontSize={9} fill="#64748b">
          시작 100
        </text>
        <path d={line(survival.p90)} fill="none" stroke="#93c5fd" strokeWidth={1.4} />
        <path d={line(survival.p10)} fill="none" stroke="#fca5a5" strokeWidth={1.4} />
        <path d={line(survival.median)} fill="none" stroke="#1d4ed8" strokeWidth={2.2} />
        {xTicks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 8}
            fontSize={9}
            fill="#7b8799"
            textAnchor={t === 0 ? "start" : t === survival.trades ? "end" : "middle"}
          >
            {t}회
          </text>
        ))}
        <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1} />
      </svg>
      <ul className="chart-legend">
        <li>
          <span className="swatch swatch-median" /> 중앙값
        </li>
        <li>
          <span className="swatch" style={{ background: "#93c5fd" }} /> 90번째 백분위(상위 10% 흐름)
        </li>
        <li>
          <span className="swatch" style={{ background: "#fca5a5" }} /> 10번째 백분위(하위 10% 흐름)
        </li>
      </ul>

      <div className="survival-stats">
        <div>
          <span className="stat-label">{survival.trades}회 후 중앙값</span>
          <strong>
            {survival.finalMedianIdx.toFixed(1)}
            <span className="muted small"> / 100</span>
          </strong>
          <span className="muted small">{moneyLabel(survival.finalMedian, unit)}</span>
        </div>
        <div>
          <span className="stat-label">10번째 백분위(하위 10% 흐름)</span>
          <strong className="neg">
            {survival.finalP10Idx.toFixed(1)}
            <span className="muted small"> / 100</span>
          </strong>
          <span className="muted small">{moneyLabel(survival.finalP10, unit)}</span>
        </div>
        <div>
          <span className="stat-label">90번째 백분위(상위 10% 흐름)</span>
          <strong className="pos">
            {survival.finalP90Idx.toFixed(1)}
            <span className="muted small"> / 100</span>
          </strong>
          <span className="muted small">{moneyLabel(survival.finalP90, unit)}</span>
        </div>
        <div>
          <span className="stat-label">최대 연패</span>
          <strong>{survival.maxStreakP95}회</strong>
          <span className="muted small">
            중앙 {survival.maxStreakMedian}회 · 최악 {survival.maxStreakMax}회
          </span>
        </div>
        <div data-testid="survival-one-r">
          <span className="stat-label">1R 금액 (실제 최대 손실)</span>
          <strong>{moneyLabel(oneR, unit)}</strong>
          <span className="muted small">
            계좌의 {formatPctValue(riskPct, 2)}
            {cashLimited
              ? ` · 계좌 현금 한도로 계획 ${formatPctValue(planRiskPct, 2)}보다 작아짐`
              : roundingOnly
                ? ` · 계획 ${formatPctValue(planRiskPct, 2)}에서 정수 주 내림`
                : ""}
          </span>
        </div>
      </div>
      <p className="footnote" data-testid="survival-footnote">
        계좌 {moneyLabel(account, unit)}에서 매매마다 현재 자금의 {formatPctValue(riskPct, 2)}(1R ={" "}
        {moneyLabel(oneR, unit)})만큼 위험을 걸고(복리) {survival.trades}회를 반복한{" "}
        {survival.scenarios.toLocaleString("ko-KR")}개 시나리오입니다.
        {cashLimited && (
          <>
            {" "}
            <strong>
              수량 카드에서 계좌 현금 한도가 먼저 걸려 실제 1회 최대 손실이 계획한 허용 손실(
              {formatPctValue(planRiskPct, 2)} = {moneyLabel((account * planRiskPct) / 100, unit)})보다
              작습니다. 그래서 이 그래프도 맹목적으로 계획 위험률을 쓰지 않고, 수량 카드의 실제
              위험률({formatPctValue(riskPct, 2)})로 계산했습니다.
            </strong>
          </>
        )}{" "}
        10번째·90번째 백분위는 그 시나리오들의 20회 후 자금을 낮은 순으로 세웠을 때 아래에서 10%,
        위에서 10% 지점(서로 대칭인 하위 10%·상위 10% 흐름)입니다. 20회 후 시작 자금보다 적을 확률{" "}
        {(survival.belowStartProb * 100).toFixed(0)}%. 미래 수익 예측이 아니라 분포 가정에 따른
        참고치입니다.
      </p>
    </div>
  );
}
