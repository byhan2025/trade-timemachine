import { useEffect, useMemo, useState } from "react";
import type { RunResult } from "../lib/run";
import { buildPool } from "../lib/pool";
import { buildThermometer } from "../lib/thermometer";
import { buildStopLevels, compareCombos } from "../lib/combos";
import type { ComboResult } from "../lib/combos";
import { simulateSurvival } from "../lib/survival";
import { summaryLines, avgRBreakdown } from "../lib/summary";
import { formatPct, formatPrice, formatR, moneyLabel } from "../lib/format";
import {
  GREEN_BREAKDOWN,
  GREEN_LABEL,
  RISK_FORMULA_ABS,
  greenGloss,
  rGloss,
  type ComboMode,
} from "../lib/terms";
import { EXTREME_STOP_RATIO } from "../lib/sizing";
import { ThermometerView } from "./Thermometer";
import { ComboTable } from "./ComboTable";
import { SurvivalChart } from "./SurvivalChart";

interface Props {
  run: RunResult;
  stale: boolean;
  onBack: () => void;
}

export function ReportView({ run, stale, onBack }: Props) {
  const unit = run.dataset.priceUnit;
  /** 방향과 무관한 손절폭 크기 (1R = |진입가 − 손절가|) */
  const stopPct = Math.abs(run.plan.entry - run.plan.stop) / run.plan.entry;

  const thermo = useMemo(
    () => buildThermometer(run.dataset, stopPct, run.plan.entryBar),
    [run.dataset, stopPct, run.plan.entryBar]
  );

  const levels = useMemo(
    () => buildStopLevels(run.plan.entry, stopPct, unit, run.plan.side),
    [run.plan.entry, run.plan.side, stopPct, unit]
  );

  const [mode, setMode] = useState<ComboMode>("green");
  const [combos, setCombos] = useState<ComboResult | null>(null);
  const [combosBusy, setCombosBusy] = useState(true);

  useEffect(() => {
    setCombosBusy(true);
    setCombos(null);
    const id = window.setTimeout(() => {
      try {
        const pool = buildPool(run.dataset.sessions, run.dataset.times.length);
        if (pool.sessions < 3 || levels.length === 0) {
          setCombos(null);
        } else {
          setCombos(
            compareCombos({
              pool,
              entry: run.plan.entry,
              side: run.plan.side,
              entryBar: run.plan.entryBar,
              levels,
              replays: 2500,
              unit,
            })
          );
        }
      } catch {
        setCombos(null);
      } finally {
        setCombosBusy(false);
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [run.signature, run.dataset, run.plan.entry, run.plan.side, run.plan.entryBar, levels]);

  /** 수량 카드의 실제 유효 위험률 — 현금 상한으로 수량이 줄면 계획 1%가 아니라 실제 1R을 쓴다 */
  const effectiveRiskPct =
    run.size.shares > 0 ? run.size.effectiveRiskPct : run.plan.riskPct;

  const survival = useMemo(() => {
    const samples = run.sim.rSamples;
    if (!samples || !samples.length) return null;
    return simulateSurvival({
      rSamples: samples,
      trades: 20,
      riskPct: effectiveRiskPct,
      startEquity: run.plan.account,
      scenarios: 4000,
      seed: 19,
    });
  }, [run.sim, effectiveRiskPct, run.plan.account]);

  const lines = summaryLines({
    sim: run.sim,
    target: run.plan.target,
    stop: run.plan.stop,
    rr: run.size.rr,
    unit,
  });
  const breakdown = avgRBreakdown(run.sim);
  /** 계산된(또는 계산될) 고유 조합 수 — 손절가 호가 단위 중복 제거로 9보다 작을 수 있다 */
  const comboCount = combos ? combos.cells.length : levels.length * 3;
  /** 손절폭이 진입가의 0.01% 미만이면 가격·퍼센트가 반올림으로 뭉개지지 않게 따로 알린다 */
  const extremeStop = stopPct > 0 && stopPct < EXTREME_STOP_RATIO;

  return (
    <div className="report" data-testid="report">
      <div className="report-head">
        <div>
          <p className="report-kicker">2. 최종 해석 리포트</p>
          <h2 className="report-title">
            {run.dataset.name} · {run.plan.side === "buy" ? "매수" : "매도"} ·{" "}
            {run.dataset.times[run.plan.entryBar]} 진입
          </h2>
          <p className="muted small" data-testid="report-prices">
            진입 {formatPrice(run.plan.entry, unit)} · 손절 {formatPrice(run.plan.stop, unit)} · 목표{" "}
            {formatPrice(run.plan.target, unit)} · {run.dataset.meta.sessionsUsed}세션{" "}
            {run.dataset.meta.interval} · 기준일 {run.dataset.meta.lastDate}
          </p>
        </div>
        <button type="button" className="btn ghost report-back" onClick={onBack}>
          ← 시뮬레이터로
        </button>
      </div>

      {extremeStop && (
        <p className="alert warn small" role="status" data-testid="extreme-stop-note">
          손절폭이 진입가의 0.01% 미만입니다 — 진입 {formatPrice(run.plan.entry, unit)} / 손절{" "}
          {formatPrice(run.plan.stop, unit)} = {formatPct(stopPct, 2)} (1주당 위험폭{" "}
          {formatPrice(Math.abs(run.plan.entry - run.plan.stop), unit)}). 호가 단위·체결 오차만으로도
          손절이 즉시 걸릴 수 있어, 아래 확률·수량·생존 그래프는 참고용으로만 보세요.
        </p>
      )}

      {stale && (
        <p className="alert warn small" role="status">
          시뮬레이터 입력이 바뀌었습니다. 이 리포트는 지난 실행(위 가격) 기준입니다. 새 값으로 다시
          재생한 뒤 보세요.
        </p>
      )}

      <div className="disclaimer inline" role="note">
        <strong>투자 권유·매수/매도 신호가 아닙니다.</strong> 이 리포트는 방금 나온 과거 봉 재표본
        결과를 쉽게 풀어 쓴 <strong>통계 해석 보조수단</strong>입니다. 미래 수익을 보장하지 않으며
        원금 손실 가능.
      </div>

      <section className="card" aria-labelledby="rep-summary">
        <h3 className="card-title" id="rep-summary">
          1. 한눈에 보는 요약
        </h3>
        <ol className="summary-lines">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
        <div className="summary-stats">
          <div>
            <span className="stat-label">목표 도달</span>
            <strong className="pos">{formatPct(run.sim.pTarget)}</strong>
          </div>
          <div>
            <span className="stat-label">손절 도달</span>
            <strong className="neg">{formatPct(run.sim.pStop)}</strong>
          </div>
          <div>
            <span className="stat-label">{GREEN_LABEL}</span>
            <strong>{formatPct(run.sim.pGreen)}</strong>
            <span className="stat-sub">{GREEN_BREAKDOWN}</span>
          </div>
          <div>
            <span className="stat-label">1회 평균</span>
            <strong className={run.sim.avgR >= 0 ? "pos" : "neg"}>{formatR(run.sim.avgR)}</strong>
            <span className="stat-sub">미도달 포함</span>
          </div>
        </div>
        <p className="term-note" data-testid="avg-r-breakdown">
          1회 평균 {formatR(run.sim.avgR)} = 목표 {formatR(run.sim.rAtTarget)}×
          {formatPct(run.sim.pTarget)} + 손절 −1R×{formatPct(run.sim.pStop)} ={" "}
          {formatR(breakdown.twoValueR)}
          {breakdown.neitherAvgR === null
            ? " (미도달 0%라 그대로 같습니다)."
            : ` + 미도달 ${formatPct(run.sim.pNeither)}×${formatR(breakdown.neitherAvgR)} (장 마감 종가 R).`}
        </p>
        <p className="footnote">
          1만 회 빈도는 미래 확률이 아니라 과거 봉 재표본 모형 결과입니다. 같은 봉 내 손절·목표 동시
          도달 시 손절 우선 처리, 종료가 분포는 이후 장 마감까지 재생한 값입니다.
        </p>
      </section>

      <section className="card" aria-labelledby="rep-thermo">
        <div className="card-head">
          <h3 className="card-title" id="rep-thermo">
            2. 🌡️ 오늘의 흔들림 온도계
          </h3>
          <span className="badge">평균 고저폭 vs 내 손절폭</span>
        </div>
        <p className="card-desc">
          최근 {thermo.sessions}세션의 일중 고저폭(고가−저가 전체 범위) 평균과 내 손절폭을 나란히
          놓고 비교했습니다.
        </p>
        <ThermometerView thermo={thermo} />
      </section>

      <section className="card" aria-labelledby="rep-combos">
        <div className="card-head">
          <h3 className="card-title" id="rep-combos">
            3. 🎯 {comboCount}가지 손절·목표 조합
          </h3>
          <span className="badge">손절 {levels.length} × 목표 3</span>
        </div>
        <p className="card-desc">
          내 진입가 {formatPrice(run.plan.entry, unit)} 기준으로 손절폭을 내 계획의 0.6배·1배·1.5배로
          바꾸고, 목표를 1R·1.5R·2R로 두었을 때의 과거 통계입니다.
        </p>
        {levels.length < 3 && (
          <p className="alert warn small" data-testid="combo-dedup-note">
            손절폭이 너무 좁아 호가 단위에서 0.6배·1배·1.5배가 같은 가격이 되었습니다. 같은 손절가는 한
            번만 계산해 손절 {levels.length}단계 × 목표 3 = {comboCount}개 조합으로 비교합니다.
          </p>
        )}
        <ComboTable
          result={combos}
          loading={combosBusy}
          unit={unit}
          mode={mode}
          onMode={setMode}
        />
        {!combosBusy && !combos && (
          <p className="alert warn small">
            완전한 세션이 3일 미만이라 손절·목표 조합을 계산할 수 없습니다. 더 긴 데이터로 다시 실행해
            주세요.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="rep-survival">
        <div className="card-head">
          <h3 className="card-title" id="rep-survival">
            4. 📉 연속 20회 매매 생존 시뮬레이션
          </h3>
          <span className="badge">복리 · 현재 자금 기준</span>
        </div>
        <p className="card-desc">
          방금 나온 1회 결과 분포(목표·손절·마감 확률과 R값)를 20번 연속 적용했을 때 계좌 자금이
          어디로 가는지 봅니다. 100 = 시작 자금({moneyLabel(run.plan.account, unit)}).{" "}
          {run.size.riskLimitedByCash
            ? "1R은 계획한 허용 손실률이 아니라 수량 카드의 실제 최대 손실 기준입니다."
            : "1R은 수량 카드의 실제 최대 손실 기준입니다."}
        </p>
        {survival ? (
          <SurvivalChart
            survival={survival}
            unit={unit}
            account={run.plan.account}
            riskPct={effectiveRiskPct}
            planRiskPct={run.plan.riskPct}
            cashLimited={run.size.riskLimitedByCash}
            oneR={run.size.maxLoss}
          />
        ) : (
          <p className="alert warn small">
            1회 결과 분포를 읽지 못해 생존 시뮬레이션을 만들 수 없었습니다. 다시 실행해 주세요.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="rep-terms">
        <h3 className="card-title" id="rep-terms">
          5. 쉬운 용어 한 줄 풀이
        </h3>
        <div className="glossary">
          <details>
            <summary>R배수 — 손절폭을 1로 놓고 잰 수익·손실</summary>
            <p data-testid="r-gloss">{rGloss(run.plan.side)}</p>
            <p className="term-note">
              1R = <strong>{RISK_FORMULA_ABS}</strong> = 이번 가정에서는{" "}
              <strong>|{formatPrice(run.plan.entry, unit)} − {formatPrice(run.plan.stop, unit)}|</strong>{" "}
              = {formatPrice(run.size.riskPerShare, unit)}
            </p>
          </details>
          <details>
            <summary>손익비 — 1번 이길 때 버는 것과 1번 질 때 잃는 것의 비율</summary>
            <p>
              1:2면 목표에 닿을 때 2R을 벌고, 손절되면 1R을 잃습니다. 이익 마감률이 40%여도 손익비가
              좋으면 남을 수 있고, 이익 마감률이 70%여도 손익비가 나쁘면 잃을 수 있습니다.
            </p>
          </details>
          <details>
            <summary>중앙값 — 딱 가운데 순서의 결과</summary>
            <p>
              결과를 줄 세웠을 때 한가운데 값입니다. 평균은 큰 값 하나에 끌려가지만 중앙값은
              &ldquo;보통의 결과&rdquo;를 보여줍니다. 그래서 이 리포트는 종료가·자금 궤적을 중앙값으로
              같이 보여줍니다.
            </p>
          </details>
          <details>
            <summary>기댓값 — 같은 계획을 여러 번 했을 때 1회당 평균</summary>
            <p>
              확률 × 이익을 모두 더한 1회 평균입니다. 예: 45%로 +2R, 55%로 −1R이면 기댓값은 0.45×2 −
              0.55×1 = <strong>+0.35R</strong>. 과거 분포 가정일 뿐 미래 보장이 아닙니다. 이 리포트의
              1회 평균은 목표·손절뿐 아니라 미도달(장 마감) 건의 종가 R까지 더한 값입니다.
            </p>
          </details>
          <details>
            <summary>
              이익 마감률 — 목표 도달 + 목표 미도달 유리 마감(목표 도달률과 다름)
            </summary>
            <p data-testid="green-gloss">{greenGloss()}</p>
          </details>
        </div>
      </section>

      <p className="report-foot">
        이 리포트는 개인 연구·참고용 통계 해석이며 매매 판단의 근거가 될 수 없습니다. 같은 입력이면
        같은 결과가 나오도록 고정 시드를 씁니다.
      </p>
    </div>
  );
}
