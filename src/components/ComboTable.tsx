import { useMemo, useState } from "react";
import type { ComboCell, ComboResult } from "../lib/combos";
import { formatPct, formatPrice } from "../lib/format";

export type ComboMode = "winrate" | "rr";

interface Props {
  result: ComboResult | null;
  loading: boolean;
  unit: string;
  mode: ComboMode;
  onMode: (m: ComboMode) => void;
}

const MODES: { key: ComboMode; label: string; hint: string }[] = [
  { key: "winrate", label: "승률 우선형", hint: "자주 이기는 구조" },
  { key: "rr", label: "손익비 추구형", hint: "크게 먹는 구조" },
];

/**
 * 🎯 9조합 비교표: 손절 3단계 × 목표 3단계(1R·1.5R·2R).
 * 성향 토글에 따라 '승률 최고' 또는 '평균 R 최고' 조합을 표시한다(추천가 아님).
 */
export function ComboTable({ result, loading, unit, mode, onMode }: Props) {
  const [picked, setPicked] = useState<string | null>(null);

  const bestKey = useMemo(() => {
    if (!result || !result.cells.length) return null;
    const score = (c: ComboCell) => (mode === "winrate" ? c.pGreen : c.avgR);
    let best = result.cells[0];
    for (const c of result.cells) if (score(c) > score(best)) best = c;
    return cellKey(best);
  }, [result, mode]);

  const pickedCell =
    (picked && result?.cells.find((c) => cellKey(c) === picked)) || null;
  const bestCell = bestKey ? (result?.cells.find((c) => cellKey(c) === bestKey) ?? null) : null;

  if (loading) {
    return (
      <div className="combo-wrap" data-testid="combo-table" aria-busy="true">
        <p className="combo-loading">
          <span className="spinner" aria-hidden="true" /> 손절 3 × 목표 3 = 9가지 조합을 재생하는
          중…
        </p>
      </div>
    );
  }
  if (!result) return null;

  const rows = result.levels;

  return (
    <div className="combo-wrap" data-testid="combo-table">
      <div className="combo-toolbar">
        <div className="seg combo-seg" role="group" aria-label="성향 선택">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={mode === m.key ? "seg-btn active" : "seg-btn"}
              aria-pressed={mode === m.key}
              onClick={() => onMode(m.key)}
              data-testid={`combo-mode-${m.key}`}
            >
              {m.label}
              <span className="combo-mode-hint">{m.hint}</span>
            </button>
          ))}
        </div>
        <span className="muted small combo-meta">
          9조합 × {result.replays.toLocaleString("ko-KR")}회 · {result.ms.toFixed(0)}ms
        </span>
      </div>

      <div className="combo-grid" role="table" aria-label="손절·목표 9조합 비교표">
        <div className="combo-grid-head" role="row">
          <span role="columnheader" className="combo-corner">
            손절폭
          </span>
          {result.targetRs.map((r) => (
            <span key={r} role="columnheader" className="combo-col-head">
              목표 {r}R
            </span>
          ))}
        </div>
        {rows.map((level) => (
          <div key={level.stopPct} className="combo-grid-row" role="row">
            <span role="rowheader" className="combo-row-head">
              <strong>{(level.stopPct * 100).toFixed(2)}%</strong>
              <span className="muted small">{formatPrice(level.stop, unit)}</span>
            </span>
            {result.targetRs.map((targetR) => {
              const cell = result.cells.find(
                (c) => c.stopPct === level.stopPct && c.targetR === targetR
              );
              if (!cell) return <span key={targetR} />;
              const key = cellKey(cell);
              const best = key === bestKey;
              const selected = key === picked;
              return (
                <button
                  key={targetR}
                  type="button"
                  role="cell"
                  className={`combo-cell${best ? " best" : ""}${selected ? " picked" : ""}`}
                  onClick={() => setPicked(key)}
                  aria-pressed={selected}
                  data-testid="combo-cell"
                  title={`손절 ${formatPrice(cell.stop, unit)} · 목표 ${formatPrice(
                    cell.target,
                    unit
                  )} · 승률 ${formatPct(cell.pGreen)} · 평균 R ${cell.avgR.toFixed(2)}`}
                >
                  {best && <span className="combo-best-star" aria-hidden="true">★</span>}
                  <strong>{formatPct(cell.pGreen)}</strong>
                  <span className={cell.avgR >= 0 ? "pos" : "neg"}>
                    {cell.avgR >= 0 ? "+" : "−"}
                    {Math.abs(cell.avgR).toFixed(2)}R
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {bestCell && (
        <p className="combo-best-line">
          <span className="badge">{mode === "winrate" ? "승률 최고" : "평균 R 최고"}</span> 손절{" "}
          {(bestCell.stopPct * 100).toFixed(2)}% ({formatPrice(bestCell.stop, unit)}) · 목표{" "}
          {bestCell.targetR}R · 이익 마감 {formatPct(bestCell.pGreen)} · 평균{" "}
          {bestCell.avgR.toFixed(2)}R
        </p>
      )}

      <p className="combo-detail" role="status">
        {pickedCell ? (
          <>
            선택한 조합 · 손절 <strong>{formatPrice(pickedCell.stop, unit)}</strong>(
            {(pickedCell.stopPct * 100).toFixed(2)}%) · 목표{" "}
            <strong>{formatPrice(pickedCell.target, unit)}</strong>({pickedCell.targetR}R) · 이익 마감{" "}
            {formatPct(pickedCell.pGreen)} · 목표 도달 {formatPct(pickedCell.pTarget)} · 손절{" "}
            {formatPct(pickedCell.pStop)} · 평균 {pickedCell.avgR.toFixed(2)}R
          </>
        ) : (
          <>
            칸을 누르면 손절가·목표가까지 표시됩니다. 각 칸은 <strong>이익 마감 비율</strong>(승률)과{" "}
            <strong>1회 평균 R</strong>입니다. {mode === "winrate"
              ? "승률이 가장 높은 칸"
              : "평균 R이 가장 높은 칸"}
            에 표시가 붙습니다.
          </>
        )}
      </p>
      <p className="footnote">
        성향에 맞는 구간을 골라 주는 <strong>과거 통계 비교</strong>이며 추천가·매수 신호가
        아닙니다. 손절이 넓을수록 승률은 오르지만 1회 손실 금액도 커집니다.
      </p>
    </div>
  );
}

function cellKey(c: ComboCell): string {
  return `${c.stopPct.toFixed(6)}|${c.targetR}`;
}
