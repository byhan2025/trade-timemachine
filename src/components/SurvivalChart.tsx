import { useEffect, useRef, useState } from "react";
import type { SurvivalResult } from "../lib/survival";
import { axisLabels, formatPctValue, isFlatSpan, moneyLabel } from "../lib/format";
import { SURVIVAL_LABELS } from "../lib/terms";
import { survivalFlatNote, survivalIndexText } from "../lib/easy";

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
 * 📉 20번 연속 매매 생존 — '100명 중 내 돈은 몇 등인가'로 읽는 그래프 (v2.2).
 * 가운데 선 = 딱 중간 50등, 위·아래 선 = 운이 좋았던 상위 10등 / 운이 나빴던 하위 10등.
 * 변동이 0.1% 미만이면 축 눈금이 `100 · 100 · 100`으로 겹치므로 소수 둘째 자리까지 적고
 * '변동 거의 없음' 안내를 붙인다.
 */
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
  const padL = compact ? 46 : 54;
  const padR = compact ? 8 : 12;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const all = [...survival.p10, ...survival.p90, 100];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min;
  /** 변동이 0.1% 미만 — 축 눈금이 겹치므로 소수 둘째 자리로 적고 안내를 붙인다 */
  const flat = isFlatSpan(min, max);
  const growth = Math.max(span, 1);
  const lo = min - growth * 0.08;
  const hi = max + growth * 0.08;
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
  const yLabels = axisLabels(yTicks);
  const xTicks = [0, 5, 10, 15, survival.trades].filter((v) => v <= survival.trades);
  /** 정수 주 내림 때문에 계획보다 아주 조금 작아진 경우(현금 한도와 구분해 적는다) */
  const roundingOnly = !cashLimited && Math.abs(riskPct - planRiskPct) > 1e-9;
  const idx = (v: number) => survivalIndexText(v, flat);

  return (
    <div ref={ref} className="chart-wrap survival" data-testid="survival-chart">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${survival.trades}번 연속 매매 후 100명 중 자금 순위. ${SURVIVAL_LABELS.mid} ${idx(
          survival.finalMedianIdx
        )}, ${SURVIVAL_LABELS.low} ${idx(survival.finalP10Idx)}, ${SURVIVAL_LABELS.high} ${idx(
          survival.finalP90Idx
        )}.`}
      >
        <title>{survival.trades}번 연속 매매 자금 순위</title>
        <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#eef2f8" strokeWidth={1} />
            <text x={padL - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#5b6676">
              {yLabels[i]}
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
        <text x={padL + 3} y={y(100) - 4} fontSize={9} fill="#475569">
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
            fill="#5b6676"
            textAnchor={t === 0 ? "start" : t === survival.trades ? "end" : "middle"}
          >
            {t}회
          </text>
        ))}
        <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1} />
      </svg>
      <p className="chart-note" data-testid="survival-scale-note">
        20번을 마친 뒤 남은 돈을 100명 순서로 줄 세운 값이에요(시작 = 100).{" "}
        {flat
          ? `${survivalFlatNote(min, max)} — 그래프가 거의 평평해요.`
          : `그래프 세로축은 ${min.toFixed(1)}에서 ${max.toFixed(1)} 사이예요.`}
      </p>
      <ul className="chart-legend">
        <li>
          <span className="swatch" style={{ background: "#93c5fd" }} /> {SURVIVAL_LABELS.high}
        </li>
        <li>
          <span className="swatch swatch-median" /> {SURVIVAL_LABELS.mid}
        </li>
        <li>
          <span className="swatch" style={{ background: "#fca5a5" }} /> {SURVIVAL_LABELS.low}
        </li>
      </ul>

      <div className="survival-stats">
        <div>
          <span className="stat-label">{SURVIVAL_LABELS.mid}</span>
          <strong>
            {idx(survival.finalMedianIdx)}
            <span className="muted small"> / 100</span>
          </strong>
          <span className="muted small">{moneyLabel(survival.finalMedian, unit)}</span>
        </div>
        <div>
          <span className="stat-label">{SURVIVAL_LABELS.low}</span>
          <strong className="neg">
            {idx(survival.finalP10Idx)}
            <span className="muted small"> / 100</span>
          </strong>
          <span className="muted small">{moneyLabel(survival.finalP10, unit)}</span>
        </div>
        <div>
          <span className="stat-label">{SURVIVAL_LABELS.high}</span>
          <strong className="pos">
            {idx(survival.finalP90Idx)}
            <span className="muted small"> / 100</span>
          </strong>
          <span className="muted small">{moneyLabel(survival.finalP90, unit)}</span>
        </div>
        <div>
          <span className="stat-label">연달아 지는 최대 횟수</span>
          <strong>{survival.maxStreakP95}회</strong>
          <span className="muted small">
            가운데 {survival.maxStreakMedian}회 · 최악 {survival.maxStreakMax}회
          </span>
        </div>
        <div data-testid="survival-one-r">
          <span className="stat-label">1번에 거는 돈</span>
          <strong>{moneyLabel(oneR, unit)}</strong>
          <span className="muted small">
            손절되면 이만큼 잃어요 · 계좌의 {formatPctValue(riskPct, 2)}
            {cashLimited
              ? ` · 계좌 현금 한도로 계획 ${formatPctValue(planRiskPct, 2)}보다 작아짐`
              : roundingOnly
                ? ` · 계획 ${formatPctValue(planRiskPct, 2)}에서 정수 주 내림`
                : ""}
          </span>
        </div>
      </div>
      <p className="footnote" data-testid="survival-footnote">
        계좌 {moneyLabel(account, unit)}에서 매매마다 현재 자금의 {formatPctValue(riskPct, 2)}(1번에{" "}
        {moneyLabel(oneR, unit)})만큼만 걸고(복리) {survival.trades}회를 반복한{" "}
        {survival.scenarios.toLocaleString("ko-KR")}개 시나리오예요.
        {cashLimited && (
          <>
            {" "}
            <strong>
              수량 카드에서 계좌 현금 한도가 먼저 걸려 실제로 거는 돈이 계획한 허용 손실(
              {formatPctValue(planRiskPct, 2)} = {moneyLabel((account * planRiskPct) / 100, unit)})보다
              작습니다. 그래서 이 그래프도 계획 위험률을 그대로 쓰지 않고, 수량 카드의 실제 위험률(
              {formatPctValue(riskPct, 2)})로 계산했습니다.
            </strong>
          </>
        )}{" "}
        20번 뒤 시작 자금보다 적을 확률은 {(survival.belowStartProb * 100).toFixed(0)}%예요. 미래 수익
        예측이 아니라 분포 가정에 따른 참고치입니다.
      </p>
    </div>
  );
}
