import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCustom,
  buildPool,
  simulate,
  historyReplay,
  buildThermometer,
  buildStopLevels,
  compareCombos,
  simulateSurvival,
  sizePosition,
  SHORT_DISCLOSURE,
  pickBestCell,
  summaryLines,
  avgRBreakdown,
  formatPct,
  formatPctValue,
  formatPrice,
  moneyLabel,
  COMBO_MODES,
  bestBadgeText,
  comboModeHint,
  greenGloss,
  rGloss,
  expectedValueNote,
  riskFormula,
  GREEN_LABEL,
  RISK_FORMULA_ABS,
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

test("역순 봉 안내에 HTS 역순 CSV를 시간순으로 바꾸라는 문구가 들어간다", () => {
  const rows = baseRows(3);
  const tmp = rows[1];
  rows[1] = rows[2];
  rows[2] = tmp;
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) =>
      /시간순\(오래된 봉 → 최신 봉\)/.test(e.message) &&
      /HTS/.test(e.message) &&
      /최신 봉부터 내려오는 CSV/.test(e.message)
  );
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

/* ---------------------------------------------------------------- v2.1.1 파서 엄격 검증 */

test("달력에 없는 날짜(2026-02-30)는 명시적 오류로 차단한다", () => {
  const rows = baseRows(3);
  rows[2] = [`2026-02-30 09:00`, 102, 103, 101, 102.2, 1000];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) => /존재하지 않는 날짜·시각/.test(e.message) && /2026-02-30/.test(e.message)
  );
});

test("달력에 없는 날짜(2025-02-29, 윤년 아님)도 차단한다", () => {
  const rows = baseRows(3);
  rows[0] = ["2025-02-29 09:00", 100, 101, 99, 100.4, 1000];
  assert.throws(() => parseCustom(csv(rows)), /존재하지 않는 날짜·시각/);
});

test("없는 시각(25:00)은 명시적 오류로 차단한다", () => {
  const rows = baseRows(3);
  rows[1] = ["2026-11-01 25:00", 101, 102, 100, 101.4, 1000];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) => /존재하지 않는 날짜·시각/.test(e.message) && /25:00/.test(e.message)
  );
});

test("없는 분(09:75)도 차단한다", () => {
  const rows = baseRows(3);
  rows[1] = ["2026-11-01 09:75", 101, 102, 100, 101.4, 1000];
  assert.throws(() => parseCustom(csv(rows)), /존재하지 않는 날짜·시각/);
});

test("문자 섞인 숫자(100abc)는 조용히 100이 되지 않고 차단한다", () => {
  const rows = baseRows(3);
  rows[2] = [rows[2][0], "100abc", 101, 99, 100, 1000];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) => /숫자 형식이 잘못된 값/.test(e.message) && /"100abc"/.test(e.message) && /시가/.test(e.message)
  );
});

test("공백이 섞인 숫자(1 00)와 단위 붙은 숫자(100원)도 차단한다", () => {
  const rows = baseRows(3);
  rows[1] = [rows[1][0], "1 00", 102, 100, 101, 1000];
  assert.throws(() => parseCustom(csv(rows)), /숫자 형식이 잘못된 값/);
  const rows2 = baseRows(3);
  rows2[3] = [rows2[3][0], 101, 102, 100, "100원", 1000];
  assert.throws(() => parseCustom(csv(rows2)), /숫자 형식이 잘못된 값/);
});

test("거래량에 문자가 섞이면 조용히 0으로 바꾸지 않고 차단한다", () => {
  const rows = baseRows(3);
  rows[4] = [rows[4][0], 100, 101, 99, 100.4, "12a0"];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) => /숫자 형식이 잘못된 값/.test(e.message) && /거래량/.test(e.message)
  );
});

test("천 단위 쉼표(1,000)는 정상 숫자로 인정한다", () => {
  const rows = baseRows(3);
  rows[0] = [rows[0][0], '"1,030"', '"1,031"', '"1,029"', '"1,030.5"', '"1,000"'];
  const { dataset } = parseCustom(csv(rows));
  assert.equal(dataset.sessions[0].bars[0][0], 1030);
  assert.equal(dataset.sessions[0].bars[0][4], 1000);
});

test("세션마다 봉 시각 배열이 다르면 차단한다", () => {
  const rows = baseRows(3);
  // 2일째만 4번째 봉 시각을 09:15 → 09:20 으로 옮긴다(봉 개수는 4개로 같음)
  rows[7] = ["2026-11-02 09:20", 103, 104, 102, 103.4, 1003];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) =>
      /세션마다 봉 시각이 다릅니다/.test(e.message) &&
      /2026-11-02/.test(e.message) &&
      /09:15 대신 09:20/.test(e.message)
  );
});

test("봉 시각 배열이 모두 같으면 정상 적용한다", () => {
  const { dataset } = parseCustom(csv(baseRows(3)));
  assert.deepEqual(dataset.times, ["09:00", "09:05", "09:10", "09:15"]);
  for (const s of dataset.sessions) assert.equal(s.bars.length, dataset.times.length);
});

/* ---------------------------------------------------------------- v2.1.1 수량 라벨·온도계 문구 */

test("수량 라벨: 매수는 '가정 매수 금액', 매도는 '가정 포지션 금액' + 공매도 한계 고지", () => {
  const base = { entry: 100, stop: 99, target: 102, account: 10_000_000, riskPct: 1, expectedR: 0.2 };
  const buy = sizePosition({ ...base, side: "buy" });
  const sell = sizePosition({ ...base, stop: 101, target: 98, side: "sell" });
  assert.equal(buy.positionLabel, "가정 매수 금액");
  assert.equal(buy.disclosure, null);
  assert.equal(sell.positionLabel, "가정 포지션 금액");
  assert.equal(sell.disclosure, SHORT_DISCLOSURE);
  assert.match(sell.disclosure, /공매도 증거금·대주 가능 여부·수수료\/이자는 반영되지 않은 단순 현금 한도 기준 참고 수량입니다/);
  assert.equal(sell.shares, buy.shares);
  assert.equal(sell.cost, sell.shares * 100);
});

test("온도계 문구: ± 없이 일중 고저폭으로 쓰고 방향·경로를 단정하지 않는다", () => {
  const d = datasetFor();
  const t = buildThermometer(d, 0.01, 4);
  assert.ok(!t.headline.includes("±"), t.headline);
  assert.match(t.headline, /일중 고저폭/);
  assert.ok(!t.verdict.includes("±"), t.verdict);
  assert.ok(!/ATR/.test(t.verdict));
  assert.match(
    t.verdict,
    new RegExp(
      `일중 고저폭\\(고가−저가\\)이 내 손절폭보다 큰 날이 ${t.exceededSessions}일 있었으나, 고저폭은 방향과 진입 후 경로를 구분하지 않는 단순 참고 지표입니다\\. 실제 분포는 1만 번 재생·백테스트 결과를 기준으로 확인하세요\\.`
    )
  );
  assert.ok(!/승률이 낮게 나오기 쉽습니다|손절이 잦게 잡힐 수 있습니다/.test(t.verdict));
  assert.ok(t.avgBarRangePct > 0 && t.avgBarRangePct < t.maxRangePct);
});


test("오류 여러 건은 슬래시가 아니라 항목별 줄로 나열한다", () => {
  const rows = baseRows(3);
  rows[1] = [rows[1][0], 0, 101, 99, 100, 1000];
  rows[2] = [rows[2][0], 100, 99, 101, 100, 1000];
  let message = "";
  try {
    parseCustom(csv(rows));
  } catch (e) {
    message = e.message;
  }
  assert.ok(message.length > 0);
  const items = message.split("\n").filter((line) => line.startsWith("· "));
  assert.ok(items.length >= 2, message);
  assert.ok(message.startsWith("데이터를 적용하지 않았습니다.\n"), message);
  // 두 오류가 한 줄에 슬래시로 붙어 나오지 않는다
  assert.ok(!/봉: [^\n]*\/ [^\n]*봉:/.test(message), message);
  assert.ok(message.endsWith("값을 고친 뒤 다시 [적용하기]를 눌러 주세요."), message);
});

/* ---------------------------------------------------------------- v2.1.2 4호 봇 4건 */

test("v2.1.2 시각: 뒤에 글자가 붙은 09:00x는 09:00으로 통과하지 않고 차단한다", () => {
  const rows = baseRows(3);
  rows[2] = ["2026-11-01 09:00x", 102, 103, 101, 102.2, 1000];
  assert.throws(
    () => parseCustom(csv(rows)),
    (e) =>
      /형식이 잘못된 값/.test(e.message) &&
      /2026-11-01 09:00x/.test(e.message) &&
      /시각 뒤에 글자·단위가 붙으면/.test(e.message) &&
      !/존재하지 않는 날짜·시각/.test(e.message)
  );
});

test("v2.1.2 시각: 초·밀리초·시간대 표기는 계속 읽는다(엄격하지만 실제 형식은 허용)", () => {
  const forms = [
    "2026-11-01 09:00",
    "2026-11-01 09:00:00",
    "2026-11-01 09:00:00.000",
    "2026-11-01T09:00",
    "2026-11-01T09:00:00+09:00",
    "20261101 0900",
    "2026/11/01 09:00",
    "11/01/2026 09:00",
  ];
  for (const form of forms) {
    const rows = baseRows(3);
    rows[0] = [form, 100, 101, 99, 100.4, 1000];
    const { dataset } = parseCustom(csv(rows), "형식");
    assert.equal(dataset.times[0], "09:00", `${form} 를 읽지 못했습니다`);
  }
});

test("v2.1.2 봉 간격: 5분 간격이 일정하면 '5분봉', 섞이면 '불규칙 봉'", () => {
  const regular = parseCustom(csv(baseRows(3))).dataset;
  assert.equal(regular.meta.interval, "5분봉");
  assert.equal(regular.meta.intervalRegular, true);
  assert.equal(regular.meta.intervalSeconds, 300);

  // 09:00 · 09:05 · 10:00 · 10:05 — 간격이 5/55/5 로 섞인 자료
  const rows = [];
  for (let d = 1; d <= 3; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const stamps = ["09:00", "09:05", "10:00", "10:05"];
    stamps.forEach((t, i) => {
      const o = 100 + d + i;
      rows.push([`${date} ${t}`, o, o + 0.6, o - 0.6, o + 0.2, 1000 + i]);
    });
  }
  const irregular = parseCustom(csv(rows));
  assert.equal(irregular.dataset.meta.interval, "불규칙 봉");
  assert.equal(irregular.dataset.meta.intervalRegular, false);
  assert.match(irregular.dataset.meta.gapSummary, /5분 2회/);
  assert.match(irregular.dataset.meta.gapSummary, /55분 1회/);
  assert.ok(
    irregular.warnings.some((w) => /봉 간격이 일정하지 않습니다/.test(w) && /불규칙 봉/.test(w)),
    irregular.warnings.join(" / ")
  );
  // 최빈 간격(5분)은 남겨 두어 봉 수 환산이 5분 기준으로 동작한다
  assert.equal(irregular.dataset.meta.intervalSeconds, 300);
});

test("v2.1.2 조합 수: 진입 100,000 / 손절 99,999.99는 중복 제거돼 3개 조합만 계산된다", () => {
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  const entry = 100_000;
  const stop = 99_999.99;
  const stopPct = Math.abs(entry - stop) / entry;
  const levels = buildStopLevels(entry, stopPct, "원", "buy");
  // 호가 단위(1원)에서 0.6배·1배·1.5배가 모두 같은 손절가로 반올림 → 중복 제거
  assert.equal(levels.length, 1, `손절 단계 ${levels.length}개`);
  const res = compareCombos({
    pool,
    entry,
    side: "buy",
    entryBar: 5,
    levels,
    replays: 200,
    unit: "원",
  });
  assert.equal(res.cells.length, 3, `조합 ${res.cells.length}개`);
  assert.equal(res.cells.length, levels.length * res.targetRs.length);
  assert.equal(new Set(res.cells.map((c) => c.stopPct.toFixed(6))).size, 1);
});

test("v2.1.2 온도계 배율: 남은 구간은 '내 손절의 N배', 배지는 '손절 ÷ 남은 구간'으로 방향이 반대다", () => {
  const d = datasetFor();
  const stopPct = 0.01;
  const t = buildThermometer(d, stopPct, 4);
  assert.ok(t.remainMedianPct > 0);
  const stopPctPct = stopPct * 100;
  // 남은 구간 중앙값 ÷ 손절폭 — 문장에 쓰는 값(손절보다 넓으면 1보다 크다)
  assert.ok(Math.abs(t.remainMultipleStop - t.remainMedianPct / stopPctPct) < 1e-9);
  // 손절폭 ÷ 남은 구간 중앙값 — 배지에 쓰는 값
  assert.ok(Math.abs(t.remainRatio - stopPctPct / t.remainMedianPct) < 1e-9);
  assert.ok(Math.abs(t.remainRatio * t.remainMultipleStop - 1) < 1e-9);
  // 두 값이 같으면(1배) 분자·분모를 착각해도 티가 안 나므로, 실제 예시로 검산한다.
  // 남은 구간 2.75% · 손절 1.00% → 문장 2.75배, 배지 0.36배
  const remain = 2.75;
  assert.equal((remain / stopPctPct).toFixed(2), "2.75");
  assert.equal((stopPctPct / remain).toFixed(2), "0.36");
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

test("9조합 목표가도 호가 단위로 반올림해 계산과 표시가 같다", () => {
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  const levels = buildStopLevels(100, 0.01, "원", "buy");
  const res = compareCombos({
    pool,
    entry: 100,
    side: "buy",
    entryBar: 5,
    levels,
    targetRs: [1, 1.5, 2],
    replays: 300,
    unit: "원",
  });
  for (const c of res.cells) {
    assert.ok(Number.isInteger(c.target), `목표가 ${c.target}가 1원 단위가 아닙니다`);
    assert.ok(c.target > 100, "매수 목표가는 진입가보다 커야 합니다");
    const risk = Math.abs(100 - c.stop);
    assert.ok(Math.abs(c.target - (100 + c.targetR * risk)) <= 0.5, "목표가가 R 기준과 0.5원 넘게 어긋납니다");
  }
  const sell = compareCombos({
    pool,
    entry: 100,
    side: "sell",
    entryBar: 5,
    levels: buildStopLevels(100, 0.01, "원", "sell"),
    targetRs: [2],
    replays: 300,
    unit: "원",
  });
  for (const c of sell.cells) assert.ok(Number.isInteger(c.target) && c.target < 100);
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

/* ---------------------------------------------------------------- v2.1.3 4호 봇·부이 대리 6건 */

test("v2.1.3 매도 R 설명: 1R = |진입가 − 손절가|, 방향별 식을 부호까지 구분한다", () => {
  assert.equal(riskFormula("buy"), "진입가 − 손절가");
  assert.equal(riskFormula("sell"), "손절가 − 진입가");
  assert.match(RISK_FORMULA_ABS, /^\|진입가 − 손절가\|$/);

  const buy = rGloss("buy");
  assert.match(buy, /매수/);
  assert.match(buy, /1R = 진입가 − 손절가/);
  assert.ok(!/1R = 손절가 − 진입가/.test(buy));

  const sell = rGloss("sell");
  assert.match(sell, /매도/);
  assert.match(sell, /1R = 손절가 − 진입가입니다/);
  assert.match(sell, /\(항상 양수\)/);
  // 매도에서 매수식만 적어 부호를 뒤집히게 하던 문구가 남아 있지 않다
  assert.ok(!/1R = 진입가 − 손절가/.test(sell), sell);
  assert.match(sell, /부호가 반대/);
  assert.match(rGloss("buy"), new RegExp(RISK_FORMULA_ABS.replace(/\|/g, "\\|")));
});

test("v2.1.3 매도 수량 카드: 위험폭 식도 손절가 − 진입가로 적고 값은 항상 양수다", () => {
  const buy = sizePosition({
    entry: 100_000,
    stop: 99_000,
    target: 102_000,
    account: 10_000_000,
    riskPct: 1,
    side: "buy",
    expectedR: 0.2,
  });
  const sell = sizePosition({
    entry: 100_000,
    stop: 101_000,
    target: 98_000,
    account: 10_000_000,
    riskPct: 1,
    side: "sell",
    expectedR: 0.2,
  });
  assert.equal(buy.riskFormula, "진입가 − 손절가");
  assert.equal(sell.riskFormula, "손절가 − 진입가");
  assert.equal(buy.riskPerShare, 1_000);
  assert.equal(sell.riskPerShare, 1_000);
  assert.ok(sell.riskPerShare > 0);
  assert.equal(sell.rr, 2);
});

test("v2.1.3 극단 입력 표기: 99,999.99원과 0.00001%가 반올림으로 사라지지 않는다", () => {
  // 가격: 원 단위에서도 소수 입력은 그대로 보인다(100,000원 / 99,999.99원이 구분됨)
  assert.equal(formatPrice(100_000, "원"), "100,000원");
  assert.equal(formatPrice(99_999.99, "원"), "99,999.99원");
  assert.notEqual(formatPrice(100_000, "원"), formatPrice(99_999.99, "원"));
  assert.equal(formatPrice(0.01, "원"), "0.01원");
  // 퍼센트: 0.00%로 뭉개지면 소수를 늘려 적는다
  assert.equal(formatPct(1e-7), "0.00001%");
  assert.equal(formatPct(1e-5, 2), "0.001%");
  assert.equal(formatPct(0.434), "43.4%");
  assert.equal(formatPct(0, 1), "0.0%");
  assert.equal(formatPctValue(1e-5, 2), "0.00001%");
  assert.equal(formatPctValue(2.75, 2), "2.75%");
  // 원화 금액: 0.5원을 1원으로 올려 적지 않는다
  assert.equal(moneyLabel(0.5, "원"), "0.5원");
  assert.equal(moneyLabel(10_000_000, "원"), "10,000,000원");
});

test("v2.1.3 극단 입력: 현금 상한이 걸리면 실제 위험률(effectiveRiskPct)로 1R을 다시 정한다", () => {
  const account = 10_000_000;
  const size = sizePosition({
    entry: 100_000,
    stop: 99_999.99,
    target: 100_100,
    account,
    riskPct: 1,
    side: "buy",
    expectedR: -0.18,
  });
  // 계좌 현금 한도 100주 → 실제 최대 손실 1원 (계획 허용 손실 100,000원이 아니다)
  assert.equal(size.shares, 100);
  assert.equal(size.boundBy, "계좌 금액");
  assert.ok(Math.abs(size.maxLoss - 1) < 1e-9, `maxLoss=${size.maxLoss}`);
  assert.equal(size.riskLimitedByCash, true);
  assert.ok(Math.abs(size.effectiveRiskPct - 1e-5) < 1e-9, `effectiveRiskPct=${size.effectiveRiskPct}`);
  // 유효 위험률의 정의 그대로: 실제 최대 손실 ÷ 계좌
  assert.ok(Math.abs((size.maxLoss / account) * 100 - size.effectiveRiskPct) < 1e-15);
  // 극단적으로 좁은 손절폭 경고 1줄
  assert.ok(
    size.warnings.some((w) => /0\.01% 미만/.test(w) && /극단적으로 좁습니다/.test(w)),
    size.warnings.join(" / ")
  );
  // 계획 위험률(1%)을 그대로 쓰면 1R = 100,000원이라 수량 카드(1원)와 모순된다 — 그래서 생존 시뮬레이션은 유효 위험률을 쓴다
  assert.ok(Math.abs(account * 0.01 - size.maxLoss) > 1);

  const surv = simulateSurvival({
    rSamples: Float64Array.from({ length: 50 }, () => -1),
    trades: 1,
    riskPct: size.effectiveRiskPct,
    startEquity: account,
    scenarios: 50,
    seed: 3,
  });
  assert.equal(surv.riskPct, size.effectiveRiskPct);
  assert.ok(Math.abs(surv.oneR - size.maxLoss) < 1e-6, `oneR=${surv.oneR} vs maxLoss=${size.maxLoss}`);
  // -1R 한 번 = 계좌가 정확히 maxLoss만큼 줄어든다 (수량 카드와 같은 1R)
  const afterOne = (surv.median[1] / 100) * account;
  assert.ok(Math.abs(account - afterOne - size.maxLoss) < 1e-6, `afterOne=${afterOne}`);
});

test("v2.1.3 이익 마감률: 주 라벨·풀이에서 '승률'을 쓰지 않고 목표 도달률과 구분한다", () => {
  assert.equal(GREEN_LABEL, "이익 마감률");
  const texts = [
    ...COMBO_MODES.flatMap((m) => [m.label, m.hint]),
    bestBadgeText("green", false),
    bestBadgeText("avgR", false),
    bestBadgeText("green", true),
    comboModeHint("green"),
    comboModeHint("avgR"),
    greenGloss(),
  ];
  for (const t of texts) {
    assert.ok(!t.includes("승률"), `'승률'이 남아 있습니다: ${t}`);
    assert.ok(!t.includes("손익비 추구형"), `'손익비 추구형'이 남아 있습니다: ${t}`);
  }
  assert.ok(COMBO_MODES.some((m) => m.label.includes(GREEN_LABEL)));
  assert.ok(COMBO_MODES.some((m) => /평균 R/.test(m.label)));
  assert.equal(bestBadgeText("green", false), "이익 마감률 최고");
  assert.equal(bestBadgeText("avgR", false), "평균 R 최고");
  assert.match(bestBadgeText("avgR", true), /^가장 높았던 칸\(참고\) · 평균 R 기준$/);
  assert.match(bestBadgeText("green", true), /^가장 높았던 칸\(참고\) · 이익 마감률 기준$/);
  const gloss = greenGloss();
  assert.match(gloss, /목표 도달 \+ 목표 미도달 유리 마감/);
  assert.match(gloss, /목표 도달률/);
  assert.match(gloss, /다릅니다/);
});

test("v2.1.3 성향 토글: '평균 R(기댓값) 우선'은 실제로 avgR 최고 칸을, '이익 마감률 우선'은 pGreen 최고 칸을 고른다", () => {
  const cell = (stopPct, targetR, pGreen, avgR) => ({
    stopPct,
    stop: 100 - stopPct * 100,
    targetR,
    target: 100 + targetR,
    pTarget: pGreen / 2,
    pStop: 0.2,
    pNeither: 0.1,
    pGreen,
    avgR,
  });
  const cells = [cell(0.01, 1, 0.62, -0.1), cell(0.02, 1, 0.55, 0.44), cell(0.03, 1, 0.5, 0.2)];
  assert.equal(pickBestCell(cells, "green").pGreen, 0.62);
  assert.equal(pickBestCell(cells, "green").stopPct, 0.01);
  assert.equal(pickBestCell(cells, "avgR").avgR, 0.44);
  assert.equal(pickBestCell(cells, "avgR").stopPct, 0.02);
  assert.equal(pickBestCell([], "green"), null);
});

test("v2.1.3 요약 2줄: '미도달 포함'과 두 값만 더한 값의 차이를 같은 줄에서 보여 준다", () => {
  const sim = {
    replays: 10000,
    pTarget: 0.43,
    pStop: 0.52,
    pNeither: 0.05,
    pGreen: 0.46,
    avgR: -0.18,
    rAtTarget: 2,
    barsLeft: 59,
  };
  const b = avgRBreakdown(sim);
  assert.ok(Math.abs(b.twoValueR - (0.43 * 2 - 0.52)) < 1e-12);
  assert.ok(b.neitherAvgR !== null);
  // 1회 평균 = 목표 몫 + 손절 몫 + 미도달 몫 (되돌려 검산)
  assert.ok(Math.abs(0.43 * 2 - 0.52 + 0.05 * b.neitherAvgR - sim.avgR) < 1e-12);

  const [first, second, third] = summaryLines({
    sim,
    target: 100,
    stop: 99,
    rr: 2,
    unit: "원",
  });
  assert.match(first, /목표 100원/);
  assert.match(second, /미도달 포함 −0\.18R/);
  assert.match(second, /두 값만 확률로 더하면 \+0\.34R/);
  assert.match(second, /미도달 5\.0%/);
  assert.match(second, /손실 쪽/);
  assert.match(third, /이익 마감률 46\.0%/);
  assert.match(third, /목표 도달 43\.0%/);
  assert.ok(!third.includes("승률"));

  // 미도달 0%면 두 값만 더한 값이 곧 평균이다
  const noMiss = avgRBreakdown({ pTarget: 0.5, pStop: 0.5, pNeither: 0, avgR: 0.5, rAtTarget: 2 });
  assert.equal(noMiss.neitherAvgR, null);
  const lines = summaryLines({
    sim: { ...sim, pNeither: 0, pTarget: 0.5, pStop: 0.5, avgR: 0.5 },
    target: 100,
    stop: 99,
    rr: 2,
    unit: "원",
  });
  assert.match(lines[1], /미도달 0%라 그대로 실제 평균/);
});

test("v2.1.3 오류 문구: 한글은 단어 단위로 끊고 긴 문자열만 넘치지 않게 끊는 CSS 규칙이 있다", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = /\.alert\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*anywhere;[^}]*\}/s;
  assert.match(css, rule, "오류·경고 문구에 keep-all/anywhere 규칙이 없습니다");
  // 여러 건 오류의 줄바꿈(pre-line) 규칙도 그대로 남아 있다
  assert.match(css, /\.alert\.error\s*\{[^}]*white-space:\s*pre-line;/s);
});

test("v2.1.3 수량 카드 기댓값 각주: 포지션 방향과 실제 평균 R을 함께 적는다", () => {
  const buy = sizePosition({
    entry: 100,
    stop: 99,
    target: 102,
    account: 10_000_000,
    riskPct: 1,
    side: "buy",
    expectedR: -0.18,
  });
  const sell = sizePosition({
    entry: 100,
    stop: 101,
    target: 98,
    account: 10_000_000,
    riskPct: 1,
    side: "sell",
    expectedR: 0.146,
  });
  // 기댓값 계산에 쓴 평균 R을 결과가 그대로 들고 있다(화면 각주·계산이 같은 값)
  assert.equal(buy.expectedR, -0.18);
  assert.equal(sell.expectedR, 0.146);
  assert.equal(
    expectedValueNote(buy.side, buy.expectedR),
    "매수 가정 · 평균 −0.18R 단순 곱 · 수수료·세금·갭 미반영"
  );
  assert.equal(
    expectedValueNote(sell.side, sell.expectedR),
    "매도 가정 · 평균 +0.15R 단순 곱 · 수수료·세금·갭 미반영"
  );
  // 기댓값 = 실제 최대 손실 × 평균 R 그대로
  assert.ok(Math.abs(buy.expectedValue - buy.maxLoss * buy.expectedR) < 1e-9);
});
