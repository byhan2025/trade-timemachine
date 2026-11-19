import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SimResult } from "../lib/simulate";
import { formatPriceNumber } from "../lib/format";

interface Props {
  times: string[];
  entryBar: number;
  entry: number;
  stop: number;
  target: number;
  sim: SimResult;
  unit: string;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 720);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * 경로 분포 차트: 과거 봉 분포에서 뽑은 20개 샘플 궤적 + 5~95% / 25~75% 밴드 + 목표/손절선.
 * 세로 범위는 밴드(5~95%)와 목표·손절선을 기준으로 잡고, 그 밖으로 벗어난 궤적은 잘라 그린다.
 */
export function FanChart({ times, entryBar, entry, stop, target, sim, unit }: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const compact = width < 520;
  const clipId = useId().replace(/:/g, "");

  const g = useMemo(() => {
    const steps = sim.barsLeft;
    const W = Math.max(280, width);
    const H = compact ? 246 : 320;
    const padL = compact ? 48 : 62;
    const padR = compact ? 14 : 18;
    const padT = 16;
    const padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let min = Math.min(entry, stop, target);
    let max = Math.max(entry, stop, target);
    for (const b of sim.bands) {
      if (b[0] < min) min = b[0];
      if (b[4] > max) max = b[4];
    }
    const span0 = max - min || max * 0.02 || 1;
    min -= span0 * 0.05;
    max += span0 * 0.05;

    const x = (i: number) => padL + (steps === 0 ? 0 : (i / steps) * plotW);
    const y = (p: number) => padT + ((max - p) / (max - min)) * plotH;
    const path = (pts: number[][]) =>
      pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
    const area = (lo: number[], hi: number[]) => {
      const up = hi.map((v, i) => [x(i), y(v)] as number[]);
      const down = lo
        .map((v, i) => [x(i), y(v)] as number[])
        .reverse();
      return `${path(up)} L${down[0][0].toFixed(2)},${down[0][1].toFixed(2)} ${down
        .slice(1)
        .map(([px, py]) => `L${px.toFixed(2)},${py.toFixed(2)}`)
        .join(" ")} Z`;
    };

    const band5 = sim.bands.map((b) => b[0]);
    const band25 = sim.bands.map((b) => b[1]);
    const band75 = sim.bands.map((b) => b[3]);
    const band95 = sim.bands.map((b) => b[4]);
    const median = sim.bands.map((b) => b[2]);
    const paths = sim.samplePaths.map((p) => path(p.map((v, i) => [x(i), y(v)])));

    const yTickCount = compact ? 3 : 4;
    const yTicks: { v: number; y: number }[] = Array.from({ length: yTickCount }, (_, k) => {
      const v = min + ((max - min) * k) / (yTickCount - 1);
      return { v, y: y(v) };
    });
    const tickCount = compact ? 3 : 5;
    const xTicks: { i: number; x: number; label: string }[] = Array.from({ length: tickCount }, (_, k) => {
      const i = Math.round((steps * k) / (tickCount - 1));
      return { i, x: x(i), label: times[entryBar + i] ?? "" };
    });

    return {
      W, H, padL, padR, padT, padB, plotW, plotH, x, y, path, area,
      band5, band25, band75, band95, median, paths, yTicks, xTicks, steps, min, max,
    };
  }, [width, compact, sim, times, entryBar, entry, stop, target]);

  const levels = [
    { key: "target", label: "목표선", price: target, color: "#16a34a", dash: "7 4", width: 1.6 },
    { key: "entry", label: "진입선", price: entry, color: "#0f172a", dash: "2 3", width: 1.3 },
    { key: "stop", label: "손절선", price: stop, color: "#dc2626", dash: "7 4", width: 1.6 },
  ];

  return (
    <div ref={ref} className="chart-wrap">
      <svg
        width="100%"
        height={g.H}
        viewBox={`0 0 ${g.W} ${g.H}`}
        role="img"
        aria-label={`진입 이후 남은 ${g.steps}개 봉의 경로 분포 차트. 목표가 ${target}, 손절가 ${stop}, 진입가 ${entry}.`}
      >
        <title>경로 분포 차트</title>
        <defs>
          <clipPath id={clipId}>
            <rect x={g.padL} y={g.padT - 2} width={g.plotW} height={g.plotH + 4} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={g.W} height={g.H} fill="#ffffff" />

        {g.yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={g.padL} x2={g.W - g.padR} y1={t.y} y2={t.y} stroke="#e9eff7" strokeWidth={1} />
            <text x={g.padL - 6} y={t.y + 3.5} textAnchor="end" fontSize={compact ? 9 : 10} fill="#7b8799">
              {formatPriceNumber(t.v, unit)}
            </text>
          </g>
        ))}

        <path d={g.area(g.band5, g.band95)} fill="#2563eb" fillOpacity={0.1} />
        <path d={g.area(g.band25, g.band75)} fill="#2563eb" fillOpacity={0.16} />

        <g clipPath={`url(#${clipId})`}>
          {g.paths.map((d, i) => (
            <path key={`p${i}`} d={d} fill="none" stroke="#475569" strokeWidth={0.9} strokeOpacity={0.36} />
          ))}
          <path
            d={g.path(g.median.map((v, i) => [g.x(i), g.y(v)]))}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
          {levels.map((l) => (
            <line
              key={l.key}
              x1={g.padL}
              x2={g.W - g.padR}
              y1={g.y(l.price)}
              y2={g.y(l.price)}
              stroke={l.color}
              strokeWidth={l.width}
              strokeDasharray={l.dash}
              strokeLinecap="round"
            />
          ))}
        </g>

        <line x1={g.padL} x2={g.padL} y1={g.padT} y2={g.padT + g.plotH} stroke="#cbd5e1" strokeWidth={1} />

        {g.xTicks.map((t, i) => (
          <text
            key={`x${i}`}
            x={t.x}
            y={g.H - 8}
            textAnchor={i === 0 ? "start" : i === g.xTicks.length - 1 ? "end" : "middle"}
            fontSize={compact ? 9 : 10}
            fill="#7b8799"
          >
            {t.label}
          </text>
        ))}
      </svg>
      <ul className="chart-legend">
        <li>
          <span className="swatch swatch-path" /> 샘플 궤적 20개
        </li>
        <li>
          <span className="swatch swatch-band" /> 5~95% 밴드
        </li>
        <li>
          <span className="swatch swatch-median" /> 중앙값 경로
        </li>
        {levels.map((l) => (
          <li key={l.key}>
            <span className="swatch" style={{ background: l.color }} /> {l.label}{" "}
            <strong>
              {formatPriceNumber(l.price, unit)}
              {unit === "원" ? "원" : ""}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
