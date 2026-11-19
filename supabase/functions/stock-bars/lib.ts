/**
 * stock-bars 중계 함수의 순수 로직 (Deno 전용 API 없음 — 그대로 단위 테스트한다)
 *
 * 원칙
 * - 합성·보간한 봉을 만들지 않는다. 받은 값만 쓴다.
 * - 60일 5분봉을 세션(거래일)별로 검증해 "봉 개수·시작 시각이 정확히 같은 완전 세션"만 남긴다
 *   (v1 scripts/fetch_samples.py 와 같은 규칙: 반장·갭·진행 중인 당일 세션 제외).
 * - 봉 시각은 '봉 시작 시각'이며 거래소 현지 시간대로 기록한다.
 */

export const STEP_SEC = 300; // 5분봉

export interface Row {
  date: string;
  minutes: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface DroppedSession {
  date: string;
  bars: number;
}

export interface Session {
  date: string;
  bars: number[][];
}

export interface DatasetMeta {
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
  interval: string;
  intervalSeconds?: number;
  barTimestampMeans?: string;
  sessionStart: string;
  sessionEnd: string;
  sessionBars: number;
  sessionsUsed: number;
  firstDate: string;
  lastDate: string;
  note?: string;
  sessionsDropped?: DroppedSession[];
}

export interface Dataset {
  id: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  priceUnit: string;
  exchangeTimezone?: string;
  meta: DatasetMeta;
  times: string[];
  sessions: Session[];
  live?: boolean;
}

export interface StockHit {
  code: string;
  name: string;
  market: string;
  symbol: string;
  currency: string;
  priceUnit: string;
  exchange: string;
  type: string;
  source: "naver" | "yahoo";
}

export class StockBarsError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "StockBarsError";
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ 시간 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(tz);
  if (cached) return cached;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }
  FORMATTERS.set(tz, f);
  return f;
}

/** epoch 초 -> 거래소 현지 날짜(YYYY-MM-DD)와 자정 기준 분 */
export function localParts(epochSec: number, tz: string): { date: string; minutes: number } {
  const parts = formatter(tz).formatToParts(new Date(epochSec * 1000));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    minutes: Number(pick("hour")) * 60 + Number(pick("minute")),
  };
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function price(x: number): number {
  return Math.round(x * 100) / 100;
}

function volume(x: number): number {
  const r = Math.round(x);
  return isFinite(r) ? r : 0;
}

/* ------------------------------------------------------------ 차트 응답 파싱 */

export interface YahooChartResult {
  meta?: Record<string, unknown>;
  timestamp?: (number | null)[];
  indicators?: { quote?: Record<string, (number | null)[] | undefined>[] };
}

export interface ExtractResult {
  rows: Row[];
  dropped: { noPrice: number; offGrid: number };
  tz: string;
}

/** Yahoo Chart v8 result -> 정렬된 봉 행 (null 가격·격자 밖 타임스탬프 제외) */
export function extractRows(result: YahooChartResult, intervalSec = STEP_SEC): ExtractResult {
  const meta = result.meta ?? {};
  const tz = typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : "UTC";
  const stamps = result.timestamp ?? [];
  const quote = (result.indicators?.quote ?? [])[0] ?? {};
  const cols = ["open", "high", "low", "close", "volume"].map((k) => quote[k] ?? []);
  const dropped = { noPrice: 0, offGrid: 0 };
  const rows: Row[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const ts = stamps[i];
    const [o, h, l, c, v] = cols.map((col) => (i < col.length ? col[i] : null));
    if (ts == null || o == null || h == null || l == null || c == null) {
      dropped.noPrice++;
      continue;
    }
    if (Math.trunc(ts) % intervalSec !== 0) {
      dropped.offGrid++;
      continue;
    }
    const { date, minutes } = localParts(Math.trunc(ts), tz);
    rows.push({ date, minutes, o, h, l, c, v: v ?? 0 });
  }
  rows.sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1));
  return { rows, dropped, tz };
}

/** 1분봉 등 잘은 봉을 5분봉으로 합친다 (시가=첫 봉, 고가=최대, 저가=최소, 종가=마지막, 거래량=합) */
export function aggregateRows(rows: Row[], stepMin = 5): Row[] {
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const start = Math.floor(r.minutes / stepMin) * stepMin;
    const key = `${r.date}|${start}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  const out: Row[] = [];
  for (const [key, list] of buckets) {
    const start = Number(key.split("|")[1]);
    list.sort((a, b) => a.minutes - b.minutes);
    const first = list[0];
    const last = list[list.length - 1];
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    for (const b of list) {
      if (b.h > high) high = b.h;
      if (b.l < low) low = b.l;
      vol += b.v;
    }
    out.push({ date: first.date, minutes: start, o: first.o, h: high, l: low, c: last.c, v: vol });
  }
  out.sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1));
  return out;
}

export interface DetectResult {
  sessions: Session[];
  dropped: DroppedSession[];
  sessionBars: number;
  sessionStart: number;
  sessionEnd: number;
}

/**
 * 거래일별 봉 개수의 최빈값 = 정규 세션 길이.
 * 봉 개수·시작 시각·5분 격자가 모두 맞는 날만 남기고 나머지는 dropped 로 기록한다.
 */
export function detectSessions(rows: Row[], stepMin = 5): DetectResult {
  if (!rows.length) {
    throw new StockBarsError("no_bars", "받은 차트에 유효한 봉이 없습니다.", 422);
  }
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const counts = new Map<number, number>();
  for (const list of byDate.values()) counts.set(list.length, (counts.get(list.length) ?? 0) + 1);
  let sessionBars = 0;
  let best = -1;
  for (const [bars, days] of counts) {
    if (days > best) {
      best = days;
      sessionBars = bars;
    }
  }
  if (sessionBars < 5) {
    throw new StockBarsError(
      "short_session",
      `정규 세션이 너무 짧습니다 (하루 ${sessionBars}봉). 이 종목은 5분봉 세션을 만들 수 없습니다.`,
      422
    );
  }
  const starts = new Map<number, number>();
  for (const list of byDate.values()) {
    if (list.length !== sessionBars) continue;
    const start = Math.min(...list.map((b) => b.minutes));
    starts.set(start, (starts.get(start) ?? 0) + 1);
  }
  let sessionStart = 0;
  let bestStart = -1;
  for (const [start, days] of starts) {
    if (days > bestStart) {
      bestStart = days;
      sessionStart = start;
    }
  }

  const sessions: Session[] = [];
  const dropped: DroppedSession[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const bars = byDate.get(date)!.slice().sort((a, b) => a.minutes - b.minutes);
    const slots = bars.map((b) => (b.minutes - sessionStart) / stepMin);
    const ok =
      bars.length === sessionBars &&
      Math.min(...bars.map((b) => b.minutes)) === sessionStart &&
      slots.every((s) => Number.isInteger(s)) &&
      slots.slice().sort((a, b) => a - b).every((s, i) => s === i);
    if (!ok) {
      dropped.push({ date, bars: bars.length });
      continue;
    }
    sessions.push({
      date,
      bars: bars.map((b) => [price(b.o), price(b.h), price(b.l), price(b.c), volume(b.v)]),
    });
  }
  return {
    sessions,
    dropped,
    sessionBars,
    sessionStart,
    sessionEnd: sessionStart + stepMin * sessionBars,
  };
}

/* --------------------------------------------------------------- 데이터셋 */

export interface BuildInput {
  result: YahooChartResult;
  symbol: string;
  name?: string;
  market?: string;
  currency?: string;
  intervalSec?: number;
  aggregated?: boolean;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  note?: string;
}

export interface BuildOutput {
  dataset: Dataset;
  dropped: DroppedSession[];
  droppedBars: { noPrice: number; offGrid: number };
}

export function buildDataset(input: BuildInput): BuildOutput {
  const intervalSec = input.intervalSec ?? STEP_SEC;
  const extracted = extractRows(input.result, intervalSec);
  const rows = intervalSec === STEP_SEC ? extracted.rows : aggregateRows(extracted.rows, STEP_SEC / 60);
  const detected = detectSessions(rows, 5);
  if (!detected.sessions.length) {
    throw new StockBarsError(
      "no_complete_session",
      "완전한 거래일 세션이 없습니다 (반장·갭·진행 중 세션만 있었습니다).",
      422
    );
  }
  const meta = input.result.meta ?? {};
  const currency =
    input.currency || (typeof meta.currency === "string" ? meta.currency : "") || "";
  const priceUnit = currency === "KRW" ? "원" : currency;
  const exchangeName =
    typeof meta.fullExchangeName === "string"
      ? meta.fullExchangeName
      : typeof meta.exchangeName === "string"
        ? meta.exchangeName
        : "";
  const name =
    input.name && input.name.trim()
      ? input.name.trim()
      : typeof meta.longName === "string"
        ? meta.longName
        : typeof meta.shortName === "string"
          ? meta.shortName
          : input.symbol;

  const sessions = detected.sessions.slice(-60);
  const dataset: Dataset = {
    id: `live-${input.symbol.replace(/[^A-Za-z0-9]+/g, "-")}`,
    symbol: input.symbol,
    name,
    market: input.market || exchangeName || "Yahoo",
    currency,
    priceUnit,
    exchangeTimezone: extracted.tz,
    live: true,
    meta: {
      source: input.source,
      sourceUrl: input.sourceUrl,
      fetchedAt: input.fetchedAt,
      interval: input.aggregated ? "5분봉 (1분봉을 5분으로 합산)" : "5분봉",
      intervalSeconds: STEP_SEC,
      barTimestampMeans: "봉 시작 시각 (거래소 현지 시각)",
      sessionStart: hhmm(detected.sessionStart),
      sessionEnd: hhmm(detected.sessionEnd),
      sessionBars: detected.sessionBars,
      sessionsUsed: sessions.length,
      firstDate: sessions[0].date,
      lastDate: sessions[sessions.length - 1].date,
      note: input.note,
      sessionsDropped: detected.dropped,
    },
    times: Array.from({ length: detected.sessionBars }, (_, i) => hhmm(detected.sessionStart + 5 * i)),
    sessions,
  };
  return { dataset, dropped: detected.dropped, droppedBars: extracted.dropped };
}

/* ------------------------------------------------------------------ 검색 */

/** "005930" / "삼성전자" / "TSLA" / "005930.KS" -> Yahoo 심볼 후보 */
export function symbolCandidates(raw: string, market?: string): string[] {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return [];
  if (/^\d{6}$/.test(s)) {
    const m = String(market ?? "").toUpperCase();
    if (m.includes("KOSDAQ") || m.includes("KONEX") || m === "KQ") return [`${s}.KQ`];
    if (m.includes("KOSPI") || m === "KS" || m === "KR" || m === "KOR") return [`${s}.KS`];
    return [`${s}.KS`, `${s}.KQ`];
  }
  return [s];
}

export function marketOfSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith(".KS")) return "KOSPI";
  if (s.endsWith(".KQ")) return "KOSDAQ";
  return "";
}

export function currencyOfSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith(".KS") || s.endsWith(".KQ")) return "KRW";
  if (s.endsWith(".T")) return "JPY";
  if (s.endsWith(".L")) return "GBP";
  if (s.endsWith(".DE") || s.endsWith(".F") || s.endsWith(".PA") || s.endsWith(".AS")) return "EUR";
  if (s.endsWith(".HK")) return "HKD";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "CNY";
  return "USD";
}

const NAVER_MARKET: Record<string, { market: string; suffix: string }> = {
  KOSPI: { market: "KOSPI", suffix: ".KS" },
  KOSDAQ: { market: "KOSDAQ", suffix: ".KQ" },
  KONEX: { market: "KONEX", suffix: ".KQ" },
};

/** 네이버증권 자동완성 응답 -> 종목 후보 */
export function naverHits(json: unknown): StockHit[] {
  const items = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: StockHit[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const code = typeof it.code === "string" ? it.code.trim() : "";
    const name = typeof it.name === "string" ? it.name.trim() : "";
    const typeCode = typeof it.typeCode === "string" ? it.typeCode.toUpperCase() : "";
    const nation = typeof it.nationCode === "string" ? it.nationCode.toUpperCase() : "";
    if (!code || !name) continue;
    if (nation && nation !== "KOR") continue;
    const m = NAVER_MARKET[typeCode];
    if (!m) continue;
    out.push({
      code,
      name,
      market: m.market,
      symbol: `${code}${m.suffix}`,
      currency: "KRW",
      priceUnit: "원",
      exchange: m.market,
      type: "EQUITY",
      source: "naver",
    });
  }
  return out;
}

const YAHOO_TYPES = new Set(["EQUITY", "ETF", "INDEX", "MUTUALFUND"]);

/** Yahoo Finance 검색 응답 -> 종목 후보 */
export function yahooHits(json: unknown): StockHit[] {
  const quotes = (json as { quotes?: unknown[] } | null)?.quotes;
  if (!Array.isArray(quotes)) return [];
  const out: StockHit[] = [];
  for (const raw of quotes) {
    const q = raw as Record<string, unknown>;
    const symbol = typeof q.symbol === "string" ? q.symbol.trim().toUpperCase() : "";
    const type = typeof q.quoteType === "string" ? q.quoteType.toUpperCase() : "";
    if (!symbol || !YAHOO_TYPES.has(type)) continue;
    if (symbol.endsWith("-USD")) continue; // 암호화폐 파생 티커
    const name =
      (typeof q.longname === "string" && q.longname) ||
      (typeof q.shortname === "string" && q.shortname) ||
      symbol;
    const exchange =
      (typeof q.exchDisp === "string" && q.exchDisp) ||
      (typeof q.exchange === "string" && q.exchange) ||
      "";
    const currency = currencyOfSymbol(symbol);
    out.push({
      code: symbol.replace(/\..*$/, ""),
      name,
      market: marketOfSymbol(symbol) || exchange,
      symbol,
      currency,
      priceUnit: currency === "KRW" ? "원" : currency,
      exchange,
      type,
      source: "yahoo",
    });
  }
  return out;
}

/** 네이버(한국) 먼저, 같은 심볼은 중복 제거 */
export function mergeHits(primary: StockHit[], secondary: StockHit[], limit = 8): StockHit[] {
  const seen = new Set<string>();
  const out: StockHit[] = [];
  for (const hit of [...primary, ...secondary]) {
    const key = hit.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 검색어와 정확히 맞는 종목을 앞으로 올린다.
 * (예: "NVDA" -> NVDA, "005930" -> 005930.KS, "삼성전자" -> 삼성전자)
 */
export function rankHits(hits: StockHit[], query: string): StockHit[] {
  const q = query.trim().toUpperCase();
  if (!q) return hits;
  const score = (h: StockHit): number => {
    const sym = h.symbol.toUpperCase();
    const code = h.code.toUpperCase();
    const name = h.name.toUpperCase();
    if (sym === q) return 0;
    if (code === q) return 1;
    if (sym.startsWith(q + ".") || sym.startsWith(q)) return 2;
    if (name.startsWith(q)) return 3;
    if (name.includes(q)) return 4;
    return 5;
  };
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => score(a.h) - score(b.h) || a.i - b.i)
    .map((x) => x.h);
}

/** 검색어가 ASCII 인지 (Yahoo 검색은 한글 질의를 400으로 거절한다) */
export function isAsciiQuery(q: string): boolean {
  return /^[\x20-\x7E]+$/.test(q);
}
