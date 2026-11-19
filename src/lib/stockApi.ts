import type { Dataset, DatasetMeta, Session } from "./types";

/**
 * 실시간 시세 중계(Supabase Edge Function `stock-bars`) 클라이언트.
 * 중계 서버가 아직 배포 전이거나 네트워크가 막히면 가짜 데이터를 만들지 않고
 * 호출한 쪽이 "대기 중" 상태를 보여줄 수 있도록 StockApiError 를 던진다.
 */

const DEFAULT_ENDPOINT = "https://ntfhdiujapctomzzaifu.supabase.co/functions/v1/stock-bars";

export const STOCK_API_URL: string = (() => {
  const fromEnv = (import.meta.env.VITE_STOCK_API_URL as string | undefined)?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ENDPOINT;
})();

/** 중계 서버에 닿지 못할 때 화면에 그대로 보여주는 문구 */
export const RELAY_OFFLINE_MESSAGE =
  "실시간 시세 서버 연결 대기 중 — 내장 5종목 및 CSV/JSON 붙여넣기는 즉시 사용 가능";

export type StockErrorKind =
  | "offline"
  | "timeout"
  | "not_found"
  | "not_enough"
  | "rate_limited"
  | "upstream"
  | "bad_response";

export class StockApiError extends Error {
  kind: StockErrorKind;
  status?: number;
  code?: string;
  constructor(kind: StockErrorKind, message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "StockApiError";
    this.kind = kind;
    this.status = opts.status;
    this.code = opts.code;
  }
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
  source: string;
}

export interface SearchOutcome {
  results: StockHit[];
  note: string;
}

export interface BarsOutcome {
  dataset: Dataset;
  warnings: string[];
  source: { provider?: string; range?: string; interval?: string; url?: string; host?: string };
}

const TIMEOUT_MS = 15000;

function describeStatus(status: number): StockApiError {
  if (status === 404) {
    return new StockApiError("not_found", "이 종목을 찾지 못했습니다. 종목명·코드·티커를 확인해 주세요.", {
      status,
    });
  }
  if (status === 422) {
    return new StockApiError(
      "not_enough",
      "완전한 거래일이 3일 이상 필요합니다. 신규 상장·거래정지 종목은 5분봉 이력이 모자랄 수 있습니다.",
      { status }
    );
  }
  if (status === 429) {
    return new StockApiError("rate_limited", "시세 서버 요청이 잠시 몰렸습니다. 1분 뒤 다시 시도해 주세요.", {
      status,
    });
  }
  return new StockApiError("upstream", "시세 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.", {
    status,
  });
}

async function callApi(params: URLSearchParams, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  let res: Response;
  try {
    res = await fetch(`${STOCK_API_URL}?${params.toString()}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      mode: "cors",
      cache: "no-store",
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    if (aborted && !signal?.aborted) {
      throw new StockApiError(
        "timeout",
        "실시간 시세 서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요."
      );
    }
    if (aborted) throw e;
    throw new StockApiError(
      "offline",
      "실시간 시세 서버에 연결하지 못했습니다. 서버가 아직 배포되지 않았거나 네트워크가 막혀 있습니다."
    );
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body) {
    // 함수 미배포·게이트웨이 오류는 JSON 이 아니라 HTML/빈 응답으로 온다.
    if (res.status >= 400) {
      throw new StockApiError("offline", RELAY_OFFLINE_MESSAGE, { status: res.status });
    }
    throw new StockApiError(
      "bad_response",
      "시세 서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.",
      { status: res.status }
    );
  }
  if (!res.ok || body.ok === false) {
    const err = (body.error ?? {}) as { code?: string; message?: string };
    if (err.code === "not_found") {
      throw new StockApiError(
        "not_found",
        err.message || "이 종목을 찾지 못했습니다. 종목명·코드·티커를 확인해 주세요.",
        { status: res.status, code: err.code }
      );
    }
    if (!err.code) {
      // Supabase 가 함수를 찾지 못할 때: {"code":"NOT_FOUND","message":"Requested function was not found"}
      const envelope = body as { code?: string; message?: string };
      const gatewayGone =
        res.status === 404 || res.status === 502 || res.status === 503 || envelope.code === "NOT_FOUND";
      if (gatewayGone) {
        throw new StockApiError("offline", RELAY_OFFLINE_MESSAGE, {
          status: res.status,
          code: envelope.code ?? "relay_unavailable",
        });
      }
      throw new StockApiError(
        "upstream",
        envelope.message || "시세 서버가 요청을 처리하지 못했습니다.",
        { status: res.status }
      );
    }
    const fallback = describeStatus(res.status);
    throw new StockApiError(fallback.kind, err.message || fallback.message, {
      status: res.status,
      code: err.code,
    });
  }
  return body;
}

/* ------------------------------------------------------------------ 검색 */

export async function searchStocks(query: string, signal?: AbortSignal): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) return { results: [], note: "" };
  const body = await callApi(new URLSearchParams({ q }), signal);
  const raw = Array.isArray(body.results) ? (body.results as StockHit[]) : [];
  const results = raw
    .filter((r) => r && typeof r.symbol === "string" && r.symbol.length > 0)
    .map((r) => ({
      code: r.code ?? "",
      name: r.name ?? r.symbol,
      market: r.market ?? "",
      symbol: r.symbol,
      currency: r.currency ?? "",
      priceUnit: r.priceUnit ?? (r.currency === "KRW" ? "원" : r.currency ?? ""),
      exchange: r.exchange ?? "",
      type: r.type ?? "",
      source: r.source ?? "",
    }));
  return { results, note: typeof body.note === "string" ? body.note : "" };
}

/* ------------------------------------------------------------------ 봉 */

interface BarsPayload extends Record<string, unknown> {
  id?: string;
  symbol?: string;
  name?: string;
  market?: string;
  currency?: string;
  priceUnit?: string;
  exchangeTimezone?: string;
  meta?: DatasetMeta;
  times?: string[];
  sessions?: Session[];
  warnings?: string[];
  source?: BarsOutcome["source"];
}

export async function fetchStockBars(
  params: { symbol: string; market?: string; name?: string },
  signal?: AbortSignal
): Promise<BarsOutcome> {
  const sp = new URLSearchParams({ symbol: params.symbol });
  if (params.market) sp.set("market", params.market);
  if (params.name) sp.set("name", params.name);
  const body = (await callApi(sp, signal)) as BarsPayload;

  const meta = body.meta;
  const times = body.times;
  const sessions = body.sessions;
  const shaped =
    !!meta &&
    Array.isArray(times) &&
    times.length === meta.sessionBars &&
    Array.isArray(sessions) &&
    sessions.length > 0 &&
    sessions.every(
      (s) => s && typeof s.date === "string" && Array.isArray(s.bars) && s.bars.length === meta.sessionBars
    );

  if (!shaped) {
    throw new StockApiError(
      "bad_response",
      "시세 서버가 앱이 기대한 형식으로 응답하지 않았습니다(세션·봉 규격 불일치). 잠시 후 다시 시도해 주세요."
    );
  }

  const currency = body.currency ?? "";
  const priceUnit =
    body.priceUnit ?? (currency === "KRW" ? "원" : currency ? currency : "");
  const symbol = body.symbol ?? params.symbol;
  const dataset: Dataset = {
    id: body.id ?? `live-${symbol.replace(/[^A-Za-z0-9]+/g, "-")}`,
    symbol,
    name: body.name ?? params.name ?? symbol,
    market: body.market ?? "",
    currency,
    priceUnit,
    exchangeTimezone: body.exchangeTimezone,
    live: true,
    meta: meta as DatasetMeta,
    times: times as string[],
    sessions: sessions as Session[],
  };
  return {
    dataset,
    warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [],
    source: (body.source ?? {}) as BarsOutcome["source"],
  };
}
