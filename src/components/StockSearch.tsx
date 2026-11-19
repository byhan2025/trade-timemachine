import { useEffect, useMemo, useRef, useState } from "react";
import {
  probeRelay,
  RELAY_OFFLINE_MESSAGE,
  RELAY_PENDING_NOTE,
  searchStocks,
  StockApiError,
} from "../lib/stockApi";
import type { RelayState, StockHit } from "../lib/stockApi";

export interface StockPick {
  symbol: string;
  market?: string;
  name?: string;
  label?: string;
}

interface Props {
  onPick: (pick: StockPick) => void;
  busy: boolean;
}

/** 코드·티커로 바로 조회할 수 있는 입력 (6자리 코드, 대문자 티커, 005930.KS) */
const SYMBOL_RE = /^(\d{6}|\d{6}\.[A-Z]{2}|[A-Z]{1,6}(\.[A-Z]{1,3})?)$/;

const EXAMPLES: { label: string; q: string }[] = [
  { label: "삼성전자", q: "삼성전자" },
  { label: "카카오", q: "카카오" },
  { label: "에코프로", q: "에코프로" },
  { label: "TSLA", q: "TSLA" },
];

/**
 * 실시간 종목 검색 입력창.
 * 검색은 네이버증권·Yahoo 검색을 중계 서버로 조회하고, 결과를 고르면 부모가 봉을 불러온다.
 */
export function StockSearch({ onPick, busy }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StockHit[]>([]);
  /** 이 후보 목록이 어느 검색어의 결과인지 (입력을 바꾼 직후 엔터로 옛 후보를 고르는 실수 방지) */
  const [hitsQuery, setHitsQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** 키보드로 후보를 직접 옮겼는지 (안 옮겼으면 입력어와 정확히 맞는 후보를 우선) */
  const [navigated, setNavigated] = useState(false);
  const [searching, setSearching] = useState(false);
  /** 중계 서버 상태 — 처음에는 '대기 중'으로 보이고, 확인된 응답이 있으면 '연결됨'으로 바뀐다 */
  const [relay, setRelay] = useState<RelayState>("offline");
  const [status, setStatus] = useState<{ tone: "muted" | "error" | "ok"; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Enter 로 조회를 걸어 두고 검색 결과를 기다리는 중인지 */
  const pendingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const trimmed = query.trim();

  /* 앱을 열면 중계 서버가 응답하는지 한 번 확인한다(응답하면 자동으로 정상 모드) */
  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    probeRelay(ctrl.signal).then((state) => {
      if (alive) setRelay(state);
    });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  /* 바깥 클릭이면 후보 목록을 닫는다 */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /* 400ms 디바운스 검색 */
  useEffect(() => {
    pendingRef.current = false;
    if (!trimmed) {
      abortRef.current?.abort();
      setHits([]);
      setHitsQuery("");
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      searchStocks(trimmed, ctrl.signal)
        .then((out) => {
          if (ctrl.signal.aborted) return;
          setHits(out.results);
          setHitsQuery(trimmed);
          setOpen(out.results.length > 0);
          setActive(out.results.length ? 0 : -1);
          setNavigated(false);
          setSearching(false);
          setRelay("ready");
          if (pendingRef.current) {
            // Enter 로 걸어 둔 조회: 정확히 맞는 후보(없으면 1번 후보)를 자동으로 불러온다
            pendingRef.current = false;
            const q = trimmed.toUpperCase();
            const best =
              out.results.find(
                (h) => h.symbol.toUpperCase() === q || h.code.toUpperCase() === q || h.name === trimmed
              ) ?? out.results[0];
            if (best) {
              select(best);
              return;
            }
          }
          setStatus(
            out.results.length
              ? { tone: "muted", text: `후보 ${out.results.length}건 — 종목을 고르면 60일 5분봉을 불러옵니다.` }
              : { tone: "muted", text: out.note || "검색 결과가 없습니다." }
          );
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          pendingRef.current = false;
          setSearching(false);
          setHits([]);
          setOpen(false);
          const offline =
            e instanceof StockApiError && (e.kind === "offline" || e.kind === "timeout");
          if (offline) setRelay("offline");
          setStatus({
            tone: "error",
            text: offline ? RELAY_OFFLINE_MESSAGE : e instanceof Error ? e.message : "검색에 실패했습니다.",
          });
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  const select = (hit: StockHit) => {
    setOpen(false);
    setStatus({
      tone: "ok",
      text: `${hit.name} (${hit.symbol}) 선택 — 실시간 5분봉을 불러옵니다.`,
    });
    onPick({
      symbol: hit.symbol,
      market: hit.market || undefined,
      name: hit.name,
      label: hit.name,
    });
  };

  const submit = () => {
    if (!trimmed) return;
    // 후보는 지금 입력어에 대한 결과일 때만 쓴다
    const current = hitsQuery === trimmed ? hits : [];
    const q = trimmed.toUpperCase();
    const exact = current.find(
      (h) => h.symbol.toUpperCase() === q || h.code.toUpperCase() === q || h.name === trimmed
    );
    const hit = (navigated ? current[active] : exact ?? current[active]) ?? (current.length === 1 ? current[0] : null);
    if (hit) {
      select(hit);
      return;
    }
    if (!SYMBOL_RE.test(trimmed)) {
      // 종목명(한글 등)은 심볼이 아니므로 검색 결과를 기다렸다가 고른다
      pendingRef.current = true;
      setOpen(true);
      setStatus({ tone: "muted", text: `'${trimmed}' 검색 중… 결과에서 자동으로 불러옵니다.` });
      return;
    }
    // 코드·티커는 바로 조회
    setOpen(false);
    setStatus({ tone: "ok", text: `'${trimmed}' 을(를) 코드·티커로 조회합니다.` });
    onPick({ symbol: trimmed, label: trimmed });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && hits.length) {
        setOpen(true);
        return;
      }
      setNavigated(true);
      setActive((i) => (hits.length ? (i + 1) % hits.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setNavigated(true);
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const listId = useMemo(() => "stock-search-list", []);

  return (
    <div className="stock-search" ref={boxRef}>
      <p className={`relay-note ${relay}`} data-testid="relay-status" role="status" aria-live="polite">
        <span className="relay-dot" aria-hidden="true" />
        {relay === "ready" && "실시간 시세 서버 연결됨 — 종목명·코드·티커로 바로 조회할 수 있습니다."}
        {relay === "offline" && RELAY_PENDING_NOTE}
      </p>
      <label className="field">
        <span className="field-label">
          실시간 종목 검색 <span className="muted small">(한국 종목명·코드 / 미국 티커)</span>
        </span>
        <div className="search-row">
          <input
            className="control"
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="삼성전자 · 카카오 · 에코프로 · 005930 · TSLA"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => hits.length > 0 && setOpen(true)}
            aria-label="실시간 종목 검색"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          />
          <button
            type="button"
            className="btn search-btn"
            onClick={submit}
            disabled={!trimmed || searching || busy}
          >
            {busy ? "불러오는 중…" : searching ? "검색 중…" : "조회"}
          </button>
        </div>
      </label>

      {open && hits.length > 0 && (
        <ul className="suggest" id={listId} role="listbox" aria-label="종목 후보">
          {hits.map((hit, i) => (
            <li key={`${hit.symbol}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                id={`${listId}-${i}`}
                className={i === active ? "suggest-item active" : "suggest-item"}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(hit)}
              >
                <span className="suggest-name">{hit.name}</span>
                <span className="suggest-meta">
                  {hit.symbol}
                  {hit.market ? ` · ${hit.market}` : ""}
                  {hit.currency ? ` · ${hit.currency}` : ""}
                </span>
                <span className={`suggest-src ${hit.source === "naver" ? "naver" : "yahoo"}`}>
                  {hit.source === "naver" ? "네이버" : "Yahoo"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="search-hint">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.q}
            type="button"
            className="chip tiny"
            onClick={() => {
              setQuery(ex.q);
              setStatus(null);
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <p
        className={
          status?.tone === "error" ? "search-status alert error small" : "search-status footnote"
        }
        role="status"
        aria-live="polite"
      >
        {status?.text ??
          "종목을 검색해 고르면 최근 60일 5분봉을 서버에서 받아 바로 재생합니다. 서버가 준비되지 않았어도 내장 5종목과 CSV/JSON 입력은 그대로 쓸 수 있습니다."}
      </p>
    </div>
  );
}
