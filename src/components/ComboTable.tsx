import { useMemo, useState } from "react";
import type { ComboCell, ComboResult } from "../lib/combos";
import { pickBestCell } from "../lib/combos";
import { formatPct, formatPrice, formatR } from "../lib/format";
import {
  COMBO_MODES,
  GREEN_LABEL,
  bestBadgeText,
  comboModeHint,
  type ComboMode,
} from "../lib/terms";

interface Props {
  result: ComboResult | null;
  loading: boolean;
  unit: string;
  mode: ComboMode;
  onMode: (m: ComboMode) => void;
}

/**
 * 🎯 손절·목표 조합 비교표: 손절 3단계 × 목표 3단계(1R·1.5R·2R).
 * 손절가가 호가 단위에서 겹쳐 중복 제거되면 실제 계산된 조합 수를 그대로 표기한다(9조합 고정 아님).
 * 성향 토글 이름은 실제 선택 기준과 1:1로 맞춘다 — '이익 마감률' 최고 또는 '평균 R(기댓값)' 최고.
 */
export function ComboTable({ result, loading, unit, mode, onMode }: Props) {
  const [picked, setPicked] = useState<string | null>(null);

  const bestKey = useMemo(() => {
    if (!result) return null;
    const best = pickBestCell(result.cells, mode);
    return best ? cellKey(best) : null;
  }, [result, mode]);

  const pickedCell =
    (picked && result?.cells.find((c) => cellKey(c) === picked)) || null;
  const bestCell = bestKey ? (result?.cells.find((c) => cellKey(c) === bestKey) ?? null) : null;
  /** 실제로 계산된 고유 조합 수 — 손절가 중복 제거 뒤에는 9보다 작을 수 있다 */
  const validCount = result?.cells.length ?? 0;
  /** 조합 수만큼 모두 평균 R이 0 미만이면 ★·'최고' 배지가 추천처럼 읽히지 않게 중립 표기한다 */
  const allNegative = validCount > 0 && result!.cells.every((c) => c.avgR < 0);
  const bestBadge = bestBadgeText(mode, allNegative);

  if (loading) {
    return (
      <div className="combo-wrap" data-testid="combo-table" aria-busy="true">
        <p className="combo-loading">
          <span className="spinner" aria-hidden="true" /> 손절·목표 조합을 재생하는 중…
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
          {COMBO_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={mode === m.key ? "seg-btn active" : "seg-btn"}
              aria-pressed={mode === m.key}
              onClick={() => onMode(m.key)}
              data-testid={`combo-mode-${m.key}`}
              title={m.hint}
            >
              {m.label}
              <span className="combo-mode-hint">{m.hint}</span>
            </button>
          ))}
        </div>
        <span className="muted small combo-meta" data-testid="combo-count">
          {validCount}개 조합 × {result.replays.toLocaleString("ko-KR")}회 · {result.ms.toFixed(0)}ms
        </span>
      </div>
      <p className="combo-mode-note" data-testid="combo-mode-note">
        지금 기준: <strong>{comboModeHint(mode)}</strong>을 표시합니다. 추천이 아니라 이름 그대로의
        계산 기준입니다.
      </p>

      {allNegative && (
        <p className="alert warn small combo-all-negative" role="status" data-testid="combo-all-negative">
          참고: 이 조건에서는 {validCount}개 조합 모두 평균 R이 0 미만(마이너스)입니다.
        </p>
      )}

      <div className="combo-grid" role="table" aria-label={`손절·목표 ${validCount}개 조합 비교표`}>
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
              <strong>{formatPct(level.stopPct, 2)}</strong>
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
                  )} · ${GREEN_LABEL} ${formatPct(cell.pGreen)} · 평균 R ${cell.avgR.toFixed(2)}`}
                >
                  {best && !allNegative && (
                    <span className="combo-best-star" aria-hidden="true">
                      ★
                    </span>
                  )}
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
        <p className="combo-best-line" data-testid="combo-best-line">
          <span className={`badge${allNegative ? " light" : ""}`}>{bestBadge}</span> 손절{" "}
          {formatPct(bestCell.stopPct, 2)} ({formatPrice(bestCell.stop, unit)}) · 목표{" "}
          {bestCell.targetR}R · {GREEN_LABEL} {formatPct(bestCell.pGreen)} · 평균{" "}
          {formatR(bestCell.avgR)}
        </p>
      )}

      <p className="combo-detail" role="status">
        {pickedCell ? (
          <>
            선택한 조합 · 손절 <strong>{formatPrice(pickedCell.stop, unit)}</strong>(
            {formatPct(pickedCell.stopPct, 2)}) · 목표{" "}
            <strong>{formatPrice(pickedCell.target, unit)}</strong>({pickedCell.targetR}R) ·{" "}
            {GREEN_LABEL} {formatPct(pickedCell.pGreen)} · 목표 도달 {formatPct(pickedCell.pTarget)} ·
            손절 {formatPct(pickedCell.pStop)} · 평균 {formatR(pickedCell.avgR)}
          </>
        ) : (
          <>
            칸을 누르면 손절가·목표가까지 표시됩니다. 각 칸의 큰 값은{" "}
            <strong>{GREEN_LABEL}</strong>(목표 도달 + 목표 미도달 유리 마감)이고, 작은 값은{" "}
            <strong>1회 평균 R</strong>입니다. 목표 도달률만 보려면 칸을 눌러 아래 줄의 &ldquo;목표
            도달&rdquo;을 보세요. <strong>{bestBadge}</strong> 배지가 붙은 칸이 표 아래에 한 줄로 요약되며(파란
            테두리), 회색으로 채워진 칸은 방금 누른 칸입니다.{" "}
            <span className="muted small">({comboModeHint(mode)})</span>
          </>
        )}
      </p>
      <p className="footnote">
        설정한 조건별로 과거 통계를 비교한 참고표이며 추천가·매수 신호가 아닙니다. 손절 폭과 목표
        배수에 따라 {GREEN_LABEL}과 1회 손실 금액이 달라집니다.
      </p>
    </div>
  );
}

function cellKey(c: ComboCell): string {
  return `${c.stopPct.toFixed(6)}|${c.targetR}`;
}
