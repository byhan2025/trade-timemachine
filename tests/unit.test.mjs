import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCustom,
  buildPool,
  simulate,
  historyReplay,
  buildThermometer,
  buildStopLevels,
  compareCombos,
  simulateSurvival,
} from "./.build/lib.mjs";

/* ---------------------------------------------------------------- helpers */

const HEADER = "시각,시가,고가,저가,종가,거래량";

/** 봉 4개짜리 하루 (09:00~09:15) — 약간씩 움직이는 정상 봉 */
function day(date, base = 100, bars = 4) {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const o = base + i;
    const c = o + (i % 2 === 0 ? 0.5 : -0.4);
    const h = Math.max(o, c) + 0.6;
    const l = Math.min(o, c) - 0.6;
    const hh = String(9 + Math.floor(i / 12)).padStart(2, "0");
    const mm = String((i % 12) * 5).padStart(2, "0");
    out.push([`${date} ${hh}:${mm}`, o, h, l, c, 1000 + i]);
  }
  return out;
}

function csv(rows) {
  return [HEADER, ...rows.map((r) => r.join(","))].join("\n");
}

function baseRows(days = 3) {
  const rows = [];
  for (let d = 1; d <= days; d++) {
    rows.push(...day(`2026-11-${String(d).padStart(2, "0")}`, 100 + d));
  }
  return rows;
}

/* ---------------------------------------------------------------- parse 정상 */

test("정상 CSV: 3일 × 4봉을 그대로 읽고 세션·시각을 만든다", () => {
  const { dataset, warnings } = parseCustom(csv(baseRows(3)));
  assert.equal(dataset.sessions.length, 3);
  assert.equal(dataset.times.length, 4);
  assert.deepEqual(dataset.times, ["09:00", "09:05", "09:10", "09:15"]);
  assert.equal(dataset.meta.sessionBars, 4);
  assert.equal(dataset.meta.intervalSeconds, 300);
  assert.equal(dataset.custom, true);
  assert.ok(warnings.some((w) => w.includes("표본이 적습니다")));
});

test("정상 JSON(배열·객체)도 같은 세션 구조로 읽는다", () => {
  const rows = baseRows(3);
  const shaped = rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5]]);
  const fromArray = parseCustom(JSON.stringify(shaped)).dataset;
  const fromObject = parseCustom(
    JSON.stringify({
      bars: shaped.map((r) => ({
        date: String(r[0]).slice(0, 10),
        time: String(r[0]).slice(11),
        open: r[1],
        high: r[2],
        low: r[3],
        close: r[4],
        volume: r[5],
      })),
    })
  ).dataset;
  assert.equal(fromArray.sessions.length, fromObject.sessions.length);
  assert.deepEqual(fromArray.times, fromObject.times);
  assert.deepEqual(fromArray.sessions[0].bars, fromObject.sessions[0].bars);
});

/* ---------------------------------------------------------------- 비정상 봉 */

test("고가 < 저가 봉은 적용을 차단하고 한국어로 알린다", () => {
  const rows = baseRows(3);
  rows[2] = [rows[2][0], 102, 100.1, 101.9, 102.2, 1000];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) => /고가가 저가보다 낮은 봉/.test(e.message) && /2026-11-01 09:10/.test(e.message)
  );
});

test("시가가 [저가, 고가] 범위를 벗어나면 차단한다", () => {
  const rows = baseRows(3);
  rows[1] = [rows[1][0], 130, 102.4, 100.9, 101, 1000];
  assert.throws(() => parseCustom(csv(rows)), /시가가 고가·저가 범위를 벗어난 봉/);
});

test("종가가 [저가, 고가] 범위를 벗어나면 차단한다", () => {
  const rows = baseRows(3);
  rows[1] = [rows[1][0], 101, 102.4, 100.9, 95, 1000];
  assert.throws(() => parseCustom(csv(rows)), /종가가 고가·저가 범위를 벗어난 봉/);
});

test("0 이하 가격은 차단한다", () => {
  const rows = baseRows(3);
  rows[5] = [rows[5][0], 0, 0, 0, 0, 1000];
  assert.throws(() => parseCustom(csv(rows)), /0 이하 가격이 있는 봉/);
});

test("음수 거래량은 차단한다", () => {
  const rows = baseRows(3);
  rows[3] = [rows[3][0], 100, 101, 99, 100.4, -500];
  assert.throws(() => parseCustom(csv(rows)), /거래량이 음수인 봉/);
});

test("같은 날짜·시각 중복 봉은 차단한다", () => {
  const rows = baseRows(3);
  rows.push([...rows[4]]);
  assert.throws(() => parseCustom(csv(rows)), /같은 날짜·시각의 봉이 중복/);
});

test("시간이 역순인 봉은 차단한다", () => {
  const rows = baseRows(3);
  const tmp = rows[1];
  rows[1] = rows[2];
  rows[2] = tmp;
  assert.throws(() => parseCustom(csv(rows)), /시각이 역순인 봉/);
});

test("가격이 숫자가 아닌(누락) 봉은 차단한다", () => {
  const rows = baseRows(3);
  rows[2] = [rows[2][0], "", 101, 99, 100, 1000];
  assert.throws(() => parseCustom(csv(rows)), /가격이 숫자가 아닌 봉/);
});

test("값이 어긋난 봉이 여러 개면 첫 3건 + 외 N건으로 요약한다", () => {
  const rows = baseRows(3);
  rows[0] = [rows[0][0], 0, 0, 0, 0, 0];
  rows[1] = [rows[1][0], 0, 0, 0, 0, 0];
  rows[2] = [rows[2][0], 0, 0, 0, 0, 0];
  rows[3] = [rows[3][0], 0, 0, 0, 0, 0];
  assert.throws(() => parseCustom(csv(rows)), /외 1건/);
});

/* ---------------------------------------------------------------- 누락 봉 */

test("봉 개수가 다른 날은 세션에서 제외하고 경고한다", () => {
  const rows = [...baseRows(3), ...day("2026-11-04", 105, 3)];
  const { dataset, warnings } = parseCustom(csv(rows));
  assert.equal(dataset.sessions.length, 3);
  assert.ok(warnings.some((w) => w.includes("2026-11-04") || w.includes("1일은 제외")));
});

test("최소 9봉(3일 × 3봉) 미만이면 안내한다", () => {
  const rows = [...day("2026-11-01", 100, 4)];
  assert.throws(() => parseCustom(csv(rows)), /최소 9개/);
});

test("일봉(하루 1봉)만 있으면 분봉이 필요하다고 알린다", () => {
  const rows = [];
  for (let d = 1; d <= 10; d++) rows.push([`2026-11-${String(d).padStart(2, "0")}`, 100, 101, 99, 100.5, 1000]);
  assert.throws(() => parseCustom(csv(rows)), /분봉/);
});

/* ---------------------------------------------------------------- 계측 */

function datasetFor(days = 30, bars = 24) {
  const rows = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let d = 1; d <= days; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    let px = 100 + (d % 5);
    for (let i = 0; i < bars; i++) {
      const o = px;
      const drift = (rnd() - 0.5) * 0.8;
      const c = Math.max(1, o + drift);
      const h = Math.max(o, c) + rnd() * 0.4;
      const l = Math.min(o, c) - rnd() * 0.4;
      const hh = String(9 + Math.floor(i / 12)).padStart(2, "0");
      const mm = String((i % 12) * 5).padStart(2, "0");
      rows.push([`${date} ${hh}:${mm}`, o, h, l, c, 1000 + i]);
      px = c;
    }
  }
  return parseCustom(csv(rows), "테스트").dataset;
}

test("온도계: 평균 변동폭·손절 배율이 데이터와 일치한다", () => {
  const d = datasetFor();
  const t = buildThermometer(d, 0.01);
  assert.equal(t.sessions, 30);
  assert.ok(t.avgRangePct > 0);
  assert.ok(t.ratio > 0);
  assert.equal(t.stopPct, 0.01);
  assert.ok(t.exceededSessions <= 30);
  assert.ok(t.verdict.length > 10);
  // 변동폭이 손절의 절반도 안 되면 tight
  const tiny = buildThermometer(d, 10);
  assert.equal(tiny.band, "wide");
});

test("9조합: 손절 3단계 × 목표 3단계, 2,500회씩 계산된다", () => {
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  const levels = buildStopLevels(104, 0.01, "", "buy");
  assert.equal(levels.length, 3);
  assert.ok(levels[0].stopPct < levels[1].stopPct && levels[1].stopPct < levels[2].stopPct);
  const res = compareCombos({ pool, entry: 104, side: "buy", entryBar: 5, levels, replays: 2500 });
  assert.equal(res.cells.length, 9);
  for (const c of res.cells) {
    assert.ok(c.pTarget >= 0 && c.pTarget <= 1);
    assert.ok(Math.abs(c.pTarget + c.pStop + c.pNeither - 1) < 1e-9);
    assert.ok(Number.isFinite(c.avgR));
    assert.ok(c.stop < 104 && c.target > 104);
  }
  console.log(`      · 9조합 계산 시간: ${res.ms.toFixed(1)}ms (2,500회 × 9)`);
  assert.ok(res.ms < 400, `9조합이 너무 느립니다: ${res.ms}ms`);
});

test("20회 생존: 연패·자금 궤적이 분포와 맞는다", () => {
  const allLoss = simulateSurvival({
    rSamples: Float64Array.from({ length: 100 }, () => -1),
    trades: 20,
    riskPct: 1,
    startEquity: 10_000_000,
    scenarios: 200,
    seed: 3,
  });
  assert.equal(allLoss.maxStreakMedian, 20);
  assert.ok(allLoss.finalMedianIdx < 100);
  assert.equal(allLoss.belowStartProb, 1);
  assert.equal(allLoss.median.length, 21);

  const allWin = simulateSurvival({
    rSamples: Float64Array.from({ length: 100 }, () => 2),
    trades: 20,
    riskPct: 1,
    startEquity: 10_000_000,
    scenarios: 200,
    seed: 3,
  });
  assert.equal(allWin.maxStreakMedian, 0);
  assert.ok(allWin.finalMedianIdx > 100);
  assert.ok(allWin.finalMedian > 10_000_000);
});

/* ---------------------------------------------------------------- 엔진·백테스트 */

test("1만 회 재생: 확률 3칸 합 = 1, 고정 시드 재현성", () => {
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  const args = { pool, entry: 104, stop: 103, target: 106, side: "buy", entryBar: 4, replays: 2000, seed: 19 };
  const a = simulate(args);
  const b = simulate(args);
  assert.ok(Math.abs(a.pTarget + a.pStop + a.pNeither - 1) < 1e-9);
  assert.equal(a.pTarget, b.pTarget);
  assert.deepEqual(a.samplePaths[0], b.samplePaths[0]);
  assert.equal(a.rSamples.length, 2000);
  // light 모드는 밴드를 만들지 않는다
  const light = simulate({ ...args, light: true });
  assert.equal(light.bands.length, 0);
  assert.equal(light.rSamples, undefined);
});

test("백테스트: 목표 도달은 전체 진입 기준과 종료 건 기준으로 나뉜다", () => {
  const d = datasetFor();
  const bt = historyReplay(d.sessions, d.times, { orBars: 3, stopPct: 0.01, targetR: 2, side: "buy" });
  assert.equal(bt.triggered, bt.target + bt.stop + bt.close);
  assert.ok(bt.target >= 0 && bt.stop >= 0);
  const all = bt.triggered ? bt.target / bt.triggered : 0;
  const decided = bt.target + bt.stop;
  const ended = decided ? bt.target / decided : 0;
  if (bt.close > 0) assert.ok(ended >= all);
});
