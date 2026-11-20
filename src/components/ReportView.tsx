import { useEffect, useMemo, useState } from "react";
import type { RunResult } from "../lib/run";
import { buildPool } from "../lib/pool";
import { buildThermometer } from "../lib/thermometer";
import { buildStopLevels, compareCombos } from "../lib/combos";
import type { ComboResult } from "../lib/combos";
import { simulateSurvival } from "../lib/survival";
import { formatPct, formatPrice, formatR } from "../lib/format";
import { COMBO_MULTIPLE_NOTE, GREEN_LABEL, easyGlossary } from "../lib/terms";
import type { ComboMode } from "../lib/terms";
import { EXTREME_STOP_RATIO } from "../lib/sizing";
import {
  EXTREME_STOP_REASON,
  avgRTone,
  easyMathDetail,
  easyMoneyChip,
  easyStopLevelLabel,
  easySummary,
  easyThermometerLine,
  greenRatePct,
  pctThree,
  positiveTone,
  trafficBasis,
} from "../lib/easy";
import { ThermometerView } from "./Thermometer";
import { ComboTable } from "./ComboTable";
import { SurvivalChart } from "./SurvivalChart";
import { SizingCard } from "./SizingCard";

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

  /** 수량 카드의 실제 유효 위험률 — 현금 상한으로 수량이 줄면 계획 1%가 아니라 실제 1R을 쓴다.
   *  계산 수량이 0주면 실제로 거는 돈이 없으므로 0(자금 변동 없음)이다(v2.2.1). */
  const effectiveRiskPct = run.size.effectiveRiskPct;

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

  /** 계산된(또는 계산될) 고유 조합 수 — 손절가·목표가 호가 단위 중복 제거로 9보다 작을 수 있다 */
  const comboCount = combos ? combos.cells.filter((c) => c.duplicateOfR === undefined).length : levels.length * 3;
  /** 표에 실제로 쓰인 목표 배수 — 결과가 오기 전에는 요청값을 그대로 보여 준다 */
  const targetRs = combos?.targetRs ?? [1, 1.5, 2];
  /** 행 이름과 같은 말로 손절 단계를 적는다('내 계획의 0.6배·그대로·1.5배') */
  const levelWords = levels.map((l) => easyStopLevelLabel(l.stopPct, stopPct));
  /** 손절폭이 진입가의 0.01% 미만이면 가격·퍼센트가 반올림으로 뭉개지지 않게 따로 알린다 */
  const extremeStop = stopPct > 0 && stopPct < EXTREME_STOP_RATIO;
  /** 극단 입력이면 목표·이익 쪽 숫자의 초록 강조를 끈다 (v2.2.3) */
  const positive = positiveTone(extremeStop);

  const easy = easySummary({
    sim: run.sim,
    oneR: run.size.maxLoss,
    shares: run.size.shares,
    unit,
    side: run.plan.side,
    ratio: thermo.ratio,
    rr: run.size.rr,
    sessions: run.dataset.meta.sessionsUsed,
    extreme: extremeStop,
  });
  const moneyChip = easyMoneyChip({
    avgR: run.sim.avgR,
    oneR: run.size.maxLoss,
    unit,
    shares: run.size.shares,
    extreme: extremeStop,
  });
  const detail = easyMathDetail({ sim: run.sim, oneR: run.size.maxLoss, unit });
  /** 접이식 통계도 배너·카드와 같은 0.1% 표기(합이 100.0%가 되는 문자열)를 쓴다 */
  const statPct = pctThree(run.sim.pTarget, run.sim.pStop, run.sim.pNeither);
  const greenPct = greenRatePct(run.sim.pTarget, run.sim.pGreen);
  const glossary = easyGlossary(run.plan.side);
  const sharesWord = run.plan.side === "buy" ? "사야" : "팔아야";

  return (
    <div className="report" data-testid="report">
      <div className="report-head">
        <div>
          <p className="report-kicker">2. 최종 해석 리포트 · 쉬운 말 버전</p>
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
          {formatPrice(Math.abs(run.plan.entry - run.plan.stop), unit)}). 실제 호가 단위(가격대별로 다름)·체결
          오차만으로도 손절이 즉시 걸릴 수 있어, 아래 확률·수량·생존 그래프는 참고용으로만 보세요.
        </p>
      )}

      {stale && (
        <p className="alert warn small" role="status">
          시뮬레이터 입력이 바뀌었습니다. 이 리포트는 지난 실행(위 가격) 기준입니다. 새 값으로 다시
          재생한 뒤 보세요.
        </p>
      )}

      {/* ---------------------------------------------------------------- 맨 위 결론 */}
      <section className={`card verdict ${easy.level}`} aria-labelledby="rep-verdict">
        <div className="verdict-top">
          <h3 className="verdict-title" id="rep-verdict">
            맨 먼저, 결론부터
          </h3>
          <span className={`traffic ${easy.level}`} data-testid="traffic-badge">
            {easy.badge}
          </span>
          <span className="traffic-basis" data-testid="traffic-basis">
            {trafficBasis(run.size.shares, run.plan.side)} ·{" "}
            <strong data-testid="traffic-money">{moneyChip}</strong>
          </span>
        </div>
        <ol className="easy-lines" data-testid="summary-lines">
          {easy.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
        {easy.note && (
          <p className="alert warn small verdict-zero-note" role="status" data-testid="zero-share-note">
            {easy.note}
          </p>
        )}
        {extremeStop && (
          <p className="alert warn small verdict-caution" role="status" data-testid="extreme-caution">
            {EXTREME_STOP_REASON}. 그래서 위 신호등은 유리/손실 판정 대신 '⚪ 참고하기
            어려워요'로 표시했고, 이 화면의 목표·이익 쪽 숫자도 초록 강조 없이 중립으로 표시했어요 —
            숫자가 실제보다 크게 보일 수 있어요.
          </p>
        )}
        <details className="math-details" data-testid="math-details">
          <summary>숫자·전문 산식 자세히 보기</summary>
          <ul className="math-list" data-testid="avg-r-breakdown">
            {detail.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <div className="summary-stats">
            <div>
              <span className="stat-label">목표 도달</span>
              <strong className={positive} data-testid="report-p-target">
                {statPct.target}
              </strong>
            </div>
            <div>
              <span className="stat-label">손절 도달</span>
              <strong className="neg" data-testid="report-p-stop">
                {statPct.stop}
              </strong>
            </div>
            <div>
              <span className="stat-label">{GREEN_LABEL}</span>
              <strong data-testid="report-p-green">{greenPct.total}</strong>
              <span className="stat-sub">
                목표 도달 {greenPct.target} + 유리 마감 {greenPct.extra}
              </span>
            </div>
            <div>
              <span className="stat-label">1회 평균</span>
              <strong className={avgRTone(run.sim.avgR, extremeStop)}>{formatR(run.sim.avgR)}</strong>
              <span className="stat-sub">미도달 포함</span>
            </div>
          </div>
        </details>
        <p className="footnote">
          이 리포트는 지금까지의 과거 흐름을 다시 걸어 본 결과예요. 미래를 맞히는 값이 아니고,
          매수·매도 신호도 아닙니다.
        </p>
      </section>

      {/* ---------------------------------------------------------------- 1. 온도계 */}
      <section className="card" aria-labelledby="rep-thermo">
        <div className="card-head">
          <h3 className="card-title" id="rep-thermo">
            1. 하루 동안 주가가 얼마나 흔들리나요?
          </h3>
          <span className="badge">최근 {thermo.sessions}일 평균 vs 내 손절폭</span>
        </div>
        <p className="easy-line" data-testid="easy-thermo">
          {easyThermometerLine(thermo)}
        </p>
        <ThermometerView thermo={thermo} />
      </section>

      {/* ---------------------------------------------------------------- 2. 조합표 */}
      <section className="card" aria-labelledby="rep-combos">
        <div className="card-head">
          <h3 className="card-title" id="rep-combos">
            2. 손절·목표 넓이를 바꾸면 결과가 어떻게 달라질까요?
          </h3>
          <span className="badge">
            손절 {levels.length} × 목표 {targetRs.length}
          </span>
        </div>
        <p className="card-desc">
          내 진입가 {formatPrice(run.plan.entry, unit)}을 그대로 두고, 손절폭을 {levelWords.join("·")}로
          바꾸고 목표를 손절폭의 {targetRs.map((r) => `${r}배`).join("·")} 지점에 두었을 때예요. 칸마다 “100번 중
          몇 번 이익으로 끝났는지”와 “1번에 평균 몇 배 남았는지”를 적었어요.
        </p>
        <p className="term-note" data-testid="combo-multiple-note">
          {COMBO_MULTIPLE_NOTE}
        </p>
        {(levels.length < 3 || (combos?.duplicateCount ?? 0) > 0) && (
          <p className="alert warn small" data-testid="combo-dedup-note">
            손절폭이 좁아 1원 단위로 반올림하면서 같은 가격이 생겼습니다. 같은 손절가·목표가는 한 번만 계산해
            실제로는 <strong>{comboCount}개 조합</strong>(손절 {levels.length}단계 × 목표{" "}
            {targetRs.length}개 중)만 비교합니다. 칸마다 쓰인 손절가·목표가는 표에 그대로 적었어요.
          </p>
        )}
        <ComboTable
          result={combos}
          loading={combosBusy}
          unit={unit}
          mode={mode}
          onMode={setMode}
          baseStopPct={stopPct}
          extreme={extremeStop}
        />
        {!combosBusy && !combos && (
          <p className="alert warn small">
            완전한 세션이 3일 미만이라 손절·목표 조합을 계산할 수 없습니다. 더 긴 데이터로 다시 실행해
            주세요.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- 3. 생존 */}
      <section className="card" aria-labelledby="rep-survival">
        <div className="card-head">
          <h3 className="card-title" id="rep-survival">
            3. 똑같이 20번 매매하면 100명 중 내 돈은 어디쯤 있을까요?
          </h3>
          <span className="badge">복리 · 현재 자금 기준</span>
        </div>
        <p className="card-desc">
          {run.size.shares > 0
            ? `방금 나온 1번 결과를 ${survival?.trades ?? 20}번 연달아 해봤어요. 시작 자금을 100으로 놓고, 운을 각각 다르게 굴린 ${
                survival ? survival.scenarios.toLocaleString("ko-KR") : "4,000"
              }명의 ${survival?.trades ?? 20}번 뒤 자금을 줄 세운 그래프예요. ${
                run.size.riskLimitedByCash
                  ? "1번에 거는 돈은 계획한 허용 손실률이 아니라 수량 카드의 실제 최대 손실 기준입니다."
                  : "1번에 거는 돈은 수량 카드의 실제 최대 손실 기준입니다."
              }`
            : "계산된 수량이 0주예요. 이 조건에서는 1주도 살 수 없어 매매가 아예 실행되지 않으므로, 자금도 변하지 않아요. 그래서 계획한 허용 손실률을 적용하지 않고 ‘변동 없음’으로 계산했어요."}
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
            extreme={extremeStop}
          />
        ) : (
          <p className="alert warn small">
            1회 결과 분포를 읽지 못해 생존 시뮬레이션을 만들 수 없었습니다. 다시 실행해 주세요.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- 4. 수량 */}
      <SizingCard
        size={run.size}
        unit={unit}
        account={run.plan.account}
        riskPct={run.plan.riskPct}
        heading={`4. 한 번에 몇 주를 ${sharesWord} 할까요?`}
        headingId="rep-sizing"
        extreme={extremeStop}
      />

      {/* ---------------------------------------------------------------- 5. 용어 */}
      <section className="card" aria-labelledby="rep-terms">
        <details className="glossary-block">
          <summary id="rep-terms">5. 어려운 말 한 줄 풀이 — 필요할 때 펼쳐 보기</summary>
          <dl className="easy-glossary" data-testid="easy-glossary">
            {glossary.map((g) => (
              <div key={g.term}>
                <dt>{g.term}</dt>
                <dd>{g.plain}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <p className="report-foot">
        이 리포트는 개인 연구·참고용 통계 해석이며 매매 판단의 근거가 될 수 없습니다. 같은 입력이면
        같은 결과가 나오도록 고정 시드를 씁니다.
      </p>
    </div>
  );
}
