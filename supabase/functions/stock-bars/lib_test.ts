/**
 * stock-bars 순수 로직 단위 테스트 — 실제 네이버/Yahoo 응답을 캡처한 fixtures 사용
 *
 *   deno test --allow-read supabase/functions/stock-bars/lib_test.ts
 */

import {
  aggregateRows,
  buildDataset,
  detectSessions,
  extractRows,
  isAsciiQuery,
  localParts,
  mergeHits,
  naverHits,
  rankHits,
  StockBarsError,
  symbolCandidates,
  yahooHits,
} from "./lib.ts";
import type { Row, YahooChartResult } from "./lib.ts";

const FIX = new URL("./fixtures/", import.meta.url);

function fail(msg: string): never {
  throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}
function ok(value: unknown, msg: string) {
  if (!value) fail(msg);
}
function near(actual: number, expected: number, tol: number, msg = "") {
  if (!(Math.abs(actual - expected) <= tol)) fail(`${msg} (expected ${expected} ± ${tol}, got ${actual})`);
}

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(new URL(name, FIX)));
}

function chartResult(json: unknown): YahooChartResult {
  return (json as { chart: { result: YahooChartResult[] } }).chart.result[0];
}

/* ---------------------------------------------------------------- 시간 */

Deno.test("localParts: 거래소 현지 날짜·분 (KST·ET·UTC)", () => {
  // 2026-11-19 09:00 KST = 2026-11-19 00:00 UTC
  const kst = Math.floor(Date.parse("2026-11-19T00:00:00Z") / 1000);
  eq(localParts(kst, "Asia/Seoul"), { date: "2026-11-19", minutes: 540 }, "KST 09:00");
  eq(localParts(kst, "UTC"), { date: "2026-11-19", minutes: 0 }, "UTC 00:00");
  // 미국 동부 서머타임 종료(11월) 이후: 09:30 ET = 14:30 UTC
  const et = Math.floor(Date.parse("2026-11-18T14:30:00Z") / 1000);
  eq(localParts(et, "America/New_York"), { date: "2026-11-18", minutes: 570 }, "ET 09:30");
  // 잘못된 시간대는 UTC로 떨어진다
  eq(localParts(kst, "Not/AZone"), { date: "2026-11-19", minutes: 0 }, "fallback UTC");
});

Deno.test("isAsciiQuery: 한글 질의는 Yahoo 검색에서 건너뛴다", () => {
  eq(isAsciiQuery("삼성전자"), false);
  eq(isAsciiQuery("TSLA"), true);
  eq(isAsciiQuery("005930.KS"), true);
  eq(isAsciiQuery("삼성 전자"), false);
});

/* ---------------------------------------------------------------- 검색 */

Deno.test("naverHits: 삼성전자 자동완성 -> KOSPI 005930.KS", async () => {
  const hits = naverHits(await fixture("naver-ac-samsung.json"));
  ok(hits.length > 0, "결과가 있어야 한다");
  eq(hits[0], {
    code: "005930",
    name: "삼성전자",
    market: "KOSPI",
    symbol: "005930.KS",
    currency: "KRW",
    priceUnit: "원",
    exchange: "KOSPI",
    type: "EQUITY",
    source: "naver",
  });
  ok(
    hits.every((h) => h.currency === "KRW" && h.symbol.endsWith(".KS")),
    "코스피 종목은 전부 .KS"
  );
});

Deno.test("naverHits: 에코프로(KOSDAQ) -> 086520.KQ", async () => {
  const hits = naverHits(await fixture("naver-ac-ecopro.json"));
  eq(hits[0].symbol, "086520.KQ", "코스닥 접미사");
  eq(hits[0].market, "KOSDAQ", "시장 라벨");
  const daum = hits.find((h) => h.name === "에코프로비엠");
  ok(daum, "에코프로비엠도 나와야 한다");
  eq(daum!.symbol, "247540.KQ");
});

Deno.test("naverHits: 6자리 코드 검색 -> 단일 종목", async () => {
  const hits = naverHits(await fixture("naver-ac-005930.json"));
  eq(hits.map((h) => h.symbol), ["005930.KS"]);
});

Deno.test("yahooHits: TSLA -> NASDAQ / USD, 파생·암호화폐 제외", async () => {
  const hits = yahooHits(await fixture("yahoo-search-TSLA.json"));
  eq(hits[0].symbol, "TSLA");
  eq(hits[0].market, "NASDAQ");
  eq(hits[0].currency, "USD");
  ok(
    hits.every((h) => !h.symbol.endsWith("-USD")),
    "005930-USD 같은 암호화폐 파생 티커는 제외"
  );
});

Deno.test("yahooHits: 005930 -> 005930.KS 이고 암호화폐 항목은 빠진다", async () => {
  const hits = yahooHits(await fixture("yahoo-search-005930.json"));
  eq(hits.map((h) => h.symbol), ["005930.KS"]);
  eq(hits[0].currency, "KRW");
});

Deno.test("mergeHits: 같은 심볼은 네이버(한글명) 우선, 중복 제거", () => {
  const naver = naverHits({
    items: [{ code: "005930", name: "삼성전자", typeCode: "KOSPI", nationCode: "KOR" }],
  });
  const yahoo = yahooHits({
    quotes: [
      { symbol: "005930.KS", longname: "Samsung Electronics Co., Ltd.", quoteType: "EQUITY", exchDisp: "Korea" },
      { symbol: "NVDA", shortname: "NVIDIA Corporation", quoteType: "EQUITY", exchDisp: "NASDAQ" },
    ],
  });
  const merged = mergeHits(naver, yahoo, 8);
  eq(merged.map((h) => h.symbol), ["005930.KS", "NVDA"], "중복 제거·순서");
  eq(merged[0].name, "삼성전자", "네이버 한글명 유지");
  eq(mergeHits(naver, yahoo, 1).length, 1, "limit 적용");
});

Deno.test("rankHits: 입력어와 정확히 맞는 종목을 앞으로", async () => {
  const hits = yahooHits(await fixture("yahoo-search-NVDA.json"));
  eq(rankHits(hits, "NVDA")[0].symbol, "NVDA", "티커 정확 일치");
  // 2배 레버리지 ETF가 섞여 있어도 정확 일치가 1번
  ok(rankHits(hits, "NVDA")[0].name.includes("NVIDIA"), "이름도 NVIDIA");
  const kr = naverHits(await fixture("naver-ac-samsung.json"));
  eq(rankHits(kr, "삼성전자")[0].name, "삼성전자", "한글 이름 정확 일치");
  ok(
    rankHits(kr, "삼성전자")[0].name === "삼성전자" &&
      rankHits(kr, "삼성전자")[1]?.name !== "삼성전자",
    "파생 상품은 뒤로"
  );
  const byCode = naverHits(await fixture("naver-ac-005930.json"));
  eq(rankHits(byCode, "005930")[0].symbol, "005930.KS", "코드 일치");
  eq(rankHits(hits, "").length, hits.length, "빈 질의는 순서 유지");
});

Deno.test("symbolCandidates: 코드 + 시장 -> Yahoo 심볼 후보", () => {
  eq(symbolCandidates("005930"), ["005930.KS", "005930.KQ"], "시장 미지정 시 두 시장 시도");
  eq(symbolCandidates("005930", "KOSDAQ"), ["005930.KQ"]);
  eq(symbolCandidates("086520", "KR"), ["086520.KS"]);
  eq(symbolCandidates("tsla"), ["TSLA"]);
  eq(symbolCandidates(" 005930.ks "), ["005930.KS"]);
  eq(symbolCandidates(""), []);
});

/* ---------------------------------------------------------------- 봉 세션 */

Deno.test("extractRows: null 가격·격자 밖 타임스탬프를 세어 제외한다", () => {
  const result: YahooChartResult = {
    meta: { exchangeTimezoneName: "Asia/Seoul" },
    timestamp: [
      Math.floor(Date.parse("2026-11-19T00:00:00Z") / 1000), // 09:00 KST 정상
      Math.floor(Date.parse("2026-11-19T00:07:00Z") / 1000), // 09:07 격자 밖
      Math.floor(Date.parse("2026-11-19T00:10:00Z") / 1000), // 09:10 가격 결손
      Math.floor(Date.parse("2026-11-19T00:15:00Z") / 1000), // 09:15 정상
    ],
    indicators: {
      quote: [
        {
          open: [1, 2, null, 4],
          high: [1, 2, 3, 4],
          low: [1, 2, 3, 4],
          close: [1, 2, 3, 4],
          volume: [10, 20, 30, 40],
        },
      ],
    },
  };
  const out = extractRows(result, 300);
  eq(out.rows.length, 2, "정상 봉 2개");
  eq(out.rows.map((r) => r.minutes), [540, 555], "KST 봉 시작 분");
  eq(out.dropped, { noPrice: 1, offGrid: 1 });
  eq(out.tz, "Asia/Seoul");
});

Deno.test("aggregateRows: 1분봉 5개 -> 5분봉 (시가 첫·종가 마지막·거래량 합)", () => {
  const rows: Row[] = [0, 1, 2, 3, 4].map((i) => ({
    date: "2026-11-18",
    minutes: 570 + i,
    o: 100 + i,
    h: 110 + i,
    l: 90 - i,
    c: 105 + i,
    v: 10,
  }));
  const out = aggregateRows(rows, 5);
  eq(out.length, 1);
  eq(out[0], { date: "2026-11-18", minutes: 570, o: 100, h: 114, l: 86, c: 109, v: 50 });
});

Deno.test("detectSessions: 빈 입력·짧은 세션은 코드와 함께 거절한다", () => {
  try {
    detectSessions([]);
    fail("예외가 필요하다");
  } catch (e) {
    ok(e instanceof StockBarsError, "StockBarsError");
    eq((e as StockBarsError).code, "no_bars");
  }
  const thin: Row[] = [0, 1, 2].map((i) => ({ date: "2026-11-18", minutes: 540 + i * 5, o: 1, h: 1, l: 1, c: 1, v: 1 }));
  try {
    detectSessions(thin);
    fail("예외가 필요하다");
  } catch (e) {
    eq((e as StockBarsError).code, "short_session");
    eq((e as StockBarsError).status, 422);
  }
});

Deno.test("buildDataset: 005930.KS 실제 5분봉 — 72봉 09:00~15:00, 부분 세션 제외", async () => {
  const result = chartResult(await fixture("yahoo-chart-005930-KS.json"));
  const { dataset, dropped } = buildDataset({
    result,
    symbol: "005930.KS",
    name: "삼성전자",
    market: "KOSPI",
    intervalSec: 300,
    source: "Yahoo Finance Chart API (v8 공개 엔드포인트)",
    sourceUrl: "https://query2.finance.yahoo.com/v8/finance/chart/005930.KS?range=60d&interval=5m",
    fetchedAt: "2026-11-20T00:30:00+09:00",
    note: "완전 세션만 사용했습니다.",
  });
  eq(dataset.sessions.length, 3, "완전 세션 수");
  eq(dataset.meta.sessionBars, 72);
  eq(dataset.times.length, 72);
  eq([dataset.times[0], dataset.times[71]], ["09:00", "14:55"], "봉 시작 시각");
  eq([dataset.meta.sessionStart, dataset.meta.sessionEnd], ["09:00", "15:00"]);
  eq(dropped, [{ date: "2026-11-13", bars: 61 }, { date: "2026-11-19", bars: 61 }], "부분 세션 제외 기록");
  eq(dataset.meta.firstDate, "2026-11-16");
  eq(dataset.meta.lastDate, "2026-11-18");
  eq([dataset.currency, dataset.priceUnit], ["KRW", "원"]);
  eq(dataset.market, "KOSPI");
  eq(dataset.name, "삼성전자", "넘긴 한글 종목명 우선");
  eq(dataset.live, true);
  eq(dataset.exchangeTimezone, "Asia/Seoul");
  ok(
    dataset.sessions.every((s) => s.bars.length === 72 && s.bars.every((b) => b.length === 5)),
    "모든 세션이 72봉 × OHLCV 5개"
  );
  const first = dataset.sessions[0].bars[0];
  ok(first[1] >= first[3] && first[2] <= first[0], "고가≥종가, 저가≤시가");
  eq(dataset.meta.note, "완전 세션만 사용했습니다.", "비고 문구 전달");
});

Deno.test("buildDataset: TSLA 실제 5분봉 — 78봉 09:30~16:00", async () => {
  const result = chartResult(await fixture("yahoo-chart-TSLA.json"));
  const { dataset } = buildDataset({
    result,
    symbol: "TSLA",
    intervalSec: 300,
    source: "Yahoo Finance Chart API (v8 공개 엔드포인트)",
    sourceUrl: "https://query2.finance.yahoo.com/v8/finance/chart/TSLA?range=60d&interval=5m",
    fetchedAt: "2026-11-20T00:30:00+09:00",
  });
  eq(dataset.sessions.length, 4);
  eq(dataset.meta.sessionBars, 78);
  eq([dataset.times[0], dataset.times[77]], ["09:30", "15:55"]);
  eq(dataset.meta.sessionEnd, "16:00");
  eq(dataset.currency, "USD");
  eq(dataset.exchangeTimezone, "America/New_York");
  ok(dataset.name.length > 0, "이름이 비면 안 된다");
});

Deno.test("buildDataset: 1분봉 -> 5분봉 합산 폴백도 같은 규격을 만든다", async () => {
  const result = chartResult(await fixture("yahoo-chart-TSLA-1m.json"));
  const { dataset } = buildDataset({
    result,
    symbol: "TSLA",
    intervalSec: 60,
    aggregated: true,
    source: "Yahoo Finance Chart API (1분봉 → 5분봉 합산)",
    sourceUrl: "https://query2.finance.yahoo.com/v8/finance/chart/TSLA?range=7d&interval=1m",
    fetchedAt: "2026-11-20T00:30:00+09:00",
  });
  eq(dataset.sessions.length, 2, "완전 세션 2일");
  eq(dataset.meta.sessionBars, 78);
  eq([dataset.times[0], dataset.meta.sessionStart], ["09:30", "09:30"]);
  ok(dataset.meta.interval.includes("1분봉을 5분으로"), "합산 표기");
  const bars = dataset.sessions[0].bars;
  ok(bars.every((b) => b.every((x) => x != null && isFinite(x))), "모든 값이 유한수");
  near(bars[0][0], 382.28, 0.01, "1분봉 5개의 시가 합산(=첫 1분봉 시가)");
  near(bars[0][1], 382.4, 0.01, "고가 = 1분봉 최대");
  near(bars[0][2], 378.94, 0.01, "저가 = 1분봉 최소");
  near(bars[0][3], 381.26, 0.01, "종가 = 마지막 1분봉 종가");
  eq(bars[0][4], 1267726, "거래량 = 1분봉 5개 합");
  eq(dataset.sessions[0].date, "2026-11-17", "첫 완전 세션");
});
