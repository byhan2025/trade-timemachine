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
import { easyAvgMultiple, easyProfitCount, easyStopLevelLabel } from "../lib/easy";

interface Props {
  result: ComboResult | null;
  loading: boolean;
  unit: string;
  mode: ComboMode;
  onMode: (m: ComboMode) => void;
  /** 내 계획의 손절폭(비율) — 행 이름 '내 계획의 0.6배'를 만들 때 쓴다 */
  baseStopPct: number;
}

/**
 * 🎯 손절·목표 조합 비교표 (v2.2 쉬운 말 버전).
 * 칸의 큰 글씨 = "100번 중 몇 번 이익으로 끝났는지", 작은 글씨 = "1번에 평균 몇 배 남았는지".
 * 정확한 R·이익 마감률은 title(툴팁)·접이식 상세 줄에 그대로 남긴다.
 * 손절가가 호가 단위에서 겹쳐 중복 제거되면 실제 계산된 조합 수를 그대로 표기한다(9조합 고정 아님).
 */
export function ComboTable({ result, loading, unit, mode, onMode, baseStopPct }: Props) {
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
          참고: 이 조건에서는 {validCount}개 조합 모두 1번 평균이 마이너스(손실)였어요.
        </p>
      )}

      <div className="combo-grid" role="table" aria-label={`손절·목표 ${validCount}개 조합 비교표`}>
        <div className="combo-grid-head" role="row">
          <span role="columnheader" className="combo-corner">
            손절폭
          </span>
          {result.targetRs.map((r) => (
            <span key={r} role="columnheader" className="combo-col-head">
              목표 {r}배
            </span>
          ))}
        </div>
        {rows.map((level) => (
          <div key={level.stopPct} className="combo-grid-row" role="row">
            <span role="rowheader" className="combo-row-head">
              <strong>{easyStopLevelLabel(level.stopPct, baseStopPct)}</strong>
              <span className="muted small">
                {formatPct(level.stopPct, 2)} · {formatPrice(level.stop, unit)}
              </span>
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
                  aria-label={`손절 ${formatPrice(cell.stop, unit)} 목표 ${targetR}배: ${easyProfitCount(
                    cell.pGreen
                  )}, ${easyAvgMultiple(cell.avgR)}`}
                  title={`손절 ${formatPrice(cell.stop, unit)} · 목표 ${formatPrice(
                    cell.target,
                    unit
                  )} · ${GREEN_LABEL} ${formatPct(cell.pGreen)} · 평균 R ${formatR(cell.avgR)}`}
                >
                  {best && !allNegative && (
                    <span className="combo-best-star" aria-hidden="true">
                      ★
                    </span>
                  )}
                  <strong className={cell.pGreen >= 0.5 ? "cell-profit" : "cell-rare"}>
                    {easyProfitCount(cell.pGreen)}
                  </strong>
                  <span className={cell.avgR >= 0 ? "pos" : "neg"}>
                    {easyAvgMultiple(cell.avgR)}
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
          {bestCell.targetR}배 · {easyProfitCount(bestCell.pGreen)} ·{" "}
          {easyAvgMultiple(bestCell.avgR)}
        </p>
      )}

      <p className="combo-detail" role="status">
        {pickedCell ? (
          <>
            고른 칸 · <strong>{easyProfitCount(pickedCell.pGreen)}</strong> ·{" "}
            {easyAvgMultiple(pickedCell.avgR)}
            <span className="muted small">
              {" "}
              (손절 {formatPrice(pickedCell.stop, unit)} {formatPct(pickedCell.stopPct, 2)} · 목표{" "}
              {formatPrice(pickedCell.target, unit)} {pickedCell.targetR}배 · 목표 도달{" "}
              {formatPct(pickedCell.pTarget)} · 손절 {formatPct(pickedCell.pStop)} · 평균 R{" "}
              {formatR(pickedCell.avgR)})
            </span>
          </>
        ) : (
          <>
            칸을 누르면 그 칸의 손절가·목표가까지 보여줘요. 큰 글씨는{" "}
            <strong>100번 중 몇 번 이익으로 끝났는지</strong>, 작은 글씨는{" "}
            <strong>1번에 평균 몇 배 남았는지</strong>예요. 배지가 붙은 칸(파란 테두리)은{" "}
            <strong>{bestBadge}</strong>로 고른 칸이고, 회색으로 채워진 칸은 방금 누른 칸이에요.{" "}
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
