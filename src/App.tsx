import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dataset, SampleIndex, Side } from "./lib/types";
import { buildPool } from "./lib/pool";
import { simulate } from "./lib/simulate";
import { historyReplay } from "./lib/backtest";
import { sizePosition } from "./lib/sizing";
import { parseCustom } from "./lib/parseCustom";
import { formatPrice, formatPct, formatR, mirrorPrice, offsetPrice, roundPrice } from "./lib/format";
import { fetchStockBars, RELAY_OFFLINE_MESSAGE, StockApiError } from "./lib/stockApi";
import type { RunResult } from "./lib/run";
import { FanChart } from "./components/FanChart";
import { ResultCards } from "./components/ResultCards";
import { SizingCard, isExtremeStop } from "./components/SizingCard";
import { EXTREME_BANNER_NOTE, avgRTone } from "./lib/easy";
import { BacktestCard } from "./components/BacktestCard";
import { DataNote } from "./components/DataNote";
import { StockSearch } from "./components/StockSearch";
import type { StockPick } from "./components/StockSearch";
import { ReportView } from "./components/ReportView";

const BASE = import.meta.env.BASE_URL || "/";
const REPLAYS = 10000;
const SEED = 19;
const CUSTOM_PENDING_MESSAGE = "먼저 차트 데이터를 입력하고 [적용하기]를 눌러주세요";

type Tab = "sim" | "report";

export default function App() {
  const [index, setIndex] = useState<SampleIndex | null>(null);
  const [datasetId, setDatasetId] = useState<string>("");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [customWarnings, setCustomWarnings] = useState<string[]>([]);
  const [customBusy, setCustomBusy] = useState(false);
  /** [적용하기]를 통과해 실제로 계산에 쓸 수 있는 커스텀 데이터 */
  const [customDataset, setCustomDataset] = useState<Dataset | null>(null);

  const [liveDataset, setLiveDataset] = useState<Dataset | null>(null);
  const [liveWarnings, setLiveWarnings] = useState<string[]>([]);
  const [liveState, setLiveState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    message?: string;
    detail?: string;
    lastPick?: StockPick;
  }>({ status: "idle" });
  const liveAbortRef = useRef<AbortController | null>(null);

  const [side, setSide] = useState<Side>("buy");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [entryBar, setEntryBar] = useState(12);
  const [account, setAccount] = useState("10000000");
  const [riskPct, setRiskPct] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [tab, setTab] = useState<Tab>("sim");
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const unit = dataset?.priceUnit ?? "";

  /* ---------------------------------------------------------------- data */
  useEffect(() => {
    fetch(`${BASE}samples/index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("index.json"))))
      .then((data: SampleIndex) => {
        setIndex(data);
        if (data.items.length) setDatasetId(data.items[0].id);
      })
      .catch(() => setLoadError("내장 샘플 데이터를 불러오지 못했습니다. `npm run samples`로 데이터를 생성하세요."));
  }, []);

  const applyDefaults = useCallback((d: Dataset) => {
    const slots = d.times.length;
    const k = Math.max(1, Math.min(12, Math.floor(slots * 0.3), slots - 3));
    const last = d.sessions[d.sessions.length - 1];
    const px = last.bars[k][3];
    const p = roundPrice(px, d.priceUnit);
    const s = roundPrice(px * 0.99, d.priceUnit);
    const t = roundPrice(px * 1.02, d.priceUnit);
    setSide("buy");
    setEntryBar(k);
    setEntry(String(p));
    setStop(String(s));
    setTarget(String(t));
    setAccount(d.currency === "USD" ? "10000" : "10000000");
  }, []);

  useEffect(() => {
    if (!datasetId || datasetId === "custom" || datasetId === "live") return;
    let alive = true;
    fetch(`${BASE}samples/${datasetId}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(datasetId))))
      .then((d: Dataset) => {
        if (!alive) return;
        setDataset(d);
        setCustomWarnings([]);
        applyDefaults(d);
      })
      .catch(() => alive && setLoadError("선택한 종목의 샘플 데이터를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [datasetId, applyDefaults]);

  const sampleOptions = useMemo(() => index?.items ?? [], [index]);

  /* ---------------------------------------------------------------- custom data */
  const applyCustom = useCallback(
    (text: string) => {
      setCustomBusy(true);
      setCustomError(null);
      window.setTimeout(() => {
        try {
          const { dataset: d, warnings } = parseCustom(text, "내 차트");
          d.priceUnit = "";
          setDataset(d);
          setCustomDataset(d);
          setDatasetId("custom");
          setCustomWarnings(warnings);
          applyDefaults(d);
          setRun(null);
        } catch (e) {
          setCustomError(e instanceof Error ? e.message : "데이터를 읽지 못했습니다.");
        } finally {
          setCustomBusy(false);
        }
      }, 10);
    },
    [applyDefaults]
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCustomText(text);
    applyCustom(text);
  };

  const fillExample = () => {
    if (!dataset) return;
    const text = toCsv(dataset, 3);
    setCustomText(text);
  };

  const downloadSampleCsv = () => {
    if (!dataset) return;
    const blob = new Blob([toCsv(dataset, 3)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset.symbol.replace(/[^\w.-]/g, "_")}-3days.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 종목·데이터 선택 */
  const changeDataset = (next: string) => {
    setRun(null);
    setError(null);
    if (next === "custom") {
      setDataset(customDataset);
      setDatasetId("custom");
      setCustomWarnings(customDataset ? customWarnings : []);
      return;
    }
    if (next === "live" && liveDataset) {
      setDataset(liveDataset);
      setCustomWarnings([]);
      applyDefaults(liveDataset);
    }
    setDatasetId(next);
  };

  /* ---------------------------------------------------------------- live */
  const loadLive = useCallback(
    async (pick: StockPick) => {
      liveAbortRef.current?.abort();
      const ctrl = new AbortController();
      liveAbortRef.current = ctrl;
      const label = pick.label ?? pick.symbol;
      setLiveState({ status: "loading", message: `${label} 5분봉을 불러오는 중…`, lastPick: pick });
      try {
        const out = await fetchStockBars(pick, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const m = out.dataset.meta;
        setLiveDataset(out.dataset);
        setLiveWarnings(out.warnings);
        setDataset(out.dataset);
        setDatasetId("live");
        setCustomWarnings([]);
        setLoadError(null);
        applyDefaults(out.dataset);
        setRun(null);
        setLiveState({
          status: "ready",
          lastPick: pick,
          message: `${out.dataset.name} (${out.dataset.symbol}) — ${m.sessionsUsed}세션 · ${m.interval} · ${m.firstDate}~${m.lastDate} 불러옴`,
          detail:
            out.warnings.length > 0
              ? out.warnings.join(" ")
              : [m.source, out.source.range ? `range=${out.source.range}&interval=${out.source.interval}` : ""]
                  .filter(Boolean)
                  .join(" · "),
        });
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        const offline =
          e instanceof StockApiError && (e.kind === "offline" || e.kind === "timeout");
        setLiveState({
          status: "error",
          lastPick: pick,
          message: offline
            ? RELAY_OFFLINE_MESSAGE
            : e instanceof Error
              ? e.message
              : "실시간 데이터를 불러오지 못했습니다.",
          detail:
            e instanceof StockApiError && e.kind === "offline"
              ? "중계 서버(stock-bars)가 아직 배포되지 않았거나 네트워크가 막혀 있습니다. 내장 5종목과 CSV/JSON 입력은 지금도 그대로 작동합니다. 가짜 시세를 대신 보여주지는 않습니다."
              : undefined,
        });
      }
    },
    [applyDefaults]
  );

  useEffect(() => () => liveAbortRef.current?.abort(), []);

  /* ---------------------------------------------------------------- run */
  const num = (s: string) => {
    const v = Number(String(s).replace(/,/g, ""));
    return isFinite(v) ? v : NaN;
  };

  const customPending = datasetId === "custom" && !customDataset;

  const validate = (): string | null => {
    if (customPending) return CUSTOM_PENDING_MESSAGE;
    if (!dataset) return "데이터를 먼저 선택해 주세요.";
    const e = num(entry);
    const s = num(stop);
    const t = num(target);
    const a = num(account);
    const r = num(riskPct);
    if (!(e > 0) || !(s > 0) || !(t > 0)) return "진입가·손절가·목표가는 0보다 큰 숫자여야 합니다.";
    if (side === "buy" && !(s < e && e < t)) return "매수는 손절가 < 진입가 < 목표가 순서여야 합니다.";
    if (side === "sell" && !(t < e && e < s)) return "매도는 목표가 < 진입가 < 손절가 순서여야 합니다.";
    if (!(a > 0)) return "계좌 금액을 입력해 주세요.";
    if (!(r > 0) || r > 100) return "1회 허용 손실률은 0보다 크고 100 이하여야 합니다.";
    if (dataset.sessions.length < 3) return "완전한 거래일이 3일 이상 필요합니다.";
    if (entryBar >= dataset.times.length - 1) return "진입 시각이 너무 늦어 재생할 봉이 남지 않습니다.";
    return null;
  };

  const execute = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setRunning(true);
    window.setTimeout(() => {
      try {
        const d = dataset!;
        const e = num(entry);
        const s = num(stop);
        const t = num(target);
        const a = num(account);
        const r = num(riskPct);
        const slots = d.times.length;
        const pool = buildPool(d.sessions, slots);
        if (pool.sessions < 3) throw new Error("완전한 거래일이 3일 이상 필요합니다.");
        const sim = simulate({
          pool,
          entry: e,
          stop: s,
          target: t,
          side,
          entryBar,
          replays: REPLAYS,
          seed: SEED,
        });
        const stopPct = Math.abs(e - s) / e;
        const intervalMin = d.meta.intervalSeconds ? d.meta.intervalSeconds / 60 : 5;
        const orBars = Math.max(1, Math.round(15 / intervalMin));
        const bt = historyReplay(d.sessions, d.times, {
          orBars,
          stopPct,
          targetR: sim.rAtTarget,
          side,
        });
        const size = sizePosition({
          entry: e,
          stop: s,
          target: t,
          account: a,
          riskPct: r,
          side,
          expectedR: sim.avgR,
        });
        setRun({
          signature: signatureOf(d.id, side, e, s, t, entryBar, a, r),
          sim,
          size,
          bt,
          dataset: d,
          plan: { side, entry: e, stop: s, target: t, entryBar, account: a, riskPct: r },
          warnings: customWarnings,
        });
        setTab("sim");
        window.setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      } catch (e) {
        setError(e instanceof Error ? e.message : "시뮬레이션에 실패했습니다.");
      } finally {
        setRunning(false);
      }
    }, 20);
  };

  const applyRR = (r: number) => {
    const e = num(entry);
    const s = num(stop);
    if (!(e > 0) || !(s > 0) || e === s) return;
    const risk = Math.abs(e - s);
    // 원 단위로 반올림하면 99,999.99처럼 소수 입력의 0.01이 사라져 목표가가 진입가와 같아진다.
    // 입력값의 소수 정밀도를 보존한 채 목표가를 정한다(v2.2.1).
    const t = side === "buy" ? offsetPrice(e, r * risk, unit) : offsetPrice(e, -r * risk, unit);
    setTarget(String(t));
  };

  const changeSide = (next: Side) => {
    if (next === side) return;
    const e = num(entry);
    const s = num(stop);
    const t = num(target);
    // 방향 전환은 진입가 기준 대칭 미러링 — 화면 단위(원)로 반올림하면 99,999.99의 0.01이 사라지고
    // 100,000 / 99,999.99가 같은 가격이 된다. 입력값의 소수 자릿수를 보존한다(v2.2.1).
    if (e > 0 && s > 0) setStop(String(mirrorPrice(e, s, unit)));
    if (e > 0 && t > 0) setTarget(String(mirrorPrice(e, t, unit)));
    setSide(next);
  };

  const resetPrices = () => {
    if (dataset) applyDefaults(dataset);
  };

  const openReport = () => {
    setTab("report");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remaining = dataset ? dataset.times.length - 1 - entryBar : 0;
  const currentSignature = dataset
    ? signatureOf(dataset.id, side, num(entry), num(stop), num(target), entryBar, num(account), num(riskPct))
    : "";
  const stale = !!run && run.signature !== currentSignature;

  const runDisabled = running || !dataset || customPending;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ⏱
          </span>
          <div>
            <h1>한국형 타임머신</h1>
            <p>내 계획을 1만 번 미리 걸어보는 통계 시뮬레이터</p>
          </div>
        </div>
        <span className="pill">v2.2.2 · 극단 입력 중립 표시</span>
      </header>

      <div className="disclaimer" role="note" data-testid="top-disclaimer">
        <strong>투자 권유·매수/매도 신호가 아닙니다.</strong> 사용자가 입력한 가격과 과거 봉 데이터 기반의
        단순 통계 시뮬레이션이며, 미래 수익을 보장하지 않습니다. 원금 손실 가능.
      </div>

      <div className="tabs" role="tablist" aria-label="화면 선택">
        <button
          type="button"
          role="tab"
          id="tab-sim"
          aria-selected={tab === "sim"}
          aria-controls="panel-sim"
          className={tab === "sim" ? "tab active" : "tab"}
          onClick={() => setTab("sim")}
          data-testid="tab-sim"
        >
          1. 시뮬레이터
        </button>
        <button
          type="button"
          role="tab"
          id="tab-report"
          aria-selected={tab === "report"}
          aria-controls="panel-report"
          className={tab === "report" ? "tab active" : "tab"}
          onClick={openReport}
          data-testid="tab-report"
        >
          2. 최종 해석 리포트
          {run && <span className="tab-dot" aria-hidden="true" />}
        </button>
      </div>

      {loadError && <div className="alert error">{loadError}</div>}

      {tab === "sim" ? (
        <main className="layout" id="panel-sim" role="tabpanel" aria-labelledby="tab-sim">
          <section className="card panel-input" aria-labelledby="input-title">
            <h2 id="input-title" className="card-title">
              계획 입력
            </h2>

            <StockSearch onPick={loadLive} busy={liveState.status === "loading"} />

            <div
              className={`live-status ${liveState.status}`}
              role="status"
              aria-live="polite"
              hidden={liveState.status === "idle"}
            >
              {liveState.status !== "idle" && (
                <>
                  <p className="live-status-line">
                    {liveState.status === "loading" && <span className="spinner" aria-hidden="true" />}
                    {liveState.message}
                  </p>
                  {liveState.status === "error" && liveState.detail && (
                    <p className="live-status-detail">{liveState.detail}</p>
                  )}
                  {liveState.status === "ready" && liveState.detail && (
                    <p className="live-status-detail">{liveState.detail}</p>
                  )}
                  {liveState.status === "ready" && liveState.lastPick && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => liveState.lastPick && loadLive(liveState.lastPick)}
                    >
                      최신 시세로 다시 불러오기
                    </button>
                  )}
                  {liveState.status === "error" && liveState.lastPick && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => liveState.lastPick && loadLive(liveState.lastPick)}
                    >
                      다시 시도
                    </button>
                  )}
                </>
              )}
            </div>

            <label className="field">
              <span className="field-label">
                내장 샘플 · 내 데이터 <span className="muted small">(실시간 없이 바로 사용)</span>
              </span>
              <select
                className="control"
                value={datasetId}
                data-testid="dataset-select"
                onChange={(e) => changeDataset(e.target.value)}
              >
                {liveDataset && (
                  <option value="live">
                    실시간: {liveDataset.name} ({liveDataset.symbol}) · {liveDataset.meta.sessionsUsed}일
                  </option>
                )}
                {sampleOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.symbol}) · {s.sessions}일 · {s.sessionBars}봉
                  </option>
                ))}
                <option value="custom">내 데이터 직접 입력 (CSV/JSON)</option>
              </select>
            </label>

            <p className="privacy-note" data-testid="privacy-note">
              CSV·JSON 붙여넣기/업로드는 브라우저 안에서만 처리되며 외부로 전송되지 않습니다. 실시간
              종목 검색 시에만 검색어·종목 코드가 시세 중계 서버로 전달됩니다.
            </p>

            {datasetId === "custom" && (
              <div className="custom-box">
                <div className="custom-actions">
                  <label className="file-btn">
                    파일 선택
                    <input
                      type="file"
                      accept=".csv,.txt,.json,text/csv,application/json"
                      onChange={(e) => onFile(e.target.files?.[0])}
                    />
                  </label>
                  <button type="button" className="link-btn" onClick={fillExample}>
                    예시 채우기
                  </button>
                  <button type="button" className="link-btn" onClick={downloadSampleCsv}>
                    CSV 형식 받기
                  </button>
                </div>
                <textarea
                  className="control textarea"
                  placeholder={"시각,시가,고가,저가,종가,거래량\n2026-11-18 09:00,71500,71800,71300,71600,120345\n2026-11-18 09:05,71600,71900,71400,71750,98411"}
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  rows={6}
                  aria-label="차트 데이터 붙여넣기"
                  data-testid="custom-textarea"
                />
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => applyCustom(customText)}
                  disabled={customBusy || !customText.trim()}
                  data-testid="apply-custom"
                >
                  {customBusy ? "읽는 중…" : "이 데이터로 적용"}
                </button>
                {customError && (
                  <p className="alert error small" role="alert" data-testid="custom-error">
                    {customError}
                  </p>
                )}
                {customWarnings.map((w) => (
                  <p key={w} className="alert warn small">
                    {w}
                  </p>
                ))}
                <p className="footnote">
                  같은 날짜에 봉이 3개 이상인 분봉(날짜+시간) 데이터를 넣어 주세요. 날짜만 있는 일봉은 이
                  단계에서 재생할 수 없습니다. 값이 어긋난 봉(고가&lt;저가, 범위 밖 시·종가, 0 이하 가격,
                  음수 거래량, 중복·역순 시각, 달력에 없는 날짜·시각, 문자 섞인 숫자)은 적용되지 않습니다.
                  국내 HTS 기본 내보내기처럼 <strong>최신 봉이 위에 오는(역순) CSV</strong>는 위아래를 뒤집어
                  시간순(오래된 봉 → 최신 봉)으로 붙여넣어 주세요.
                </p>
              </div>
            )}

            {customPending && (
              <p className="alert warn small" role="status" data-testid="custom-pending">
                {CUSTOM_PENDING_MESSAGE} — 지금은 이전 종목 데이터로 계산하지 않습니다.
              </p>
            )}

            <div className="field-label position-label" id="position-label">
              가정할 포지션 <span className="muted small">(매매 신호가 아니라 내 계획의 방향)</span>
            </div>
            <div className="seg" role="group" aria-labelledby="position-label">
              <button
                type="button"
                className={side === "buy" ? "seg-btn active" : "seg-btn"}
                aria-pressed={side === "buy"}
                onClick={() => changeSide("buy")}
              >
                매수
              </button>
              <button
                type="button"
                className={side === "sell" ? "seg-btn active" : "seg-btn"}
                aria-pressed={side === "sell"}
                onClick={() => changeSide("sell")}
              >
                매도
              </button>
            </div>

            <div className="grid2">
              <label className="field">
                <span className="field-label">
                  진입가 <span className="tag-example">예시 입력값(가상)</span>
                </span>
                <input
                  className="control"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={entry}
                  data-testid="entry-input"
                  onChange={(e) => setEntry(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  손절가 <span className="tag-example">예시 입력값(가상)</span>
                </span>
                <input
                  className="control"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={stop}
                  data-testid="stop-input"
                  onChange={(e) => setStop(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  목표가 <span className="tag-example">예시 입력값(가상)</span>
                </span>
                <input
                  className="control"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={target}
                  data-testid="target-input"
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              <div className="field">
                <span className="field-label">손익비 프리셋</span>
                <div className="rr-row">
                  {[1, 1.5, 2].map((r) => (
                    <button key={r} type="button" className="chip" onClick={() => applyRR(r)}>
                      {r}R
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="example-note">
              진입가·손절가·목표가의 기본값은 과거 봉 가격에서 자동으로 채운 <strong>예시(가상)</strong>
              입니다. 추천가·매매 신호가 아니므로 내 계획으로 직접 바꿔 넣으세요.
            </p>

            <label className="field">
              <span className="field-label">
                진입 시각 <span className="muted small">(이 봉 종가에 진입했다고 가정)</span>
              </span>
              <select
                className="control"
                value={entryBar}
                onChange={(e) => setEntryBar(Number(e.target.value))}
                disabled={!dataset}
              >
                {!dataset && <option value={entryBar}>데이터를 적용하면 시각을 고를 수 있습니다</option>}
                {(dataset?.times ?? []).slice(0, -1).map((t, i) => (
                  <option key={t + i} value={i}>
                    {t} · 남은 봉 {dataset ? dataset.times.length - 1 - i : 0}개
                  </option>
                ))}
              </select>
            </label>

            <div className="grid2">
              <label className="field">
                <span className="field-label">
                  계좌 금액 <span className="muted small">({unit === "USD" ? "달러" : unit || "입력 통화"})</span>
                </span>
                <input
                  className="control"
                  type="number"
                  inputMode="numeric"
                  step="any"
                  min="0"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">1회 허용 손실률 (%)</span>
                <input
                  className="control"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="100"
                  value={riskPct}
                  onChange={(e) => setRiskPct(e.target.value)}
                />
              </label>
            </div>

            <div className="run-stack">
              <button
                className="btn primary"
                onClick={execute}
                disabled={runDisabled}
                data-testid="run-btn"
                aria-describedby={customPending ? "custom-pending" : undefined}
              >
                {running ? "재생 중…" : "1만 번 모의 재생 실행"}
              </button>
              <div className="run-meta">
                <span>
                  남은 봉 {dataset ? `${remaining}개` : "-"} · 고정 시드 {SEED} · 같은 입력이면 같은
                  결과가 나옵니다.
                </span>
                <button type="button" className="link-btn" onClick={resetPrices}>
                  가격 초기화
                </button>
              </div>
            </div>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
          </section>

          <div className="col-results" ref={resultsRef}>
            {!run && (
              <section className="card empty-state">
                <h2 className="card-title">아직 재생하지 않았습니다</h2>
                <p>
                  종목과 진입가·손절가·목표가를 정하고 <strong>1만 번 모의 재생 실행</strong>을 누르면,
                  과거 봉의 수익률 분포로 남은 장을 10,000번 다시 걸어 결과 확률과 경로 분포를 보여줍니다.
                </p>
                <ul className="bullets">
                  <li>목표 도달 / 손절 도달 / 장 마감 미도달 확률</li>
                  <li>손실 한도 기준 계산 수량과 리스크 요약</li>
                  <li>과거 같은 셋업 백테스트와 경로 분포 차트</li>
                  <li>쉬운 말로 풀어 주는 2. 최종 해석 리포트(초등학생 눈높이)</li>
                </ul>
              </section>
            )}

            {run && (
              <>
                {stale && (
                  <p className="alert warn small" role="status">
                    입력이 바뀌었습니다. 아래 결과는 이전 입력 기준입니다. 다시 실행해 주세요.
                  </p>
                )}
                <div className="run-head">
                  <span className="badge strong">
                    {run.dataset.name} · {run.plan.side === "buy" ? "매수" : "매도"} ·{" "}
                    {run.dataset.times[run.plan.entryBar]} 진입
                  </span>
                  <span className="muted small">
                    진입 {formatPrice(run.plan.entry, run.dataset.priceUnit)} · 손절{" "}
                    {formatPrice(run.plan.stop, run.dataset.priceUnit)} · 목표{" "}
                    {formatPrice(run.plan.target, run.dataset.priceUnit)}
                  </span>
                </div>

                <div className="easy-banner" data-testid="easy-banner">
                  <div className="easy-banner-body">
                    <span className="badge strong">5초 요약</span>
                    <p>
                      1만 번 중 <strong className="pos">{formatPct(run.sim.pTarget)}</strong> 목표 도달 ·{" "}
                      <strong className="neg">{formatPct(run.sim.pStop)}</strong> 손절 · 1회 평균{" "}
                      {/* 극단 입력은 평균 R을 초록으로 강조하지 않고 중립 회색으로 (v2.2.2) */}
                      <strong
                        className={avgRTone(run.sim.avgR, isExtremeStop(run.plan.entry, run.plan.stop))}
                        data-testid="banner-avg-r"
                      >
                        {formatR(run.sim.avgR)}
                      </strong>
                    </p>
                    {isExtremeStop(run.plan.entry, run.plan.stop) && (
                      <p className="muted small" data-testid="banner-extreme-note">
                        {EXTREME_BANNER_NOTE}
                      </p>
                    )}
                    <p className="muted small">
                      신호등 결론부터 초등학생 눈높이로 풀고, 하루 흔들림·손절·목표 조합·20번 생존·수량까지
                      한 페이지에 정리했습니다.
                    </p>
                  </div>
                  <button type="button" className="btn easy-btn" onClick={openReport} data-testid="open-report">
                    쉬운 해석 보러가기 →
                  </button>
                </div>

                <section className="card">
                  <ResultCards
                    sim={run.sim}
                    unit={run.dataset.priceUnit}
                    dataset={run.dataset}
                    extreme={isExtremeStop(run.plan.entry, run.plan.stop)}
                  />
                  <p className="safe-line">
                    1만 회 빈도는 미래 확률이 아니라 과거 봉 재표본 모형 결과입니다. 같은 봉 내 손절·목표
                    동시 도달 시 손절 우선 처리, 종료가 분포는 이후 장 마감까지 재생한 값입니다. 미래
                    주가·수급·뉴스를 반영하지 않으며 매매 판단의 근거가 될 수 없습니다.
                  </p>
                </section>

                <section className="card">
                  <div className="card-head">
                    <h3 className="card-title">경로 분포 차트</h3>
                    <span className="muted small">
                      {run.dataset.times[run.plan.entryBar]} → {run.dataset.meta.sessionEnd} · 샘플 20개 궤적
                    </span>
                  </div>
                  <FanChart
                    times={run.dataset.times}
                    entryBar={run.plan.entryBar}
                    entry={run.plan.entry}
                    stop={run.plan.stop}
                    target={run.plan.target}
                    sim={run.sim}
                    unit={run.dataset.priceUnit}
                  />
                </section>

                <SizingCard
                  size={run.size}
                  unit={run.dataset.priceUnit}
                  account={run.plan.account}
                  riskPct={run.plan.riskPct}
                  extreme={isExtremeStop(run.plan.entry, run.plan.stop)}
                />

                <BacktestCard
                  bt={run.bt}
                  unit={run.dataset.priceUnit}
                  intervalMinutes={run.dataset.meta.intervalSeconds ? run.dataset.meta.intervalSeconds / 60 : 5}
                />
              </>
            )}

            {dataset && (
              <DataNote
                dataset={dataset}
                warnings={dataset.live ? liveWarnings : customWarnings}
              />
            )}
          </div>
        </main>
      ) : (
        <main id="panel-report" role="tabpanel" aria-labelledby="tab-report">
          {run ? (
            <ReportView run={run} stale={stale} onBack={() => setTab("sim")} />
          ) : (
            <section className="card empty-state">
              <h2 className="card-title">아직 해석할 결과가 없습니다</h2>
              <p>
                <strong>1. 시뮬레이터</strong>에서 종목과 진입가·손절가·목표가를 정하고 1만 번 모의 재생을
                실행하면, 이 탭에 초보자용 최종 해석 리포트(요약·흔들림 온도계·손절·목표 조합·20회 생존)가
                만들어집니다.
              </p>
              <button type="button" className="btn primary" onClick={() => setTab("sim")}>
                1. 시뮬레이터로 가기
              </button>
            </section>
          )}
        </main>
      )}

      <footer className="footer">
        <p>
          한국형 타임머신 시뮬레이터 v2.2.2 · 실제 과거 5분봉 기반 · 데이터: Yahoo Finance·네이버증권 공개
          시세 · 투자 자문 아님
        </p>
        <p>
          개인 연구·참고용 <strong>비상업 통계 도구</strong>입니다. 시세를 매매 신호나 투자 권유로
          제공하지 않으며, 공개 시세의 재배포·상업적 이용을 목적으로 하지 않습니다.
        </p>
      </footer>
    </div>
  );
}

function signatureOf(
  id: string,
  side: Side,
  entry: number,
  stop: number,
  target: number,
  entryBar: number,
  account: number,
  riskPct: number
): string {
  return [id, side, entry, stop, target, entryBar, account, riskPct].join("|");
}

/** 내장 데이터의 마지막 n일을 CSV로 (형식 예시 / 내려받기) */
function toCsv(d: Dataset, n: number): string {
  const lines = ["시각,시가,고가,저가,종가,거래량"];
  for (const s of d.sessions.slice(-n)) {
    s.bars.forEach((b, i) => {
      lines.push([`${s.date} ${d.times[i]}`, b[0], b[1], b[2], b[3], b[4] ?? 0].join(","));
    });
  }
  return lines.join("\n");
}
