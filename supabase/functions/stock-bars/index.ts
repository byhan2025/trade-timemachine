/**
 * Supabase Edge Function — stock-bars (한국형 타임머신 2단계 실시간 시세 중계)
 *
 * 공개 배포: supabase functions deploy stock-bars --no-verify-jwt
 *   (정적 페이지에서 키 없이 부르는 공개 중계라 JWT 검증을 끈다. 비밀키는 쓰지 않는다.)
 *
 * GET  ?q=삼성전자 | ?q=TSLA | ?q=005930
 *   -> 네이버증권 자동완성 + Yahoo Finance 검색 결과를 합쳐 종목 후보를 돌려준다.
 * GET  ?symbol=005930.KS | ?code=005930&market=KR | ?symbol=TSLA
 *   -> Yahoo Finance Chart v8(range=60d&interval=5m) 실제 5분봉을 세션 검증 후
 *      앱이 그대로 쓰는 표준 JSON(meta + times + sessions[].bars)으로 돌려준다.
 *      Yahoo가 5분봉을 주지 않으면 1분봉(7d)을 받아 5분봉으로 합산한다.
 * GET  ?health=1
 *
 * 원칙: 없는 데이터를 만들지 않는다. 실패는 실패로, 이유와 함께 돌려준다.
 */

import {
  buildDataset,
  currencyOfSymbol,
  isAsciiQuery,
  marketOfSymbol,
  mergeHits,
  naverHits,
  rankHits,
  StockBarsError,
  symbolCandidates,
  yahooHits,
} from "./lib.ts";
import type { StockHit, YahooChartResult } from "./lib.ts";

const VERSION = "2.0.0";
const UA =
  "Mozilla/5.0 (compatible; trade-timemachine/2.0; +https://github.com/byhan2025/trade-timemachine)";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};
const YAHOO_HOSTS = ["query2", "query1"];
const TTL_BARS = 60_000;
const TTL_SEARCH = 300_000;

const cache = new Map<string, { exp: number; status: number; body: string }>();

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=30" : "no-store",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url: string, timeoutMs = 9000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new StockBarsError(
      timeout ? "upstream_timeout" : "upstream_network",
      timeout ? "시세 서버 응답이 늦어 시간이 초과됐습니다." : "시세 서버에 연결하지 못했습니다.",
      504
    );
  }
  if (res.status === 404) {
    await res.body?.cancel();
    throw new StockBarsError("not_found", "시세 서버에 해당 종목이 없습니다.", 404);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new StockBarsError(
      res.status === 429 ? "rate_limited" : "upstream_error",
      `시세 서버가 HTTP ${res.status} 로 응답했습니다.`,
      res.status === 429 ? 429 : 502
    );
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new StockBarsError("upstream_bad_json", "시세 서버 응답을 해석하지 못했습니다.", 502);
  }
}

/* --------------------------------------------------------------- Yahoo 차트 */

interface ChartPlan {
  range: string;
  interval: string;
  sec: number;
  aggregated: boolean;
}

interface LoadedChart {
  result: YahooChartResult;
  plan: ChartPlan;
  host: string;
  url: string;
}

const PLANS: ChartPlan[] = [
  { range: "60d", interval: "5m", sec: 300, aggregated: false },
  { range: "7d", interval: "1m", sec: 60, aggregated: true },
];

async function loadChart(symbol: string): Promise<LoadedChart> {
  let sawStatus: StockBarsError | null = null;
  for (const plan of PLANS) {
    for (const host of YAHOO_HOSTS) {
      const url =
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?range=${plan.range}&interval=${plan.interval}`;
      try {
        const data = (await getJson(url)) as {
          chart?: { result?: (YahooChartResult | null)[]; error?: { description?: string } | null };
        };
        const result = data?.chart?.result?.[0];
        if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
          sawStatus = new StockBarsError(
            "not_found",
            data?.chart?.error?.description
              ? `Yahoo: ${data.chart.error.description}`
              : "Yahoo에 이 종목의 차트가 없습니다.",
            404
          );
          continue;
        }
        return { result, plan, host, url };
      } catch (e) {
        if (e instanceof StockBarsError) {
          if (e.code === "not_found") {
            sawStatus = e;
            continue;
          }
          sawStatus = e;
          await sleep(200);
          continue;
        }
        sawStatus = new StockBarsError("upstream_error", "시세 서버 조회에 실패했습니다.", 502);
      }
    }
  }
  if (sawStatus && sawStatus.code === "not_found") {
    throw new StockBarsError(
      "not_found",
      `'${symbol}' 종목을 Yahoo Finance에서 찾지 못했습니다. 티커(예: 005930.KS, TSLA)를 확인해 주세요.`,
      404
    );
  }
  throw (
    sawStatus ??
    new StockBarsError("upstream_error", "시세 서버에서 봉 데이터를 받지 못했습니다.", 502)
  );
}

/** 한국 종목이면 네이버증권에서 한글 종목명을 확인한다 (실패해도 치명적이지 않다) */
async function naverStockName(code: string): Promise<string | null> {
  if (!/^[0-9A-Z]{6}$/i.test(code)) return null;
  try {
    const data = (await getJson(
      `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/integration`,
      5500
    )) as { stockName?: string };
    const name = typeof data?.stockName === "string" ? data.stockName.trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- 핸들러 */

async function handleSearch(q: string): Promise<Record<string, unknown>> {
  const query = q.trim();
  if (!query) {
    throw new StockBarsError("missing_q", "?q= 검색어가 필요합니다 (예: ?q=삼성전자).", 400);
  }
  if (query.length > 60) {
    throw new StockBarsError("query_too_long", "검색어가 너무 깁니다 (60자 이내).", 400);
  }

  const sources: Record<string, string> = {};
  const [naverRes, yahooRes] = await Promise.allSettled([
    getJson(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`, 6000),
    isAsciiQuery(query)
      ? getJson(
          `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}` +
            `&quotesCount=10&newsCount=0`,
          6000
        )
      : Promise.resolve(null),
  ]);

  let naver: StockHit[] = [];
  if (naverRes.status === "fulfilled") {
    try {
      naver = naverHits(naverRes.value);
      sources.naver = "ok";
    } catch {
      sources.naver = "parse-error";
    }
  } else {
    const err = naverRes.reason;
    sources.naver = err instanceof Error ? err.message : "error";
  }

  let yahoo: StockHit[] = [];
  if (!isAsciiQuery(query)) {
    sources.yahoo = "skipped:한글질의";
  } else if (yahooRes.status === "fulfilled") {
    try {
      yahoo = yahooHits(yahooRes.value);
      sources.yahoo = "ok";
    } catch {
      sources.yahoo = "parse-error";
    }
  } else {
    const err = yahooRes.reason;
    sources.yahoo = err instanceof Error ? err.message : "error";
  }

  const results = rankHits(mergeHits(naver, yahoo, 8), query);
  if (!results.length && sources.naver !== "ok" && sources.yahoo !== "ok") {
    throw new StockBarsError(
      "upstream_error",
      "종목 검색 서버(네이버증권·Yahoo)에 모두 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      502
    );
  }
  return {
    ok: true,
    kind: "search",
    version: VERSION,
    query,
    count: results.length,
    results,
    sources,
    note: results.length
      ? "한국 종목은 네이버증권, 미국 티커는 Yahoo Finance 검색 결과입니다. 심볼로 봉을 조회합니다."
      : "검색 결과가 없습니다. 종목명 대신 6자리 코드(예: 005930)나 미국 티커(예: TSLA)로 시도해 보세요.",
  };
}

async function handleBars(params: URLSearchParams): Promise<Record<string, unknown>> {
  const raw = (params.get("symbol") || params.get("code") || params.get("ticker") || "").trim();
  if (!raw) {
    throw new StockBarsError(
      "missing_symbol",
      "?symbol=005930.KS 처럼 종목을 지정해 주세요 (?code=005930&market=KR 도 가능).",
      400
    );
  }
  const market = params.get("market") ?? undefined;
  const candidates = symbolCandidates(raw, market);
  if (!candidates.length) {
    throw new StockBarsError("invalid_symbol", "종목 코드가 비어 있습니다.", 400);
  }

  let lastError: unknown = null;
  for (const symbol of candidates) {
    try {
      const chart = await loadChart(symbol);
      const code = symbol.replace(/\..*$/, "");
      const isKorean = /\.(KS|KQ)$/.test(symbol);
      let name = (params.get("name") ?? "").trim();
      if (!name && isKorean) name = (await naverStockName(code)) ?? "";

      const meta = chart.result.meta ?? {};
      const currency =
        (typeof meta.currency === "string" && meta.currency) || currencyOfSymbol(symbol);
      const marketLabel =
        marketOfSymbol(symbol) ||
        (typeof meta.fullExchangeName === "string" ? meta.fullExchangeName : "") ||
        (typeof meta.exchangeName === "string" ? meta.exchangeName : "") ||
        "Yahoo";
      const fetchedAt = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00");

      const built = buildDataset({
        result: chart.result,
        symbol,
        name,
        market: marketLabel,
        currency,
        intervalSec: chart.plan.sec,
        aggregated: chart.plan.aggregated,
        source: chart.plan.aggregated
          ? "Yahoo Finance Chart API (1분봉 → 5분봉 합산)"
          : "Yahoo Finance Chart API (v8 공개 엔드포인트)",
        sourceUrl: chart.url,
        fetchedAt,
        note: [
          "Yahoo가 제공하는 분봉을 거래일별로 검증해 봉 개수·시작 시각이 정확히 같은 완전 세션만 남겼습니다.",
          "진행 중인 당일 세션과 반장·갭이 있는 날은 제외했고, 제외 목록은 meta.sessionsDropped 에 있습니다.",
          chart.plan.aggregated
            ? "60일 5분봉을 받지 못해 최근 7일 1분봉을 5분봉으로 합산했습니다(세션이 적습니다)."
            : "",
          "개인 연구·참고용 비상업 통계 도구입니다. 투자 권유·매매 신호가 아니며 미래 수익을 보장하지 않습니다.",
        ]
          .filter(Boolean)
          .join(" "),
      });

      const sessions = built.dataset.sessions.length;
      if (sessions < 3) {
        throw new StockBarsError(
          "not_enough_sessions",
          `완전한 거래일이 ${sessions}일뿐입니다. 1만 번 재생에는 3일 이상이 필요합니다 (신규 상장·거래정지 종목은 부족할 수 있습니다).`,
          422
        );
      }

      const warnings: string[] = [];
      if (sessions < 10) {
        warnings.push(
          `완전한 거래일이 ${sessions}일뿐입니다. 표본이 적어 확률 해석에 주의가 필요합니다.`
        );
      }
      if (chart.plan.aggregated) {
        warnings.push("60일 5분봉 대신 최근 1분봉을 5분봉으로 합산했습니다.");
      }

      return {
        ok: true,
        kind: "bars",
        version: VERSION,
        requested: { input: raw, market: market ?? null, resolvedSymbol: symbol },
        source: {
          provider: "Yahoo Finance",
          host: chart.host,
          range: chart.plan.range,
          interval: chart.plan.interval,
          aggregated: chart.plan.aggregated,
          url: chart.url,
        },
        warnings,
        // 이하가 앱이 그대로 읽는 표준 JSON (meta + times + sessions[].bars)
        id: built.dataset.id,
        symbol: built.dataset.symbol,
        name: built.dataset.name,
        market: built.dataset.market,
        currency: built.dataset.currency,
        priceUnit: built.dataset.priceUnit,
        exchangeTimezone: built.dataset.exchangeTimezone,
        live: true,
        meta: built.dataset.meta,
        times: built.dataset.times,
        sessions: built.dataset.sessions,
      };
    } catch (e) {
      lastError = e;
      if (e instanceof StockBarsError && e.code === "not_found") continue;
      throw e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new StockBarsError("not_found", "종목을 찾지 못했습니다.", 404);
}

/* ------------------------------------------------------------- 라우팅 */

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return jsonResponse(
      { ok: false, kind: "error", version: VERSION, error: { code: "method_not_allowed", message: "GET 요청만 지원합니다." } },
      405,
      { allow: "GET, HEAD, OPTIONS" }
    );
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  try {
    if (params.has("health")) {
      return jsonResponse({
        ok: true,
        kind: "health",
        version: VERSION,
        now: new Date().toISOString(),
        endpoints: { search: "?q=삼성전자|TSLA|005930", bars: "?symbol=005930.KS|?code=005930&market=KR" },
      });
    }

    const key = url.pathname + "?" + params.toString();
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.exp > now) {
      return new Response(hit.body, {
        status: hit.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-cache": "hit",
          ...CORS_HEADERS,
        },
      });
    }

    let body: Record<string, unknown>;
    let ttl = TTL_SEARCH;
    if (params.has("q")) {
      body = await handleSearch(params.get("q") ?? "");
    } else if (params.has("symbol") || params.has("code") || params.has("ticker")) {
      body = await handleBars(params);
      ttl = TTL_BARS;
    } else {
      return jsonResponse({
        ok: true,
        kind: "help",
        version: VERSION,
        usage: {
          search: `${url.origin}${url.pathname}?q=삼성전자`,
          searchUs: `${url.origin}${url.pathname}?q=TSLA`,
          barsKr: `${url.origin}${url.pathname}?symbol=005930.KS`,
          barsCode: `${url.origin}${url.pathname}?code=005930&market=KR`,
          barsUs: `${url.origin}${url.pathname}?symbol=TSLA`,
        },
      });
    }

    const text = JSON.stringify(body);
    if (text.length < 900_000) {
      if (cache.size > 40) cache.clear();
      cache.set(key, { exp: now + ttl, status: 200, body: text });
    }
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${Math.round(ttl / 1000)}`,
        "x-cache": "miss",
        ...CORS_HEADERS,
      },
    });
  } catch (e) {
    const err =
      e instanceof StockBarsError
        ? e
        : new StockBarsError("internal_error", "중계 서버에서 알 수 없는 오류가 났습니다.", 500);
    if (err.code === "internal_error" && e instanceof Error) {
      console.error("stock-bars failure:", e.message);
    }
    return jsonResponse(
      {
        ok: false,
        kind: "error",
        version: VERSION,
        requested: Object.fromEntries(params.entries()),
        error: { code: err.code, message: err.message },
      },
      err.status
    );
  }
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? "8000");
  Deno.serve({ port }, handleRequest);
}
