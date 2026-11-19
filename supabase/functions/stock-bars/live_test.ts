/**
 * stock-bars 실서비스 통합 테스트 — 실제 네이버증권·Yahoo Finance에 붙는다.
 *
 *   deno test --allow-net --allow-read supabase/functions/stock-bars/live_test.ts
 *
 * 검증: CORS 프리플라이트, 검색(한글/티커/코드), 봉 조회(국장·미장), 오류 응답, 캐시.
 */

import { handleRequest } from "./index.ts";

function fail(msg: string): never {
  throw new Error(msg);
}
function ok(value: unknown, msg: string) {
  if (!value) fail(msg);
}
function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}
function gte(actual: number, min: number, msg = "") {
  if (!(actual >= min)) fail(`${msg} (expected >= ${min}, got ${actual})`);
}

Deno.test({
  name: "실제 네이버·Yahoo를 붙인 stock-bars 중계 (CORS·검색·봉·오류·캐시)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, handleRequest);
    const port = (server.addr as Deno.NetAddr).port;
    const base = `http://127.0.0.1:${port}/stock-bars`;

    try {
      /* ---------------------------------------------------- CORS */
      const pre = await fetch(base, { method: "OPTIONS", headers: { Origin: "https://byhan2025.github.io" } });
      await pre.body?.cancel();
      eq(pre.status, 204, "OPTIONS 204");
      eq(pre.headers.get("access-control-allow-origin"), "*", "ACAO *");
      ok((pre.headers.get("access-control-allow-methods") ?? "").includes("GET"), "GET 허용");

      const post = await fetch(base, { method: "POST" });
      const postBody = await post.json();
      eq(post.status, 405, "POST 거절");
      eq(post.headers.get("access-control-allow-origin"), "*", "오류에도 CORS 헤더");
      eq(postBody.error.code, "method_not_allowed");

      /* ---------------------------------------------------- health */
      const health = await fetch(`${base}?health=1`);
      const healthBody = await health.json();
      eq(health.status, 200);
      eq(healthBody.kind, "health");
      eq(healthBody.ok, true);

      /* ---------------------------------------------------- 검색: 한글 */
      const t0 = Date.now();
      const kr = await fetch(`${base}?q=${encodeURIComponent("삼성전자")}`);
      const krBody = await kr.json();
      const krMs = Date.now() - t0;
      eq(kr.status, 200, "한글 검색 200");
      eq(krBody.kind, "search");
      eq(krBody.results[0].symbol, "005930.KS", "삼성전자 -> 005930.KS");
      eq(krBody.results[0].name, "삼성전자");
      eq(krBody.results[0].market, "KOSPI");
      eq(krBody.sources.naver, "ok");
      eq(krBody.sources.yahoo, "skipped:한글질의", "Yahoo는 한글 질의를 400으로 거절하므로 건너뜀");
      console.log(`  검색(삼성전자): ${krBody.results.length}건 ${krMs}ms`);

      /* ---------------------------------------------------- 검색: 코스닥 */
      const kq = await (await fetch(`${base}?q=${encodeURIComponent("에코프로")}`)).json();
      const eco = kq.results.find((r: { name: string }) => r.name === "에코프로");
      ok(eco, "에코프로 검색됨");
      eq(eco.symbol, "086520.KQ", "코스닥 접미사 KQ");

      /* ---------------------------------------------------- 검색: 미국 티커 */
      const us = await (await fetch(`${base}?q=NVDA`)).json();
      eq(us.results[0].symbol, "NVDA");
      eq(us.results[0].currency, "USD");
      eq(us.sources.yahoo, "ok");

      /* ---------------------------------------------------- 검색: 코드 */
      const byCode = await (await fetch(`${base}?q=005930`)).json();
      eq(byCode.results[0].symbol, "005930.KS");

      /* ---------------------------------------------------- 오류: q 없음 */
      const noQ = await fetch(`${base}?q=`);
      const noQBody = await noQ.json();
      eq(noQ.status, 400);
      eq(noQBody.error.code, "missing_q");
      eq(noQ.headers.get("access-control-allow-origin"), "*");

      /* ---------------------------------------------------- 봉: 국장 */
      const t1 = Date.now();
      const krBarsRes = await fetch(`${base}?symbol=005930.KS`);
      const krBars = await krBarsRes.json();
      const krBarsMs = Date.now() - t1;
      eq(krBarsRes.status, 200, "국장 봉 200");
      eq(krBars.kind, "bars");
      eq(krBars.symbol, "005930.KS");
      eq(krBars.name, "삼성전자", "네이버에서 한글 종목명 보강");
      eq(krBars.currency, "KRW");
      eq(krBars.priceUnit, "원");
      eq(krBars.meta.sessionBars, 72);
      eq(krBars.times.length, 72);
      eq([krBars.times[0], krBars.times[71]], ["09:00", "14:55"]);
      eq([krBars.meta.sessionStart, krBars.meta.sessionEnd], ["09:00", "15:00"]);
      gte(krBars.sessions.length, 20, "완전 세션 20일 이상");
      eq(krBars.meta.sessionsUsed, krBars.sessions.length);
      ok(Array.isArray(krBars.meta.sessionsDropped), "제외 세션 기록");
      ok(
        krBars.sessions.every(
          (s: { bars: number[][] }) => s.bars.length === 72 && s.bars.every((b) => b.length === 5 && b.every((x) => typeof x === "number" && isFinite(x)))
        ),
        "모든 세션이 72봉 × OHLCV 유한수"
      );
      ok(krBars.meta.note.includes("완전 세션"), "비고에 세션 검증 명시");
      ok(krBars.meta.note.includes("비상업"), "비상업 안내 포함");
      console.log(
        `  봉(005930.KS): ${krBars.sessions.length}세션 × ${krBars.meta.sessionBars}봉 ` +
          `${krBars.meta.firstDate}~${krBars.meta.lastDate} ${krBarsMs}ms ` +
          `${(JSON.stringify(krBars).length / 1024).toFixed(0)}KB`
      );

      /* ---------------------------------------------------- 캐시 */
      const again = await fetch(`${base}?symbol=005930.KS`);
      await again.body?.cancel();
      eq(again.headers.get("x-cache"), "hit", "두 번째 요청은 캐시");
      eq(again.status, 200);

      /* ---------------------------------------------------- 봉: 코드+시장 */
      const kqBars = await (await fetch(`${base}?code=086520&market=KOSDAQ`)).json();
      eq(kqBars.symbol, "086520.KQ", "코드+시장 -> 심볼 해석");
      eq(kqBars.market, "KOSDAQ");
      gte(kqBars.sessions.length, 20);

      /* ---------------------------------------------------- 봉: 미장 */
      const usBars = await (await fetch(`${base}?symbol=TSLA`)).json();
      eq(usBars.symbol, "TSLA");
      eq(usBars.currency, "USD");
      eq(usBars.meta.sessionBars, 78);
      eq([usBars.times[0], usBars.times[77]], ["09:30", "15:55"]);
      eq(usBars.meta.sessionEnd, "16:00");
      gte(usBars.sessions.length, 20);

      /* ---------------------------------------------------- 봉: ETF */
      const etf = await fetch(`${base}?symbol=QQQ`);
      const etfBody = await etf.json();
      eq(etf.status, 200, "QQQ 200");
      gte(etfBody.sessions.length, 20, "QQQ 세션");
      eq(etfBody.currency, "USD");

      /* ---------------------------------------------------- 오류: 없는 티커 */
      const missing = await fetch(`${base}?symbol=ZZZZNOTREAL`);
      const missingBody = await missing.json();
      eq(missing.status, 404, "없는 티커 404");
      eq(missingBody.ok, false);
      eq(missingBody.error.code, "not_found");
      ok(missingBody.error.message.includes("찾지 못했"), "사람이 읽을 수 있는 안내");

      /* ---------------------------------------------------- 오류: 파라미터 없음 */
      const none = await fetch(`${base}?symbol=`);
      eq(none.status, 400);
      eq((await none.json()).error.code, "missing_symbol");

      /* ---------------------------------------------------- 안내 */
      const help = await (await fetch(base)).json();
      eq(help.kind, "help");
      ok(help.usage.barsKr.includes("?symbol="), "사용법 안내");
    } finally {
      await server.shutdown();
    }
  },
});
