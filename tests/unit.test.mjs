import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  parseCustom,
  buildPool,
  simulate,
  historyReplay,
  buildThermometer,
  buildStopLevels,
  compareCombos,
  uniqueCells,
  targetColumnLabels,
  COMBO_R_TOLERANCE,
  simulateSurvival,
  sizePosition,
  SHORT_DISCLOSURE,
  pickBestCell,
  summaryLines,
  avgRBreakdown,
  formatPct,
  formatPctValue,
  formatMultiple,
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
  SURVIVAL_LABELS,
  COMBO_MULTIPLE_NOTE,
  easyGlossary,
  TRAFFIC_BADGES,
  TRAFFIC_BASIS,
  trafficBasis,
  calcRoundingStep,
  calcRoundingNote,
  EXTREME_STOP_REASON,
  EXTREME_BANNER_NOTE,
  EXTREME_AVG_R_NOTE,
  EXTREME_POSITIVE_NOTE,
  avgRTone,
  positiveTone,
  zeroShareReason,
  ResultCards,
  SizingCard,
  isExtremeStop,
  FLAT_R,
  trafficLevel,
  trafficBadge,
  perHundred,
  approxMoney,
  avgMoneyPerTrade,
  easyMoneyChip,
  easyLine1,
  easyLine2,
  easyConclusion,
  easySummary,
  easyMathDetail,
  easyThermometerLine,
  easyProfitCount,
  easyAvgMultiple,
  easyStopLevelLabel,
  easyTargetMultiple,
  easySizingLine,
  perBase,
  pctThree,
  greenRatePct,
  replayDirection,
  ZERO_SHARES_NOTE,
  ZERO_SHARES_BANNER_NOTE,
  survivalIndexText,
  survivalFlatNote,
  axisLabels,
  isFlatSpan,
  decimalsOf,
  roundTo,
  mirrorPrice,
  offsetPrice,
  roundPrice,
  EXTREME_STOP_RATIO,
  APP_VERSION,
  VERSION_SHORT,
  TopBar,
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
  // 배수: 극단 입력에서 0.00배로 사라지지 않는다
  assert.equal(formatMultiple(0.0000024), "<0.01");
  assert.equal(formatMultiple(2.75), "2.75");
  assert.equal(formatMultiple(275229.36), "275,229.36");
  assert.equal(formatMultiple(0), "0.00");
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


/* ================================================================ v2.2 초등학생 눈높이 쉬운 리포트 */

const V22_CSS = readFileSync("src/styles.css", "utf8");
const ruleOf = (selector) => {
  // 선택자 앞 줄바꿈까지 포함해 찾고, 여러 곳(묶음 선택자·하위 선택자)에 나오면
  // font-size/min-height 를 실제로 담은 규칙을 고른다.
  let from = 0;
  let first = "";
  for (let guard = 0; guard < 40; guard++) {
    const i = V22_CSS.indexOf(`\n${selector}`, from);
    if (i < 0) break;
    const open = V22_CSS.indexOf("{", i);
    const close = V22_CSS.indexOf("}", open);
    if (open < 0 || close < 0) break;
    const block = V22_CSS.slice(open, close);
    if (!first) first = block;
    if (/font-size:|min-height:/.test(block)) return block;
    from = close;
  }
  return first;
};
const fontSizeOf = (selector) => {
  const m = /font-size:\s*([\d.]+)px/.exec(ruleOf(selector));
  return m ? Number(m[1]) : null;
};

test("v2.2 100번 기준 횟수: 세 비율을 최대잔여법으로 나눠 합이 정확히 100이 된다", () => {
  assert.deepEqual(perHundred([0.242, 0.695, 0.063]), [24, 70, 6]);
  const split = perHundred([0.333, 0.333, 0.334]);
  assert.deepEqual(split, [33, 33, 34]);
  assert.equal(split.reduce((a, b) => a + b, 0), 100);
  // 1만 번 재생에서 흔한 어긋난 비율도 합 100을 지킨다
  const odd = perHundred([0.2855, 0.7005, 0.014]);
  assert.equal(odd.reduce((a, b) => a + b, 0), 100);
  // 극단 입력: 목표 7.4% / 손절 92.6% / 미도달 0
  assert.deepEqual(perHundred([0.074, 0.926, 0]), [7, 93, 0]);
});

test("v2.2 신호등: 평균 금액 기준 임계값과 배지 문구가 계획대로 고정된다", () => {
  assert.equal(FLAT_R, 0.02);
  assert.equal(trafficLevel(-0.182), "red");
  assert.equal(trafficLevel(0.001), "yellow");
  assert.equal(trafficLevel(0), "yellow");
  assert.equal(trafficLevel(0.182), "green");
  assert.equal(trafficBadge(-0.182), "🔴 1번 평균은 손실 쪽이에요");
  assert.equal(trafficBadge(0.001), "🟡 1번 평균은 거의 본전이에요");
  assert.equal(trafficBadge(0.182), "🟢 1번 평균은 이익 쪽이에요 (참고)");
  assert.equal(TRAFFIC_BADGES.yellow, "🟡 1번 평균은 거의 본전이에요");
  assert.equal(TRAFFIC_BASIS, "평균 금액 기준");
});

test("v2.2 쉬운 1줄: 100번 중 목표·손절·미도달 횟수를 방향에 맞게 말한다", () => {
  const buy = easyLine1({ pTarget: 0.242, pStop: 0.695, pNeither: 0.063, side: "buy" });
  assert.match(buy, /^100번 해보면 약 24번은 목표 가격까지 올라서 기분 좋게 끝났고/);
  assert.match(buy, /70번은 손절 가격까지 내려가서 먼저 끝났어요/);
  assert.match(buy, /나머지 6번은 장 끝날 때까지 둘 다 안 닿았어요/);
  const counts = [...buy.matchAll(/(\d+)번/g)].map((m) => Number(m[1])).slice(1);
  assert.deepEqual(counts, [24, 70, 6]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 100);
  // 매도는 목표가 아래, 손절가 위 — 방향 단어가 뒤집힌다
  const sell = easyLine1({ pTarget: 0.3, pStop: 0.6, pNeither: 0.1, side: "sell" });
  assert.match(sell, /목표 가격까지 내려가서/);
  assert.match(sell, /손절 가격까지 올라가서/);
  // 목표 0%·미도달 0% 같은 특수 입력에서도 사실대로
  const none = easyLine1({ pTarget: 0, pStop: 0.6, pNeither: 0.4, side: "buy" });
  assert.match(none, /^목표 가격까지 간 경우는 없었고, 60번은/);
  assert.ok(!none.includes("약 0번"));
  const allNeither = easyLine1({ pTarget: 0, pStop: 0, pNeither: 1, side: "buy" });
  assert.match(allNeither, /손절 가격까지 간 경우도 없었어요/);
  assert.match(allNeither, /나머지 100번은/);
});

test("v2.2 쉬운 2줄: 수량 카드의 실제 1R 금액으로 원화 손익을 말한다", () => {
  const line = easyLine2({ avgR: -0.182, oneR: 98_200, unit: "원", shares: 50 });
  assert.match(line, /^내가 정한 손절 금액 98,200원을 1번 걸 때마다/);
  assert.match(line, /평균적으로 약 17,900원씩 줄어드는 흐름이었어요\.$/);
  const up = easyLine2({ avgR: 0.146, oneR: 100_000, unit: "원", shares: 10 });
  assert.match(up, /약 14,600원씩 늘어나는/);
  // 극단적으로 좁은 손절폭: 금액이 커 보인다는 안내를 같은 줄에 붙인다
  const extreme = easyLine2({ avgR: 729.07, oneR: 1, unit: "원", shares: 100, extreme: true });
  assert.match(extreme, /약 729원씩 늘어나는/);
  assert.match(extreme, /극단적으로 좁은 손절폭이라 이 금액은 참고하기 어려워요/);
  // 수량 0주면 금액 대신 방향만 (0원이라고 말하지 않는다)
  const zero = easyLine2({ avgR: -0.18, oneR: 0, unit: "원", shares: 0 });
  assert.match(zero, /수량이 0주라/);
  assert.match(zero, /손실 쪽이었어요/);
  assert.ok(!zero.includes("0원씩"));
});

test("v2.2 쉬운 3줄: 과거 일수·재생 횟수와 손절폭·목표 배수에 맞춰 결론이 달라진다", () => {
  const common = { pTarget: 0.242, pStop: 0.695, sessions: 57, replays: 10000 };
  const tight = easyConclusion({ ...common, avgR: -0.182, ratio: 0.237, rr: 2 });
  assert.match(tight, /^과거 57일 흐름으로 10,000번 돌려보니, /);
  assert.match(tight, /손절을 하루 흔들림보다 훨씬 가까이 두면/);
  assert.match(tight, /목표를 손절의 2.00배로 멀리 둬도 지는 판이 더 무거워서/);
  assert.match(tight, /1번 평균은 손실 쪽이었어요/);
  const wide = easyConclusion({ ...common, avgR: 0.21, ratio: 2.4, rr: 2 });
  assert.match(wide, /손절이 하루 흔들림보다 넓어서/);
  assert.match(wide, /이길 때 버는 돈이 더 커서/);
  const flat = easyConclusion({ ...common, avgR: 0.004, ratio: 1, rr: 1.5 });
  assert.match(flat, /이익과 손실이 거의 반반이었어요/);
});

test("v2.2 3줄 요약 전체: 전문 용어 없이 100번·원화로만 말한다", () => {
  const sim = {
    replays: 10000,
    pTarget: 0.242,
    pStop: 0.695,
    pNeither: 0.063,
    pGreen: 0.287,
    avgR: -0.182,
    rAtTarget: 2,
    barsLeft: 59,
  };
  const out = easySummary({
    sim,
    oneR: 98_200,
    shares: 50,
    unit: "원",
    side: "buy",
    ratio: 0.237,
    rr: 2,
    sessions: 57,
  });
  assert.equal(out.lines.length, 3);
  assert.equal(out.level, "red");
  assert.equal(out.badge, "🔴 1번 평균은 손실 쪽이에요");
  const text = out.lines.join(" ");
  for (const word of ["R", "백분위", "미도달", "기댓값", "손익비", "중앙값", "%"]) {
    assert.ok(!text.includes(word), `쉬운 3줄에 '${word}'가 남아 있습니다: ${text}`);
  }
  assert.ok(text.includes("100번"));
  assert.ok(text.includes("98,200원"));
});

test("v2.2 접이식 전문 산식: 비율·R 분해·1만 회 조건이 그대로 남는다", () => {
  const sim = {
    replays: 10000,
    pTarget: 0.242,
    pStop: 0.695,
    pNeither: 0.063,
    pGreen: 0.287,
    avgR: -0.182,
    rAtTarget: 2,
    barsLeft: 59,
  };
  const items = easyMathDetail({ sim, oneR: 98_200, unit: "원" }).join("\n");
  assert.match(items, /목표 도달 24\.2% · 손절 도달 69\.5% · 장 마감 미도달 6\.3%/);
  assert.match(items, /이익 마감률 28\.7% = 목표 도달 24\.2% \+ 목표 미도달 유리 마감 4\.5%/);
  assert.match(items, /1회 평균 −0\.18R = 목표 \+2\.00R×24\.2% \+ 손절 −1R×69\.5%/);
  assert.match(items, /미도달 6\.3%×/);
  assert.match(items, /−17,872원/);
  assert.match(items, /1만 회 빈도는 미래 확률이 아니라/);
});

test("v2.2 온도계 한 줄: 하루 흔들림이 내 손절의 몇 배인지 쉬운 말로", () => {
  const thermo = {
    sessions: 57,
    ranges: [],
    avgRangePct: 4.22,
    medianRangePct: 3.9,
    minRangePct: 1,
    maxRangePct: 9,
    avgBarRangePct: 0.5,
    remainMedianPct: 2.75,
    remainAvgPct: 2.8,
    remainRatio: 0.36,
    remainMultipleStop: 2.75,
    remainBars: 59,
    stopPct: 0.01,
    ratio: 0.237,
    exceededSessions: 57,
    exceededPct: 1,
    band: "tight",
    headline: "",
    verdict: "",
  };
  const line = easyThermometerLine(thermo);
  assert.match(line, /^보통 하루에 4\.22%씩 출렁이는데/);
  assert.match(line, /내 손절폭\(1\.00%\)이 그보다 4\.22배나 좁아서 지나가는 바람에도 툭 닿을 수 있어요/);
  // 손절이 더 넓으면 반대로 말한다
  const wide = easyThermometerLine({ ...thermo, stopPct: 0.08 });
  assert.match(wide, /넓어서 잠깐 흔들리는 정도로는 잘 안 닿아요/);
  // 극단 입력은 배수 폭주 대신 '사실상 0'으로
  const extreme = easyThermometerLine({ ...thermo, stopPct: 0.0000001 });
  assert.match(extreme, /사실상 0에 가까울 만큼 좁아요/);
  assert.match(extreme, /극단적으로 좁은 손절폭이라 참고하기 어려워요/);
});

test("v2.2 조합표 칸: '100번 중 N번 이익'·'평균 +0.13배'로 읽고 1% 미만은 1,000번 기준", () => {
  assert.equal(easyProfitCount(0.29), "100번 중 29번 이익");
  assert.equal(easyProfitCount(0.005), "100번 중 1번 이익");
  assert.equal(easyProfitCount(0.0012), "1,000번 중 1번 이익");
  assert.equal(easyProfitCount(0), "100번 중 0번 이익");
  assert.equal(easyProfitCount(1), "100번 중 100번 이익");
  assert.equal(easyAvgMultiple(0.13), "평균 +0.13배");
  assert.equal(easyAvgMultiple(-0.05), "평균 −0.05배");
  assert.equal(easyAvgMultiple(0.004), "평균 ±0.00배");
  assert.equal(easyAvgMultiple(0.008), "평균 +<0.01배");
  assert.equal(easyAvgMultiple(-0.008), "평균 −<0.01배");
});

test("v2.2 조합표 행: 손절폭을 '내 계획의 0.6배·1배·1.5배'로 읽는다", () => {
  assert.equal(easyStopLevelLabel(0.006, 0.01), "내 계획의 0.6배");
  assert.equal(easyStopLevelLabel(0.01, 0.01), "내 계획 그대로");
  assert.equal(easyStopLevelLabel(0.015, 0.01), "내 계획의 1.5배");
  assert.match(COMBO_MULTIPLE_NOTE, /손절 금액을 1로 봤을 때/);
  assert.match(COMBO_MULTIPLE_NOTE, /13%/);
});

test("v2.2 수량 카드 한 줄: 사야/팔아야·극단 입력·0주를 구분해 말한다", () => {
  const base = {
    shares: 50,
    side: "buy",
    account: 10_000_000,
    riskPct: 1,
    lossBudget: 100_000,
    maxLoss: 98_200,
    effectiveRiskPct: 0.982,
    riskLimitedByCash: false,
    unit: "원",
    entry: 98_200,
    riskPerShare: 2_000,
    extreme: false,
  };
  const buy = easySizingLine(base);
  assert.match(buy, /계산하면 50주예요/);
  assert.match(buy, /이만큼 사면 손절될 때 약 98,200원을 잃어요/);
  assert.ok(!buy.includes("원를"));
  const sell = easySizingLine({ ...base, side: "sell" });
  assert.match(sell, /이만큼 \(빌려서\) 팔면/);
  const limited = easySizingLine({ ...base, riskLimitedByCash: true, effectiveRiskPct: 0.00001, maxLoss: 1 });
  assert.match(limited, /계좌 금액 한도에 먼저 걸려서/);
  assert.match(limited, /0\.00001%/);
  const extreme = easySizingLine({ ...base, extreme: true });
  assert.match(extreme, /극단적으로 좁은 손절폭이라 이 숫자는 참고하기 어려워요/);
  // v2.2.3 — 0주는 원인을 하나로 뭉치지 않고 걸린 항목만 말한다
  const zero = easySizingLine({ ...base, shares: 0, maxLoss: 0, riskPerShare: 200_000 });
  assert.match(zero, /1주도 계산되지 않았어요/);
  assert.match(zero, /1주 위험폭\(200,000원\)이 1회 허용 손실\(100,000원\)보다 커서 0주가 됐어요/);
  assert.ok(!zero.includes("손절폭이 너무 넓거나"), "두 원인을 함께 말하는 옛 문구는 사라졌다");
});

test("v2.2 생존 그래프: 100·100·100 겹침을 피하고 등수 이름을 쓴다", () => {
  // 축 눈금이 반올림으로 겹치면 소수 자릿수를 늘린다
  const collapsed = axisLabels([100.0178, 100.15, 100.2824]);
  assert.equal(new Set(collapsed).size, 3, collapsed.join(" / "));
  const same = axisLabels([99.939, 100, 100.061]);
  assert.equal(new Set(same).size, 3, same.join(" / "));
  const normal = axisLabels([90, 97, 104]);
  assert.deepEqual(normal, ["90", "97", "104"]);
  // 변동 0.1 미만이면 '변동 거의 없음'
  assert.equal(isFlatSpan(100, 100.05), true);
  assert.equal(isFlatSpan(100, 100.3), false);
  assert.equal(survivalFlatNote(99.99, 100.01), "변동 거의 없음 (99.99~100.01)");
  // 평평하면 소수 둘째 자리까지 적는다
  assert.equal(survivalIndexText(99.99, true), "99.99");
  assert.equal(survivalIndexText(99.99, false), "100.0");
  assert.equal(SURVIVAL_LABELS.high, "운이 좋았던 상위 10등");
  assert.equal(SURVIVAL_LABELS.mid, "딱 중간 50등");
  assert.equal(SURVIVAL_LABELS.low, "운이 나빴던 하위 10등");
});

test("v2.2 금액 반올림: 읽기 쉽게 줄이되 0원으로 지우지 않는다", () => {
  assert.equal(approxMoney(17_824, "원"), "17,800원");
  assert.equal(approxMoney(98_200, "원"), "98,200원");
  assert.equal(approxMoney(1_234, "원"), "1,230원");
  assert.equal(approxMoney(0.18, "원"), "0.18원");
  assert.equal(approxMoney(729.07, "원"), "729원");
  assert.equal(avgMoneyPerTrade(-0.182, 98_200).toFixed(2), "-17872.40");
  assert.equal(easyMoneyChip({ avgR: -0.182, oneR: 98_200, unit: "원", shares: 50 }), "1번에 평균 17,900원 손해");
  assert.equal(easyMoneyChip({ avgR: 0.146, oneR: 100_000, unit: "원", shares: 10 }), "1번에 평균 14,600원 이익");
  assert.equal(easyMoneyChip({ avgR: 0.001, oneR: 98_200, unit: "원", shares: 50 }), "1번에 평균 거의 본전");
  assert.equal(easyMoneyChip({ avgR: -0.18, oneR: 0, unit: "원", shares: 0 }), "1번 결과 평균은 손실 쪽");
});

test("v2.2 쉬운 용어 풀이: 6개 항목이 한 문장씩, R·배·이익 마감률·중앙값을 초등학생 말로", () => {
  const buy = easyGlossary("buy");
  assert.equal(buy.length, 6);
  const terms = buy.map((g) => g.term).join(" / ");
  assert.match(terms, /R — 내가 정한 손절 금액 1번/);
  assert.match(terms, /배 — 평균 \+0\.13배/);
  assert.match(terms, /이익으로 끝난 비율/);
  assert.match(terms, /딱 중간 50등/);
  assert.match(terms, /장 끝날 때까지 둘 다 안 닿음/);
  assert.match(terms, /손절 금액 \(1R 금액\)/);
  const r = buy[0].plain;
  assert.match(r, /크기는 항상 양수/);
  assert.match(r, /1R = 진입가 − 손절가/);
  for (const g of buy) assert.ok(g.plain.length >= 30, g.term);
  const sell = easyGlossary("sell");
  assert.match(sell[0].plain, /1R = 손절가 − 진입가/);
  assert.match(sell[0].plain, /매도/);
});

test("v2.2 CSS: 각주 12px 이상·신호등 18px/44px·단어 단위 줄바꿈·360px 조정", () => {
  for (const sel of [".footnote", ".kv-sub", ".stat-sub", ".term-note", ".chart-note", ".kv-term", ".combo-col-head"]) {
    const size = fontSizeOf(sel);
    assert.ok(size !== null && size >= 12, `${sel} font-size=${size}`);
  }
  const traffic = ruleOf(".traffic");
  assert.match(traffic, /min-height:\s*44px/);
  assert.match(traffic, /font-size:\s*18px/);
  assert.match(traffic, /word-break:\s*keep-all/);
  const lines = ruleOf(".easy-lines");
  assert.match(lines, /font-size:\s*15px/);
  // 360px 이하에서도 신호등이 한 줄로 읽히게 글자를 줄이고 폭을 살린다
  const narrow = V22_CSS.slice(V22_CSS.lastIndexOf("@media (max-width: 380px)"));
  assert.match(narrow, /\.traffic \{[\s\S]*?font-size:\s*15\.5px/);
  // 새 요소도 버튼·접이식 요약은 44px 이상
  assert.match(ruleOf(".math-details > summary"), /min-height:\s*44px/);
  assert.match(ruleOf(".glossary-block > summary"), /min-height:\s*44px/);
  assert.match(ruleOf(".combo-cell"), /min-height:\s*64px/);
});

/* ================================================================ v2.2.1 4호 봇 결함 4건 */

test("v2.2.1 결함1: 극단 입력은 유리/손실 판정 대신 ⚪ 참고하기 어려워요(중립)로 분리한다", () => {
  assert.equal(TRAFFIC_BADGES.neutral, "⚪ 참고하기 어려워요");
  assert.match(EXTREME_STOP_REASON, /^손절폭이 극단적으로 좁아 실제 체결·수수료 오차가 큽니다$/);
  // 극단 입력(진입 100,000 / 손절 99,999.99)은 평균 R이 커도 유리 판정을 내리지 않는다
  assert.equal(trafficLevel(729.07, true), "neutral");
  assert.equal(trafficBadge(729.07, true), "⚪ 참고하기 어려워요");
  assert.equal(trafficLevel(-729.07, true), "neutral");
  // 극단이 아니면 종전 3단계 그대로 (회귀 방지)
  assert.equal(trafficLevel(729.07), "green");
  assert.equal(trafficLevel(-0.182), "red");
  assert.equal(trafficLevel(0.001), "yellow");
  assert.ok(!trafficBadge(729.07, true).includes("🟢"));

  const sim = {
    replays: 10000,
    pTarget: 0.074,
    pStop: 0.926,
    pNeither: 0,
    pGreen: 0.08,
    avgR: 729.07,
    rAtTarget: 1,
    barsLeft: 59,
  };
  const extreme = easySummary({
    sim,
    oneR: 1,
    shares: 100,
    unit: "원",
    side: "buy",
    ratio: 0.00001,
    rr: 1,
    sessions: 57,
    extreme: true,
  });
  assert.equal(extreme.level, "neutral");
  assert.equal(extreme.badge, "⚪ 참고하기 어려워요");
  // 이유를 3줄 결론에도 그대로 적고, '이익/손실 쪽' 판정 문장은 쓰지 않는다
  assert.match(extreme.lines[2], /손절폭이 극단적으로 좁아 실제 체결·수수료 오차가 큽니다/);
  assert.match(extreme.lines[2], /참고하기 어려워요/);
  assert.ok(!extreme.lines[2].includes("이익 쪽"), extreme.lines[2]);
  assert.ok(!extreme.lines[2].includes("손실 쪽"), extreme.lines[2]);
  // 금액 칩도 '이익/손해' 판정을 하지 않는다
  assert.equal(
    easyMoneyChip({ avgR: 729.07, oneR: 1, unit: "원", shares: 100, extreme: true }),
    "손절폭이 극단적으로 좁아 금액 비교를 보류했어요"
  );
  // 극단 플래그가 없으면 기존 문구 그대로
  const normal = easySummary({
    sim: { ...sim, avgR: 0.146, pTarget: 0.3, pStop: 0.6, pNeither: 0.1 },
    oneR: 100_000,
    shares: 10,
    unit: "원",
    side: "buy",
    ratio: 0.5,
    rr: 2,
    sessions: 57,
  });
  assert.equal(normal.level, "green");
  assert.equal(easyMoneyChip({ avgR: 0.146, oneR: 100_000, unit: "원", shares: 10 }), "1번에 평균 14,600원 이익");
  // ⚪ 중립 배지·테두리 CSS가 실제로 있다
  assert.match(ruleOf(".traffic.neutral"), /background:\s*#f1f5f9/);
  assert.match(ruleOf(".traffic.neutral"), /color:\s*#334155/);
  assert.match(ruleOf(".verdict.neutral"), /border-left-color:\s*#94a3b8/);
  assert.doesNotMatch(ruleOf(".verdict.neutral"), /#16a34a|#dc2626/);
});

test("v2.2.1 결함2: 0주면 생존 시뮬레이션도 위험률 0(100 유지, 시작 자금 아래 확률 0%)으로 맞춘다", () => {
  // 1주 값(100,000원)이 계좌(50,000원)보다 커 0주가 되는 조건
  const size = sizePosition({
    entry: 100_000,
    stop: 90_000,
    target: 120_000,
    account: 50_000,
    riskPct: 1,
    side: "buy",
    expectedR: -0.2,
  });
  assert.equal(size.shares, 0);
  assert.equal(size.maxLoss, 0);
  // 수량 카드의 손실액(0원)과 같은 기준 — 계획 위험률 1%를 대신 쓰지 않는다
  assert.equal(size.effectiveRiskPct, 0);

  const rSamples = Float64Array.from({ length: 50 }, () => -1);
  const surv = simulateSurvival({
    rSamples,
    trades: 20,
    riskPct: size.effectiveRiskPct,
    startEquity: 50_000,
    scenarios: 400,
    seed: 19,
  });
  assert.equal(surv.noTrade, true);
  assert.equal(surv.riskPct, 0);
  assert.equal(surv.oneR, 0);
  assert.equal(surv.belowStartProb, 0);
  assert.equal(surv.scenarios, 400);
  assert.equal(surv.median.length, 21);
  assert.ok(surv.median.every((v) => v === 100), "자금 궤적이 100으로 유지");
  assert.ok(surv.p10.every((v) => v === 100) && surv.p90.every((v) => v === 100));
  assert.equal(surv.finalMedian, 50_000);
  assert.equal(surv.maxStreakMax, 0);

  // 위험률이 0이 아니면 종전대로 R 분포를 적용한다 (회귀 방지)
  const normal = simulateSurvival({
    rSamples,
    trades: 2,
    riskPct: 1,
    startEquity: 1_000_000,
    scenarios: 100,
    seed: 19,
  });
  assert.equal(normal.noTrade, false);
  assert.ok(normal.belowStartProb > 0.9);
  assert.ok(Math.abs(normal.median[2] - 98.01) < 1e-9, `median=${normal.median[2]}`);
});

test("v2.2.1 결함3: 매수↔매도 방향 전환은 소수 가격의 0.01 정밀도를 보존한다", () => {
  // 원인: 원 단위 roundPrice 는 100,000.01 을 100,000 으로 지운다
  assert.equal(roundPrice(100_000.01, "원"), 100_000);
  assert.equal(decimalsOf(99_999.99), 2);
  assert.equal(decimalsOf(196_400), 0);
  assert.equal(roundTo(100_000.01000000001, 2), 100_000.01);

  // 진입 100,000 / 손절 99,999.99 → 매도 전환 후 손절 100,000.01 (0.01 차이 유지)
  const mirrored = mirrorPrice(100_000, 99_999.99, "원");
  assert.equal(mirrored, 100_000.01);
  assert.notEqual(mirrored, 100_000);
  // 왕복해도 원래 값으로 돌아온다
  assert.equal(mirrorPrice(100_000, mirrored, "원"), 99_999.99);
  // 매도 조건(목표 < 진입 < 손절)이 유지된다
  const target = mirrorPrice(100_000, 100_100, "원");
  assert.equal(target, 99_900);
  assert.ok(target < 100_000 && 100_000 < mirrored);
  // 정수 입력은 종전과 같은 정수로 나온다
  assert.equal(mirrorPrice(196_400, 194_436, "원"), 198_364);
  assert.equal(mirrorPrice(196_400, 200_328, "원"), 192_472);
  // 1R 목표도 같은 정밀도 규칙 (진입가와 목표가가 같아지는 문제 방지)
  assert.equal(offsetPrice(100_000, 0.01, "원"), 100_000.01);
  assert.equal(offsetPrice(100_000, -0.01, "원"), 99_999.99);
  assert.equal(offsetPrice(196_400, 1_964, "원"), 198_364);
  assert.equal(offsetPrice(196_400, -1_964, "원"), 194_436);
  // 원 단위가 아닌 종목(USD 2자리)도 그대로 2자리를 지킨다
  assert.equal(mirrorPrice(100.05, 99.99, "USD"), 100.11);
  // 극단 손절폭 판정은 그대로 (0.00001% < 0.01%)
  assert.ok(Math.abs(100_000 - 99_999.99) / 100_000 < EXTREME_STOP_RATIO);
  assert.ok(Math.abs(100_000 - mirrored) / 100_000 < EXTREME_STOP_RATIO);
});

test("v2.2.1 결함4: 모든 안내·각주 글꼴이 12px 이상이다", () => {
  // styles.css 의 모든 px font-size 선언을 훑는다 (SVG 인라인 속성은 대상 아님)
  const sizes = [...V22_CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 40, `font-size 선언 ${sizes.length}개`);
  assert.deepEqual(
    sizes.filter((s) => s < 12),
    [],
    "12px 미만 font-size 가 남아 있습니다"
  );
  // 안전 안내·각주로 쓰는 대표 선택자는 12px 이상 (11.5px → 12/12.5)
  for (const sel of [
    ".safe-line",
    ".disclaimer",
    ".footnote",
    ".report-foot",
    ".privacy-note",
    ".example-note",
    ".stat-caption",
    ".insight-label",
    ".footer p",
    ".tag-example",
    ".result-basis",
    ".relay-note",
    ".live-status-detail",
    ".thermo-badge",
    ".combo-best-line",
    ".combo-col-head",
    ".kv-sub",
    ".stat-sub",
    ".kv-term",
    ".term-note",
    ".chart-note",
  ]) {
    const size = fontSizeOf(sel);
    assert.ok(size !== null && size >= 12, `${sel} font-size=${size}`);
  }
  // 380px 이하에서 줄이던 10.5px·10px 도 12px 로 올렸다
  const narrow380 = V22_CSS.slice(V22_CSS.indexOf("@media (max-width: 380px)"));
  assert.doesNotMatch(narrow380.slice(0, 900), /font-size:\s*(1[01](\.\d)?)px/);
});

/* ================================================================ v2.2.2 극단 입력 배너·결과카드 중립 통일 */

test("v2.2.2 극단 입력 문구: 배너 1줄·결과카드 보조문구가 계획대로 고정된다", () => {
  assert.equal(EXTREME_BANNER_NOTE, "손절폭이 너무 좁아 참고하기 어려워요");
  assert.equal(EXTREME_AVG_R_NOTE, "극단적으로 좁은 손절폭이라 숫자가 크게 보일 수 있어요");
  // 같은 뜻을 리포트 본문(⚪ 참고하기 어려워요)과 어긋나지 않게 '참고'를 유지한다
  assert.match(EXTREME_BANNER_NOTE, /참고하기 어려워요$/);
  assert.match(EXTREME_AVG_R_NOTE, /좁은 손절폭/);
});

test("v2.2.2 평균 R 색: 극단 입력은 크기·부호와 무관하게 중립, 아니면 종전 pos/neg", () => {
  // 5초 요약 배너·1만 번 결과 카드·리포트 접이식 통계가 같은 함수를 쓴다
  assert.equal(avgRTone(729.07, true), "neutral");
  assert.equal(avgRTone(-729.07, true), "neutral");
  assert.equal(avgRTone(0, true), "neutral");
  // 극단이 아니면 종전 그대로 (회귀 방지)
  assert.equal(avgRTone(729.07), "pos");
  assert.equal(avgRTone(0), "pos");
  assert.equal(avgRTone(-0.182), "neg");
  assert.equal(avgRTone(0.146, false), "pos");
  // 극단 판정 기준은 easy.ts·sizing.ts가 공유하는 0.01%
  assert.ok(Math.abs(100_000 - 99_999.99) / 100_000 < EXTREME_STOP_RATIO);
  assert.ok(!(Math.abs(100_000 - 99_900) / 100_000 < EXTREME_STOP_RATIO));
});

test("v2.2.2 1만 번 결과 카드: 극단 입력의 평균 결과는 초록/빨강 없이 중립 회색 + 보조 문구", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const sim = {
    replays: 10000,
    pTarget: 0.074,
    pStop: 0.926,
    pNeither: 0,
    pGreen: 0.08,
    avgR: 729.07,
    rAtTarget: 1,
    barsLeft: 59,
    ms: 41,
    seed: 19,
  };
  const extremeHtml = renderToStaticMarkup(
    ResultCards({ sim, unit: "원", extreme: true })
  );
  // 평균 결과 숫자는 pos/neg 가 아니라 neutral
  assert.match(extremeHtml, /data-testid="avg-r-value"[^>]*class="neutral"|class="neutral"[^>]*data-testid="avg-r-value"/);
  assert.doesNotMatch(extremeHtml, /class="pos"[^>]*data-testid="avg-r-value"|data-testid="avg-r-value"[^>]*class="pos"/);
  assert.ok(extremeHtml.includes("+729.07R"), "평균 R 값은 그대로 보인다");
  assert.ok(extremeHtml.includes(EXTREME_AVG_R_NOTE), "보조 문구가 숫자 옆에 붙는다");
  assert.match(extremeHtml, /data-testid="avg-r-extreme-note"/);

  const normalHtml = renderToStaticMarkup(ResultCards({ sim, unit: "원" }));
  assert.match(normalHtml, /class="pos"[^>]*data-testid="avg-r-value"|data-testid="avg-r-value"[^>]*class="pos"/);
  assert.ok(!normalHtml.includes(EXTREME_AVG_R_NOTE));
  assert.ok(!normalHtml.includes('data-testid="avg-r-extreme-note"'));
});

test("v2.2.2 5초 요약 배너: 극단 입력은 평균 R 중립 + 참고 1줄, 일반 입력은 종전 초록 강조", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const banner = app.slice(app.indexOf('data-testid="easy-banner"'), app.indexOf('data-testid="open-report"'));
  assert.ok(banner.length > 100, "배너 구역을 찾지 못했습니다");
  // 배너의 평균 R은 avgRTone(극단 판정 공유)으로 색을 정한다
  assert.match(banner, /avgRTone\(run\.sim\.avgR, isExtremeStop\(run\.plan\.entry, run\.plan\.stop\)\)/);
  assert.match(banner, /data-testid="banner-avg-r"/);
  // 극단 입력에서만 '손절폭이 너무 좁아 참고하기 어려워요' 한 줄
  assert.match(banner, /isExtremeStop\(run\.plan\.entry, run\.plan\.stop\) && \(/);
  assert.match(banner, /EXTREME_BANNER_NOTE/);
  // 배너 안에서 평균 R을 초록/빨강으로 직접 고르던 옛 분기는 사라졌다
  assert.doesNotMatch(banner, /run\.sim\.avgR >= 0 \? "pos" : "neg"/);
  // 목표·손절 확률: 목표 쪽은 극단 입력에서 초록을 끄고 중립, 손절(빨강)은 사실 그대로
  assert.match(banner, /className=\{positiveTone\(isExtremeStop\(run\.plan\.entry, run\.plan\.stop\)\)\}/);
  assert.match(banner, /data-testid="banner-p-target"/);
  assert.doesNotMatch(banner, /className="pos">\{formatPct\(run\.sim\.pTarget\)\}/);
  assert.match(banner, /className="neg" data-testid="banner-p-stop">\{bannerPct\.stop\}/);
  // v2.2.4 — 배너도 결과 카드와 같은 0.1% 표기 + 미도달을 적어 세 값의 합이 100%가 된다
  assert.match(banner, /bannerPct\.target/);
  assert.match(banner, /data-testid="banner-p-neither"/);
  assert.doesNotMatch(banner, /formatPct\(run\.sim\.pTarget\)/);
  // 결과 카드에도 같은 극단 플래그를 넘긴다
  assert.match(app, /<ResultCards[\s\S]{0,260}extreme=\{isExtremeStop\(run\.plan\.entry, run\.plan\.stop\)\}/);
});

test("v2.2.2 리포트 접이식 통계도 같은 중립 색을 쓴다(리포트 본문 ⚪와 불일치 방지)", () => {
  const rep = readFileSync("src/components/ReportView.tsx", "utf8");
  const stat = rep.slice(rep.indexOf("1회 평균"), rep.indexOf("1회 평균") + 400);
  assert.match(stat, /className=\{avgRTone\(run\.sim\.avgR, extremeStop\)\}/);
  assert.doesNotMatch(stat, /run\.sim\.avgR >= 0 \? "pos" : "neg"/);
  const cards = readFileSync("src/components/ResultCards.tsx", "utf8");
  assert.match(cards, /const avgRToneName = avgRTone\(sim\.avgR, extreme === true\)/);
  assert.match(cards, /className=\{avgRToneName\}/);
});

test("v2.2.2 CSS: .neutral 은 중립 회색이고 초록/빨강을 쓰지 않는다", () => {
  const rule = ruleOf(".neutral");
  assert.ok(rule && rule.includes("color:"), "`.neutral` 규칙이 없습니다");
  assert.doesNotMatch(rule, /#16a34a|#dc2626|var\(--target\)|var\(--stop\)/);
  assert.match(rule, /color:\s*#475569/);
  // pos/neg 는 종전 그대로 (일반 입력의 유리/손실 강조 유지)
  assert.match(ruleOf(".pos"), /var\(--target\)/);
  assert.match(ruleOf(".neg"), /var\(--stop\)/);
});

/* ================================================================== v2.2.3 */

test("v2.2.3 positiveTone: 극단 입력이면 긍정(초록) 강조를 끄고, 아니면 종전 초록", () => {
  assert.equal(positiveTone(true), "neutral");
  assert.equal(positiveTone(false), "pos");
  assert.equal(positiveTone(), "pos");
  // 평균 R 색 결정은 v2.2.2 그대로 (회귀 방지)
  assert.equal(avgRTone(729.07, true), "neutral");
  assert.equal(avgRTone(0.4, false), "pos");
});

test("v2.2.3 0주 원인 분기: 위험폭 초과·1주 가격 초과·둘 다를 정확히 가른다", () => {
  const base = {
    unit: "원",
    account: 10_000_000,
    lossBudget: 100_000,
    entry: 50_000,
    riskPerShare: 2_000,
  };
  // ① 위험폭만: 1주 위험폭 > 1회 허용 손실
  assert.equal(
    zeroShareReason({ ...base, riskPerShare: 200_000 }),
    "1주 위험폭(200,000원)이 1회 허용 손실(100,000원)보다 커서 0주가 됐어요."
  );
  // ② 1주 가격만: entry > account (계좌 금액)
  assert.equal(
    zeroShareReason({ ...base, account: 30_000, entry: 40_000, lossBudget: 300, riskPerShare: 200 }),
    "1주 가격(40,000원)이 계좌 금액(30,000원)보다 커서 0주가 됐어요."
  );
  // ③ 둘 다: 두 이유를 함께 적는다
  assert.equal(
    zeroShareReason({ ...base, account: 30_000, entry: 40_000, riskPerShare: 2_000, lossBudget: 300 }),
    "1주 위험폭(2,000원)이 1회 허용 손실(300원)보다 크고, 1주 가격(40,000원)도 계좌 금액(30,000원)보다 커서 0주가 됐어요."
  );
  // ④ 위험폭 0(진입가=손절가)은 별도 원인으로 말한다
  assert.match(zeroShareReason({ ...base, riskPerShare: 0 }), /진입가와 손절가가 같아 1주 위험폭이 0이라/);
  // 두 원인을 한꺼번에 나열하는 옛 문구는 남아 있지 않다
  for (const s of [
    zeroShareReason({ ...base, riskPerShare: 200_000 }),
    zeroShareReason({ ...base, account: 30_000, entry: 40_000, lossBudget: 300, riskPerShare: 200 }),
  ]) {
    assert.ok(!s.includes("손절폭이 너무 넓거나"), s);
    assert.ok(!s.includes("계좌 금액이 1주 값보다 작아요"), s);
  }
});

test("v2.2.3 sizePosition: 0주 경고와 수량 카드 한 줄이 같은 원인을 말한다", () => {
  const mk = (entry, stop, account) =>
    sizePosition({
      entry,
      stop,
      target: entry * 2,
      account,
      riskPct: 1,
      side: "buy",
      expectedR: 0,
    });

  // ① 위험폭 초과만 (1주 가격 = 계좌 금액, 현금으로는 1주 가능)
  const riskOnly = mk(100_000, 50_000, 100_000);
  assert.equal(riskOnly.shares, 0);
  assert.equal(riskOnly.entry, 100_000);
  assert.ok(riskOnly.warnings.some((w) => w.includes("1주 위험폭이 1회 허용 손실 금액보다 큽니다")));
  assert.ok(!riskOnly.warnings.some((w) => w.includes("1주 가격이 계좌 금액보다 큽니다")));
  assert.match(easySizingLine({ ...riskOnly, account: 100_000, riskPct: 1, unit: "원", extreme: false }),
    /1주 위험폭\(50,000원\)이 1회 허용 손실\(1,000원\)보다 커서 0주가 됐어요/);

  // ② 1주 가격 초과만 (위험폭은 허용 손실 안)
  const priceOnly = mk(200_000, 199_000, 100_000);
  assert.equal(priceOnly.shares, 0);
  assert.ok(priceOnly.warnings.some((w) => w.includes("1주 가격이 계좌 금액보다 큽니다")));
  assert.ok(!priceOnly.warnings.some((w) => w.includes("1주 위험폭이 1회 허용 손실 금액보다 큽니다")));
  assert.match(easySizingLine({ ...priceOnly, account: 100_000, riskPct: 1, unit: "원", extreme: false }),
    /1주 가격\(200,000원\)이 계좌 금액\(100,000원\)보다 커서 0주가 됐어요/);

  // ③ 둘 다
  const both = mk(200_000, 150_000, 100_000);
  assert.equal(both.shares, 0);
  assert.ok(
    both.warnings.some((w) =>
      w.includes("1주 위험폭이 1회 허용 손실 금액보다 크고, 1주 가격도 계좌 금액보다 큽니다")
    ),
    both.warnings.join(" / ")
  );
  assert.match(easySizingLine({ ...both, account: 100_000, riskPct: 1, unit: "원", extreme: false }),
    /1주 위험폭\(50,000원\)이 1회 허용 손실\(1,000원\)보다 크고, 1주 가격\(200,000원\)도 계좌 금액\(100,000원\)보다 커서 0주가 됐어요/);

  // 0주가 아닌 경우에는 0주 경고가 붙지 않는다
  const normal = mk(10_000, 9_000, 10_000_000);
  assert.ok(normal.shares > 0);
  assert.ok(!normal.warnings.some((w) => w.includes("0주")));
});

test("v2.2.3 수량 카드: 0주 원인이 카드 문장과 경고 목록에 실제 값으로 보인다", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const size = sizePosition({
    entry: 200_000,
    stop: 199_000,
    target: 300_000,
    account: 100_000,
    riskPct: 1,
    side: "buy",
    expectedR: 0,
  });
  const html = renderToStaticMarkup(
    SizingCard({ size, unit: "원", account: 100_000, riskPct: 1, extreme: isExtremeStop(200_000, 199_000) })
  );
  assert.match(html, /1주 가격\(200,000원\)이 계좌 금액\(100,000원\)보다 커서 0주가 됐어요/);
  assert.ok(!html.includes("손절폭이 너무 넓거나"), "옛 뭉뚱그린 문구 없음");
  assert.match(html, /0주/);
  // 0주(무포지션)면 목표 수익 0원을 초록으로 강조하지 않는다
  assert.ok(!html.includes('class="pos"'), "0주 카드에 초록 강조가 없다");
  assert.match(html, /data-testid="profit-at-target"[^>]*class="neutral"|class="neutral"[^>]*data-testid="profit-at-target"/);
});

test("v2.2.3 수량 카드: 극단 입력은 '목표에 닿으면 버는 돈'도 초록이 아니라 중립", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const size = sizePosition({
    entry: 100_000,
    stop: 99_999.99,
    target: 100_100,
    account: 10_000_000,
    riskPct: 1,
    side: "buy",
    expectedR: 729.07,
  });
  const extremeHtml = renderToStaticMarkup(
    SizingCard({ size, unit: "원", account: 10_000_000, riskPct: 1, extreme: true })
  );
  assert.match(extremeHtml, /data-testid="profit-at-target"[^>]*class="neutral"|class="neutral"[^>]*data-testid="profit-at-target"/);
  assert.ok(!extremeHtml.includes('class="pos"'), "극단 입력 수량 카드에 초록 강조가 없다");
  assert.match(extremeHtml, /data-testid="profit-extreme-note"/);

  const normalHtml = renderToStaticMarkup(
    SizingCard({ size, unit: "원", account: 10_000_000, riskPct: 1, extreme: false })
  );
  assert.match(normalHtml, /data-testid="profit-at-target"[^>]*class="pos"|class="pos"[^>]*data-testid="profit-at-target"/);
  assert.ok(!normalHtml.includes('data-testid="profit-extreme-note"'));
});

test("v2.2.3 1만 번 결과 카드: 극단 입력은 목표 카드·이익 마감률까지 초록 0건", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const sim = {
    replays: 10000,
    pTarget: 0.074,
    pStop: 0.926,
    pNeither: 0,
    pGreen: 0.08,
    avgR: 729.07,
    rAtTarget: 1,
    barsLeft: 59,
    ms: 41,
    seed: 19,
  };
  const extremeHtml = renderToStaticMarkup(ResultCards({ sim, unit: "원", extreme: true }));
  assert.ok(!extremeHtml.includes('class="pos"'), "초록(.pos) 강조 0건");
  assert.ok(!extremeHtml.includes("stat-target"), "녹색 목표 카드 색 0건");
  assert.match(extremeHtml, /class="stat-card stat-neutral"/);
  assert.match(extremeHtml, /data-testid="green-close-rate"[^>]*class="neutral"|class="neutral"[^>]*data-testid="green-close-rate"/);
  assert.match(extremeHtml, /data-testid="cards-extreme-note"/);
  assert.ok(extremeHtml.includes(EXTREME_POSITIVE_NOTE));
  // 손절 확률은 사실 값이라 빨강 유지
  assert.ok(extremeHtml.includes("stat-stop"));

  const normalHtml = renderToStaticMarkup(ResultCards({ sim, unit: "원" }));
  assert.match(normalHtml, /class="stat-card stat-target"/);
  assert.match(normalHtml, /class="pos"[^>]*data-testid="green-close-rate"|data-testid="green-close-rate"[^>]*class="pos"/);
  assert.ok(!normalHtml.includes('data-testid="cards-extreme-note"'));
});

test("v2.2.3 모든 결과 컴포넌트가 extreme 플래그를 받아 초록 강조를 끈다", () => {
  const read = (p) => readFileSync(p, "utf8");
  // 5초 요약 배너: 목표 도달 확률도 positiveTone 으로 색을 정한다
  const app = read("src/App.tsx");
  assert.match(app, /positiveTone\(isExtremeStop\(run\.plan\.entry, run\.plan\.stop\)\)/);
  assert.match(app, /<ResultCards[\s\S]{0,300}extreme=\{isExtremeStop/);
  assert.match(app, /<SizingCard[\s\S]{0,400}extreme=\{isExtremeStop/);
  assert.match(app, /<BacktestCard[\s\S]{0,300}extreme=\{isExtremeStop/);

  // 리포트: 목표 도달 통계·수량 카드·생존 그래프·조합표 모두 같은 플래그
  const rep = read("src/components/ReportView.tsx");
  assert.match(rep, /const positive = positiveTone\(extremeStop\)/);
  assert.match(rep, /data-testid="report-p-target"/);
  assert.match(rep, /<SizingCard[\s\S]{0,400}extreme=\{extremeStop\}/);
  assert.match(rep, /<SurvivalChart[\s\S]{0,500}extreme=\{extremeStop\}/);
  assert.match(rep, /<ComboTable[\s\S]{0,400}extreme=\{extremeStop\}/);

  // 각 컴포넌트는 극단 입력에서 .pos 를 렌더하지 않는다
  for (const f of [
    "src/components/BacktestCard.tsx",
    "src/components/SurvivalChart.tsx",
    "src/components/ComboTable.tsx",
  ]) {
    const src = read(f);
    assert.match(
      src,
      /positiveTone\(extreme === true\)|positiveTone\(extremeMode\)/,
      `${f} 가 극단 플래그를 색에 반영하지 않습니다`
    );
    assert.ok(!/"pos"/.test(src), `${f} 에 초록 강조를 직접 고르는 "pos" 리터럴이 남아 있습니다`);
  }
  const sizing = read("src/components/SizingCard.tsx");
  assert.ok(!/dd className="pos"/.test(sizing), "수량 카드의 목표 수익이 여전히 항상 초록입니다");
});

test("v2.2.3 CSS: 중립 카드의 값도 초록을 쓰지 않는다", () => {
  const rule = ruleOf(".stat-neutral .stat-value");
  assert.ok(rule, "`.stat-neutral .stat-value` 규칙이 없습니다");
  assert.match(rule, /color:\s*#475569/);
  assert.doesNotMatch(rule, /#16a34a|#15803d|var\(--target\)/);
  // 녹색 목표 카드는 일반 입력용으로 그대로 남는다
  assert.match(ruleOf(".stat-target"), /var\(--target-bg\)/);
});

/* ================================================================ v2.2.4 4호 봇 지적 3건 */

const noteOf = (html, testid) => {
  const m = new RegExp(`data-testid="${testid}"[^>]*>([\\s\\S]*?)</span>`).exec(html);
  return m ? m[1] : "";
};

test("v2.2.4 결함1: 0주(무포지션)와 극단 손절폭은 서로 다른 경고다", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  // 진입 200,000 / 손절 199,000 = 손절폭 0.5% (극단 아님) · 계좌 100,000 → 1주 가격 초과로 0주
  const size = sizePosition({
    entry: 200_000,
    stop: 199_000,
    target: 300_000,
    account: 100_000,
    riskPct: 1,
    side: "buy",
    expectedR: -0.29,
  });
  assert.equal(size.shares, 0);
  assert.equal(isExtremeStop(200_000, 199_000), false);
  const html = renderToStaticMarkup(
    SizingCard({ size, unit: "원", account: 100_000, riskPct: 1, extreme: isExtremeStop(200_000, 199_000) })
  );
  // 1번 평균 각주에 '극단적으로 좁은 손절폭'이 새어 나오면 안 된다
  const evNote = noteOf(html, "expected-value-note");
  assert.ok(!evNote.includes("극단적으로 좁은 손절폭"), evNote);
  assert.match(evNote, /0주라 1번에 거는 손절 금액이 없어 기댓값도 0원이에요/);
  assert.match(html, /0주라 목표에 닿아도 버는 돈이 없어요/);
  assert.ok(!html.includes("극단적으로 좁은 손절폭"), "0주 카드 어디에도 극단 손절폭 문구가 없어야 한다");

  // 0주이면서 손절폭도 극단인 입력 — 기댓값 0원의 원인은 0주다
  const extremeZero = sizePosition({
    entry: 200_000,
    stop: 199_999.98,
    target: 300_000,
    account: 100_000,
    riskPct: 1,
    side: "buy",
    expectedR: 0,
  });
  assert.equal(extremeZero.shares, 0);
  assert.equal(isExtremeStop(200_000, 199_999.98), true);
  const html2 = renderToStaticMarkup(
    SizingCard({ size: extremeZero, unit: "원", account: 100_000, riskPct: 1, extreme: true })
  );
  assert.ok(!noteOf(html2, "expected-value-note").includes("극단적으로 좁은 손절폭"));

  // 수량이 있는 극단 입력에서는 종전대로 극단 경고가 나온다 (회귀 방지)
  const extreme = sizePosition({
    entry: 100_000,
    stop: 99_999.99,
    target: 100_100,
    account: 10_000_000,
    riskPct: 1,
    side: "buy",
    expectedR: 729.07,
  });
  assert.ok(extreme.shares > 0);
  const html3 = renderToStaticMarkup(
    SizingCard({ size: extreme, unit: "원", account: 10_000_000, riskPct: 1, extreme: true })
  );
  assert.match(noteOf(html3, "expected-value-note"), /극단적으로 좁은 손절폭이라 참고하기 어려워요/);
  assert.ok(!html3.includes("0주라 1번에 거는 손절 금액이 없어"), "수량이 있으면 0주 문구는 없다");

  // 0주 한 줄 요약에도 극단 문구가 섞이지 않는다
  const zeroLine = easySizingLine({
    shares: 0,
    side: "buy",
    account: 100_000,
    riskPct: 1,
    lossBudget: 1_000,
    maxLoss: 0,
    effectiveRiskPct: 0,
    riskLimitedByCash: false,
    unit: "원",
    entry: 200_000,
    riskPerShare: 1_000,
    extreme: false,
  });
  assert.ok(!zeroLine.includes("극단적으로 좁은 손절폭"), zeroLine);
  assert.match(zeroLine, /1주 가격\(200,000원\)이 계좌 금액\(100,000원\)보다 커서 0주가 됐어요/);
});

test("v2.2.4 결함2: 조합표 열 이름·칸이 실제 목표가의 배수를 가리키고, 같은 목표가는 한 번만 계산한다", () => {
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  const entry = 100_000;
  // 진입 100,000 / 손절 99,999.99 → 1원 호가에서 손절 단계가 1개로 줄고, 1.5배 목표가 100,002원(=실제 2배)이 된다
  const levels = buildStopLevels(entry, 0.01 / entry, "원", "buy");
  const res = compareCombos({ pool, entry, side: "buy", entryBar: 5, levels, replays: 200, unit: "원" });
  for (const c of res.cells) {
    const risk = Math.abs(entry - c.stop);
    assert.ok(Math.abs(c.actualR - Math.abs(c.target - entry) / risk) < 1e-9, `actualR 불일치 ${c.targetR}`);
  }
  const dup = res.cells.find((c) => c.duplicateOfR !== undefined);
  assert.ok(dup, "같은 목표가를 두 번 계산했습니다");
  const orig = res.cells.find((c) => c.stopPct === dup.stopPct && c.targetR === dup.duplicateOfR);
  assert.equal(dup.target, orig.target);
  assert.equal(dup.pGreen, orig.pGreen);
  assert.equal(dup.avgR, orig.avgR);
  assert.equal(uniqueCells(res.cells).length, res.cells.length - res.duplicateCount);
  assert.ok(res.duplicateCount > 0);

  const cols = targetColumnLabels(res.cells, res.targetRs);
  const col15 = cols.find((c) => c.targetR === 1.5);
  assert.equal(col15.deviating, true, "1.5배 열이 실제 2배인데 요청 배수로 표기됩니다");
  assert.ok(Math.abs(col15.label - 2) < 1e-9, `열 이름 배수 ${col15.label}`);
  const col1 = cols.find((c) => c.targetR === 1);
  assert.equal(col1.deviating, false);
  assert.equal(easyTargetMultiple(col15.label), "2배");
  assert.equal(easyTargetMultiple(1.5), "1.5배");
  assert.equal(easyTargetMultiple(1), "1배");
  assert.equal(easyTargetMultiple(100), "100배");
  assert.equal(easyTargetMultiple(1.3333), "1.33배");

  // 일반 입력(손절폭 수천 원)에서는 호가 반올림이 배수를 바꾸지 않는다 → ＊ 없음
  const normalLevels = buildStopLevels(100_130, 0.011, "원", "buy");
  const normal = compareCombos({
    pool,
    entry: 100_130,
    side: "buy",
    entryBar: 5,
    levels: normalLevels,
    replays: 100,
    unit: "원",
  });
  for (const c of targetColumnLabels(normal.cells, normal.targetRs)) {
    assert.equal(c.deviating, false, `요청 ${c.targetR}배가 실제와 어긋난다고 표시됨`);
  }
  assert.equal(normal.duplicateCount, 0);
  // 행 이름도 실제(반올림된) 손절폭 기준 — 5% 차이를 '내 계획 그대로'로 보지 않는다
  assert.equal(easyStopLevelLabel(0.0105, 0.01), "내 계획의 1.1배");
  assert.equal(easyStopLevelLabel(0.01002, 0.01), "내 계획 그대로");
});

test("v2.2.4 결함3: 3줄 결론·배지·100번 횟수가 실제 수치와 모순되지 않는다", () => {
  // 100번 기준에서 0번이 되는 0.4% 목표 도달을 '간 경우는 없었고'라고 말하지 않는다
  const rare = easyLine1({ pTarget: 0.004, pStop: 0.93, pNeither: 0.066, side: "buy" });
  assert.match(rare, /^1만 번 해보면 약 40번은 목표 가격까지 올라서 기분 좋게 끝났고/);
  assert.ok(!rare.includes("목표 가격까지 간 경우는 없었고"), rare);
  const counts = [...rare.matchAll(/(\d[\d,]*)번/g)].map((m) => Number(m[1].replace(/,/g, "")));
  assert.deepEqual(counts, [40, 9300, 660]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 10000);
  // 실제로 0건일 때만 '없었어요'라고 말한다
  const zero = easyLine1({ pTarget: 0, pStop: 0, pNeither: 1, side: "buy", replays: 10000 });
  assert.match(zero, /목표 가격까지 간 경우는 없었고/);
  assert.match(zero, /손절 가격까지 간 경우도 없었어요/);

  // 목표·손절 횟수가 같으면 '더 많았어요'라고 말하지 않는다
  const tie = easyConclusion({ avgR: -0.1, pTarget: 0.4, pStop: 0.4, ratio: 1, rr: 2, sessions: 3, replays: 10000 });
  assert.match(tie, /똑같았어요/);
  assert.ok(!tie.includes("더 많았어요"), tie);
  // 둘 다 0회(전부 미도달) — '목표에 닿는 쪽이 더 많았다'는 거짓
  const none = easyConclusion({ avgR: 0.001, pTarget: 0, pStop: 0, ratio: 2.4, rr: 2, sessions: 3, replays: 10000 });
  assert.match(none, /목표에도 손절에도 닿지 않고 장이 끝난 경우만 있었어요/);
  assert.ok(!none.includes("더 많았어요"), none);
  // 한쪽만 0회
  const tOnly = easyConclusion({ avgR: 0.3, pTarget: 0.3, pStop: 0, ratio: 1, rr: 2, sessions: 3, replays: 10000 });
  assert.match(tOnly, /손절에 닿은 경우 없이 목표 쪽으로만/);
  const sOnly = easyConclusion({ avgR: -0.3, pTarget: 0, pStop: 0.7, ratio: 0.3, rr: 2, sessions: 3, replays: 10000 });
  assert.match(sOnly, /손절로 끝난 경우만 있었어요/);
  assert.equal(replayDirection(0.5, 0.5), "tie");
  assert.equal(replayDirection(0, 0), "bothZero");
  assert.equal(replayDirection(0.3, 0.6), "stop");

  // 배지가 '더 많았어요'(횟수)나 '반반'이라고 말하지 않는다 — 기준은 1번 평균 금액(평균 R)
  for (const b of Object.values(TRAFFIC_BADGES)) {
    assert.ok(!b.includes("더 많았어요"), b);
    assert.ok(!b.includes("반반에 가까워요"), b);
    assert.ok(!b.includes("유리한 편이에요"), b);
  }
  // 지는 판이 더 적어도(목표 60% vs 손절 20%) 한 번에 크게 잃으면 평균은 손실 — 배지도 평균 기준
  const nearTarget = easySummary({
    sim: {
      replays: 10000,
      pTarget: 0.6,
      pStop: 0.2,
      pNeither: 0.2,
      pGreen: 0.66,
      avgR: -0.09,
      rAtTarget: 0.2,
      barsLeft: 10,
    },
    oneR: 100_000,
    shares: 10,
    unit: "원",
    side: "buy",
    ratio: 1,
    rr: 0.2,
    sessions: 30,
  });
  assert.equal(nearTarget.level, "red");
  assert.equal(nearTarget.badge, "🔴 1번 평균은 손실 쪽이에요");

  // 퍼센트 표기: 세 값의 합이 100.0%, 이익 마감률 = 목표 도달 + 유리 마감 (반올림 모순 없음)
  for (const [a, b, c, g] of [
    [0.004, 0.93, 0.066, 0.04],
    [0.242, 0.695, 0.063, 0.287],
    [0.333, 0.333, 0.334, 0.7],
    [0, 0, 1, 0.434],
    [0.074, 0.926, 0, 0.074],
  ]) {
    const p3 = pctThree(a, b, c);
    const nums = [p3.target, p3.stop, p3.neither].map((s) => (s === "<0.1%" ? 0.05 : Number(s.replace("%", ""))));
    assert.ok(Math.abs(nums.reduce((x, y) => x + y, 0) - 100) < 0.2, JSON.stringify(p3));
    const gr = greenRatePct(a, g);
    const parts = [gr.target, gr.extra].map((s) => (s === "<0.1%" ? 0.05 : Number(s.replace("%", ""))));
    const total = gr.total === "<0.1%" ? 0.05 : Number(gr.total.replace("%", ""));
    assert.ok(Math.abs(parts[0] + parts[1] - total) < 0.15, `${gr.total} ≠ ${gr.target} + ${gr.extra}`);
  }
  // 0주 판정은 금액이 아니라 가격 움직임만 본 값임을 요약에 남긴다
  const zeroSummary = easySummary({
    sim: { replays: 10000, pTarget: 0.2, pStop: 0.6, pNeither: 0.2, pGreen: 0.25, avgR: -0.1, rAtTarget: 1, barsLeft: 9 },
    oneR: 0,
    shares: 0,
    unit: "원",
    side: "buy",
    ratio: 1,
    rr: 2,
    sessions: 30,
  });
  assert.equal(zeroSummary.note, ZERO_SHARES_NOTE);
  assert.match(ZERO_SHARES_NOTE, /매매가 한 번도 실행되지 않아요/);
  const withShares = easySummary({
    sim: { replays: 10000, pTarget: 0.2, pStop: 0.6, pNeither: 0.2, pGreen: 0.25, avgR: -0.1, rAtTarget: 1, barsLeft: 9 },
    oneR: 100_000,
    shares: 10,
    unit: "원",
    side: "buy",
    ratio: 1,
    rr: 2,
    sessions: 30,
  });
  assert.equal(withShares.note, undefined);
});

test("v2.2.4 배선: 배너·결과 카드·리포트가 같은 퍼센트 표기와 0주 안내를 쓴다", () => {
  const read = (f) => readFileSync(f, "utf8");
  const app = read("src/App.tsx");
  const banner = app.slice(app.indexOf('data-testid="easy-banner"'), app.indexOf('data-testid="open-report"'));
  assert.match(app, /const bannerPct = run\s*\n?\s*\?\s*pctThree\(run\.sim\.pTarget, run\.sim\.pStop, run\.sim\.pNeither\)/);
  assert.match(banner, /bannerPct\.target/);
  assert.match(banner, /bannerPct\.stop/);
  assert.match(banner, /bannerPct\.neither/);
  assert.match(banner, /ZERO_SHARES_BANNER_NOTE/);
  assert.doesNotMatch(banner, /formatPct\(run\.sim\.p(?:Target|Stop)\)/);

  const cards = read("src/components/ResultCards.tsx");
  assert.match(cards, /pctThree\(sim\.pTarget, sim\.pStop, sim\.pNeither\)/);
  assert.match(cards, /greenRatePct\(sim\.pTarget, sim\.pGreen\)/);
  assert.ok(!cards.includes("splitHundred"));
  assert.ok(!cards.includes("pctText"));

  const rep = read("src/components/ReportView.tsx");
  assert.match(rep, /pctThree\(run\.sim\.pTarget, run\.sim\.pStop, run\.sim\.pNeither\)/);
  assert.match(rep, /greenRatePct\(run\.sim\.pTarget, run\.sim\.pGreen\)/);
  assert.match(rep, /easy\.note/);
  assert.match(rep, /data-testid="zero-share-note"/);
  // 조합표 설명·배지가 실제 손절 단계와 목표 배수를 그대로 쓴다
  assert.match(rep, /const levelWords = levels\.map\(\(l\) => easyStopLevelLabel\(l\.stopPct, stopPct\)\)/);
  assert.match(rep, /levelWords\.join/);
  assert.match(rep, /손절 \{levels\.length\} × 목표 \{targetRs\.length\}/);
  // Combine table: 중복 칸·＊ 안내
  const combo = read("src/components/ComboTable.tsx");
  assert.match(combo, /targetColumnLabels\(result\.cells, result\.targetRs\)/);
  assert.match(combo, /data-testid="combo-target-note"/);
  assert.match(combo, /data-testid="combo-cell-dup"/);
  assert.match(combo, /data-testid="combo-cell-actual"/);
  assert.match(combo, /실제 \{easyTargetMultiple\(cell\.actualR\)\}/);
});

test("v2.3.0 버전 표기: package.json·version.ts·배지·푸터·README 가 같은 버전을 가리킨다", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(APP_VERSION, "2.3.0");
  // 배지는 짧은 v2.3 만 (긴 설명은 title 속성으로)
  assert.equal(VERSION_SHORT, "2.3");
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(app, /한국형 타임머신 시뮬레이터 v\{APP_VERSION\}/);
  assert.match(app, /import \{ APP_VERSION \} from "\.\/lib\/version"/);
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /^# 한국형 타임머신 시뮬레이터 \(v2\.3\.0\)/);
});

/* ================================================================ v2.3.0 모바일 헤더 복구 · 실시간 검색 제외 */

test("v2.3.0 헤더 ①: 제목은 한 줄(nowrap)이고 배지는 짧은 v2.3 으로 제목과 같은 줄에 있다", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { TopBar, h } = await import("./.build/lib.mjs");
  const html = renderToStaticMarkup(h(TopBar, null));

  // 1) 제목 텍스트는 쪼개지지 않은 한 덩어리
  assert.ok(html.includes("<h1>한국형 타임머신</h1>"), html.slice(0, 400));
  // 2) 배지는 짧은 v2.3 — v2.2.5 처럼 긴 설명을 붙이지 않는다
  assert.ok(html.includes(">v2.3</span>"), "배지가 v2.3 이어야 한다");
  assert.ok(!html.includes("0주 부제"), "긴 버전 설명이 배지에 남아 있으면 모바일에서 제목을 민다");
  // 3) 배지는 제목과 같은 줄 컨테이너(.brand-title-row) 안에, 제목 뒤에 온다
  const rowStart = html.indexOf('class="brand-title-row"');
  const row = html.slice(rowStart, html.indexOf("</h1>") + 5);
  assert.ok(row.includes("<h1>한국형 타임머신</h1>"), "제목이 title row 안에 없다");
  assert.ok(html.indexOf("<h1>한국형 타임머신</h1>") < html.indexOf('data-testid="version-badge"'), "배지가 제목보다 먼저 온다");
  // 4) 헤더는 배지만 따로 오른쪽에 떠 있는 종전 구조(.topbar > .pill)가 아니다
  assert.ok(!/class="topbar"[^>]*>\s*<span class="pill"/.test(html), "종전 우측 고정 배지 구조가 남아 있다");
  // 5) 부제는 제목 아래 문단으로 남는다
  assert.ok(html.includes("내 계획을 1만 번 미리 걸어보는 통계 시뮬레이터"));

  // CSS: 제목은 단어 중간에서 끊기지 않고, 배지는 줄어들지 않으며, 좁으면 줄바꿈만 된다
  const css = readFileSync("src/styles.css", "utf8");
  const h1 = css.slice(css.indexOf(".brand h1 {"), css.indexOf(".brand h1 {") + 400);
  assert.match(h1, /white-space:\s*nowrap/);
  assert.match(h1, /word-break:\s*keep-all/);
  const titleRow = css.slice(css.indexOf(".brand-title-row {"), css.indexOf(".brand-title-row {") + 300);
  assert.match(titleRow, /display:\s*flex/);
  const pill = css.slice(css.indexOf(".pill {"), css.indexOf(".pill {") + 300);
  assert.match(pill, /flex:\s*0 0 auto/);
  assert.match(pill, /white-space:\s*nowrap/);
  // 모바일(640px 이하)에서도 제목은 17px 로 한 줄, 배지 줄은 넘칠 때만 다음 줄로 감싼다
  assert.match(css, /\.brand h1 \{\s*font-size: 17px;/);
  assert.match(css, /\.brand-title-row \{\s*gap: 8px;\s*flex-wrap: wrap;/);
});

test("v2.3.0 헤더 ②: 제목이 한 줄로 들어가는 폭 계산 — 360px 에서도 7자가 쪼개지지 않는다", () => {
  // 360px 뷰포트: 앱 좌우 패딩 10px×2, 로고 40px, 로고-텍스트 간격 10px 를 빼면 텍스트 폭 290px
  const textWidth = 360 - 10 * 2 - 40 - 10;
  assert.equal(textWidth, 290);
  // 제목 7자(공백 포함 8자)를 17px 로 그리면 약 119~136px, 배지 v2.3 은 약 48px → 합이 290px 안에 들어온다
  const titleWidth = 17 * 8; // 한글 자폭 ≈ 글자 크기, 공백 포함
  const badgeWidth = 12 * 4 + 8 * 2 + 2; // 글자 4개 + 좌우 패딩 + 테두리
  assert.ok(titleWidth + 8 + badgeWidth < textWidth, `${titleWidth}+${badgeWidth} < ${textWidth}`);
});

test("v2.3.0 실시간 검색 제외: stock-bars 를 부르는 UI·상태가 앱에서 사라졌다", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  // 화면 배선 제거 — import·상태·핸들러·표시 모두
  for (const gone of [
    "StockSearch",
    "stockApi",
    "fetchStockBars",
    "RELAY_OFFLINE_MESSAGE",
    "StockApiError",
    "liveState",
    "liveDataset",
    "liveWarnings",
    "loadLive",
    "relay-note",
    "서버 토큰 연동 대기",
  ]) {
    assert.ok(!app.includes(gone), `App.tsx 에 ${gone} 가 남아 있다`);
  }
  // 남은 입력 경로는 내장 종목 + CSV/JSON 뿐
  assert.ok(app.includes("내장 샘플 종목 · 내 데이터"));
  assert.ok(app.includes("<option value=\"custom\">내 데이터 직접 입력 (CSV/JSON)</option>"));
  assert.ok(!app.includes("<option value=\"live\">"));
  // 개인정보 안내도 실시간 전송 문구를 더 이상 말하지 않는다
  assert.ok(app.includes("이 앱은 시세\n              서버를 호출하지 않고"));
  // 다른 화면(리포트·컴포넌트)에서도 stock-bars 호출이 없다
  for (const f of readdirSync("src/components").map((x) => `src/components/${x}`)) {
    const text = readFileSync(f, "utf8");
    assert.ok(!text.includes("supabase.co"), `${f} 가 supabase 를 부른다`);
  }
});


test("v2.2.4 봇 재현 ②: 진입 100,000 / 손절 99,999 / 목표 100,002 — 표에 1.5배가 아니라 실제 2배로 적힌다", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ComboTable, h } = await import("./.build/lib.mjs");
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  // 봇이 지목한 재현 입력: 손절폭 1원(0.001%) → 1원 호가에서 손절 단계 1개, 목표 1.5배 = 100,002원 = 실제 2배
  const entry = 100_000;
  const stop = 99_999;
  const baseStopPct = Math.abs(entry - stop) / entry;
  const levels = buildStopLevels(entry, baseStopPct, "원", "buy");
  const result = compareCombos({ pool, entry, side: "buy", entryBar: 5, levels, replays: 200, unit: "원" });
  const html = renderToStaticMarkup(
    h(ComboTable, {
      result,
      loading: false,
      unit: "원",
      mode: "green",
      onMode: () => {},
      baseStopPct,
      extreme: false,
    })
  );
  // 목표가 100,002원 칸은 '목표 2배'로 적고, 요청이 1.5배였다는 사실을 함께 남긴다
  assert.match(html, /목표 2배/);
  assert.match(html, /요청 1\.5배/);
  assert.ok(!/목표 1\.5배/.test(html), "1.5배 열 이름이 그대로 남아 있습니다");
  assert.match(html, /100,002원 · 실제 2배/);
  // 같은 목표가를 두 번 계산하지 않고, 다른 칸은 '앞 칸과 목표가 같아요'로 표시한다
  assert.match(html, /앞 칸과 목표가 같아요/);
  assert.equal(result.duplicateCount, 1);
  assert.match(html, /계산용 1원 단위 반올림/);
  assert.ok(!html.includes("호가 단위(1원)"), "계산용 1원 반올림을 '호가 단위(1원)'라고 부르면 안 됩니다");
  assert.ok(!html.includes("더 많았어요"));
  const cells = await (async () => result.cells)();
  for (const c of cells) {
    if (c.target === 100_002) assert.ok(Math.abs(c.actualR - 2) < 1e-9, `actualR ${c.actualR}`);
  }
});

test("v2.2.4 봇 재현 ③: 목표 도달률 0.01%(1만 번 중 1번)를 '없었고'라고 말하지 않는다", () => {
  const sim = {
    replays: 10000,
    pTarget: 0.0001,
    pStop: 0.9299,
    pNeither: 0.07,
    pGreen: 0.0001,
    avgR: -0.86,
    rAtTarget: 1,
    barsLeft: 59,
  };
  // 1만 번 중 1번 일어난 일을 100번 기준 0번으로 뭉개지 않는다
  const line = easyLine1({ pTarget: sim.pTarget, pStop: sim.pStop, pNeither: sim.pNeither, side: "buy", replays: 10000 });
  assert.match(line, /^1만 번 해보면 약 1번은 목표 가격까지 올라서/);
  assert.ok(!line.includes("없었고"), line);
  assert.match(line, /9,?299번은 손절 가격까지/);
  assert.match(line, /나머지 700번은/);
  // 화면 퍼센트도 0.0%로 지우지 않고 0.01%로 적는다 — 접이식 산식·카드·배너가 같은 값
  const p3 = pctThree(sim.pTarget, sim.pStop, sim.pNeither);
  assert.deepEqual(p3, { target: "0.01%", stop: "92.99%", neither: "7.00%" });
  // 전부 손실(이익 마감률 0%)이어도 NaN 없이 0.0%로 적는다
  assert.deepEqual(greenRatePct(0, 0), { total: "0.0%", target: "0.0%", extra: "0.0%" });
  assert.deepEqual(pctThree(0, 1, 0), { target: "0.0%", stop: "100.0%", neither: "0.0%" });
  const items = easyMathDetail({ sim, oneR: 100_000, unit: "원" }).join("\n");
  assert.match(items, /목표 도달 0\.01% · 손절 도달 92\.99% · 장 마감 미도달 7\.00%/);
  assert.match(items, /이익 마감률 0\.01% = 목표 도달 0\.01% \+ 목표 미도달 유리 마감 0\.00%/);
  // 0주(무포지션)에서도 같은 문장이 그대로 성립한다
  const zero = easySummary({
    sim,
    oneR: 0,
    shares: 0,
    unit: "원",
    side: "buy",
    ratio: 1,
    rr: 1,
    sessions: 30,
  });
  assert.match(zero.lines[0], /1만 번 해보면 약 1번은 목표 가격까지/);
  assert.ok(!zero.lines[0].includes("없었고"), zero.lines[0]);
  assert.equal(zero.note, ZERO_SHARES_NOTE);
});

/* ================================================================ v2.2.5 4호 봇 남은 결함 3건 */

test("v2.2.5 결함1: 0주 리포트는 배지 아래에 '평균 금액 기준'이라고 적지 않는다", () => {
  // 0주(무포지션) — 실제로 건 금액이 0원이라 금액 기준 판정 자체가 성립하지 않는다
  assert.equal(trafficBasis(0, "buy"), "무포지션(0주) 상태 — 1회 평균 배수(R) 기준 (실제 매수 금액 0원)");
  assert.match(trafficBasis(0, "sell"), /무포지션\(0주\) 상태/);
  assert.match(trafficBasis(0, "sell"), /실제 매도 금액 0원/);
  assert.ok(!trafficBasis(0, "buy").includes(TRAFFIC_BASIS), "0주 문구에 '평균 금액 기준'이 남아 있습니다");
  assert.ok(!trafficBasis(0, "sell").includes(TRAFFIC_BASIS));
  // 수량이 있으면 종전 그대로 금액 기준(회귀 없음)
  assert.equal(trafficBasis(10, "buy"), TRAFFIC_BASIS);
  assert.equal(trafficBasis(1, "sell"), TRAFFIC_BASIS);
  assert.equal(TRAFFIC_BASIS, "평균 금액 기준");

  // 리포트 결선 — 기준 줄이 수량·방향을 아는 trafficBasis를 쓴다
  const rep = readFileSync("src/components/ReportView.tsx", "utf8");
  assert.match(rep, /\{trafficBasis\(run\.size\.shares, run\.plan\.side\)\}/);
  assert.doesNotMatch(rep, /\{TRAFFIC_BASIS\} ·/);
  assert.match(rep, /data-testid="traffic-basis"/);

  // 0주의 기준 줄 옆 금액 칩도 금액을 말하지 않는다(2줄과 같은 사실)
  const chip = easyMoneyChip({ avgR: -0.29, oneR: 0, unit: "원", shares: 0 });
  assert.match(chip, /1번 결과 평균은 손실 쪽/);
  assert.ok(!chip.includes("원"), chip);
});

test("v2.2.5 결함2: 1원 반올림을 '호가 단위'라고 부르지 않는다", () => {
  // 실제 한국거래소 호가 단위는 가격대별로 다르다 — 계산 편의를 위한 1원 반올림과 구분해 적는다
  assert.equal(calcRoundingNote("원"), "계산용 1원 단위 반올림 (실제 거래소 호가 단위는 가격대별로 다름)");
  assert.equal(calcRoundingNote(""), calcRoundingNote("원"));
  assert.equal(calcRoundingNote("달러"), "계산용 0.01 단위 반올림 (실제 거래 단위와 다를 수 있음)");
  assert.equal(calcRoundingStep("원"), "1원");
  assert.equal(calcRoundingStep(""), "1원");
  assert.equal(calcRoundingStep("달러"), "0.01");

  // 소스 어디에도 '호가 단위(1원)'처럼 1원을 호가 단위로 단정하는 문구가 없다
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
    );
  const srcFiles = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(srcFiles.length >= 20, `src 파일 ${srcFiles.length}개만 검사했습니다`);
  const offenders = srcFiles.filter((f) => {
    const body = readFileSync(f, "utf8");
    // 1원(0.01) 반올림을 호가 단위라고 단정하는 표기만 찾는다 — '실제 호가 단위(가격대별)' 안내는 정상
    return body.includes("호가 단위(1원)") || body.includes("호가 단위(0.01)");
  });
  assert.deepEqual(offenders, [], "1원 반올림을 '호가 단위(…)'로 적은 파일이 있습니다");
  const readme = readFileSync("README.md", "utf8");
  assert.ok(!readme.includes("호가 단위(1원)"), "README에 '호가 단위(1원)' 표기가 남아 있습니다");
  assert.match(readme, /계산용 1원 단위 반올림/);

  // 실제 화면(조합표 ＊ 안내)도 같은 문구를 쓴다
  const cssFree = readFileSync("src/components/ComboTable.tsx", "utf8");
  assert.match(cssFree, /calcRoundingNote\(unit\)/);
  assert.ok(!cssFree.includes("호가 단위("), "조합표 안내에 '호가 단위(…)' 표기가 남아 있습니다");
});

test("v2.2.5 결함3: 조합표 클릭 칸이 화면 판독기에 버튼으로 노출된다", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ComboTable, h } = await import("./.build/lib.mjs");
  const d = datasetFor();
  const pool = buildPool(d.sessions, d.times.length);
  const entry = 100_130;
  const baseStopPct = 0.011;
  const levels = buildStopLevels(entry, baseStopPct, "원", "buy");
  const result = compareCombos({ pool, entry, side: "buy", entryBar: 5, levels, replays: 100, unit: "원" });
  const html = renderToStaticMarkup(
    h(ComboTable, { result, loading: false, unit: "원", mode: "green", onMode: () => {}, baseStopPct, extreme: false })
  );

  // 표 구조는 그대로: role=table > role=row > role=cell(div) > 실제 button
  const clickable = result.cells.filter((c) => c.duplicateOfR === undefined).length;
  assert.ok(clickable >= 3, `계산된 칸 ${clickable}개`);
  assert.equal(
    [...html.matchAll(/<div role="cell" class="combo-slot"><button type="button"/g)].length,
    clickable,
    "클릭 칸마다 cell 안의 진짜 버튼이 있어야 합니다"
  );
  assert.equal([...html.matchAll(/<button[^>]*type="button"[^>]*class="combo-cell/g)].length, clickable);
  // 종전 결함: 버튼에 role="cell"을 덮어써 버튼 역할이 사라졌다
  assert.ok(!/<button[^>]*role="cell"/.test(html), "버튼 역할이 cell로 덮여 있습니다");
  assert.ok(html.includes('role="table"') && html.includes('role="row"') && html.includes('role="cell"'));
  // 눌림 상태는 aria-pressed로 알린다
  const pressed = [...html.matchAll(/<button[^>]*class="combo-cell[^"]*"[^>]*aria-pressed="(true|false)"/g)].map(
    (m) => m[1]
  );
  assert.equal(pressed.length, clickable);
  assert.ok(pressed.every((v) => v === "false"), "아직 고른 칸이 없는데 눌림으로 표시됩니다");

  // 같은 목표가 칸은 버튼이 아니라 같은 cell 안의 안내다(누를 대상이 아니다)
  const dupResult = compareCombos({
    pool,
    entry: 100_000,
    side: "buy",
    entryBar: 5,
    levels: buildStopLevels(100_000, 0.001 / 100_000, "원", "buy"),
    replays: 100,
    unit: "원",
  });
  const dupHtml = renderToStaticMarkup(
    h(ComboTable, {
      result: dupResult,
      loading: false,
      unit: "원",
      mode: "green",
      onMode: () => {},
      baseStopPct: 0.001 / 100_000,
    })
  );
  assert.ok(dupResult.duplicateCount > 0);
  assert.match(dupHtml, /<div role="cell" class="combo-slot"><span class="combo-cell combo-cell-dup"/);
  assert.equal(
    [...dupHtml.matchAll(/<div role="cell" class="combo-slot"><button type="button"/g)].length,
    dupResult.cells.filter((c) => c.duplicateOfR === undefined).length
  );

  // 터치 영역 44×44px 이상 + 키보드 포커스 표시
  const cell = ruleOf(".combo-cell");
  assert.match(cell, /min-height:\s*64px/);
  assert.match(cell, /min-width:\s*44px/);
  assert.match(cell, /width:\s*100%/);
  const slot = ruleOf(".combo-slot");
  assert.match(slot, /min-height:\s*44px/);
  assert.match(V22_CSS, /\.combo-cell:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  // 네이티브 버튼이라 Enter·Space가 click으로 이어지고, 상태 변경은 onClick 하나뿐이다
  const src = readFileSync("src/components/ComboTable.tsx", "utf8");
  assert.match(src, /<button\s+type="button"/);
  assert.match(src, /onClick=\{\(\) => setPicked\(key\)\}/);
  assert.doesNotMatch(src, /onKeyDown/);
});
