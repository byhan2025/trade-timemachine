import type { Dataset, Session } from "./types";

export interface CustomParseResult {
  dataset: Dataset;
  warnings: string[];
}

interface Row {
  date: string;
  time: string;
  /** 시간 정렬용 분 */
  minutes: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** 엄격 숫자 검사에서 걸린 원문 값 (필드명 → 원문). 비어 있으면 정상 */
  bad: { field: string; raw: string }[];
}

interface ParsedRows {
  rows: Row[];
  /** 날짜·시각을 읽지 못해 제외한 행 수 */
  skipped: number;
  /** 달력에 없는 날짜이거나 00:00~23:59 밖 시각이라 거부한 원문 */
  badStamps: string[];
}

const DATE_KEYS = ["date", "datetime", "time", "timestamp", "일자", "날짜", "시간", "일시", "시각", "체결시각"];
const OPEN_KEYS = ["open", "o", "시가"];
const HIGH_KEYS = ["high", "h", "고가"];
const LOW_KEYS = ["low", "l", "저가"];
const CLOSE_KEYS = ["close", "c", "종가", "현재가"];
const VOLUME_KEYS = ["volume", "vol", "v", "거래량"];

/** 오류 메시지에 한 번에 보여줄 문제 건수 */
const MAX_SHOWN = 3;

/** 숫자 하나로 인정하는 형식 — 100 · 100.5 · .5 · +3 · -2 (지수·문자·단위·공백 불가) */
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

const FIELD_NAME: Record<string, string> = { o: "시가", h: "고가", l: "저가", c: "종가", v: "거래량" };

/** 사용자가 붙여넣거나 올린 텍스트(CSV/JSON) -> 데이터셋 */
export function parseCustom(text: string, name = "내 차트"): CustomParseResult {
  const raw = (text || "").trim();
  if (!raw) throw new Error("붙여넣은 데이터가 비어 있습니다.");
  const parsed =
    raw.startsWith("[") || raw.startsWith("{") ? parseJson(raw) : parseCsv(raw);
  const rows = parsed.rows;

  // 1) 달력에 없는 날짜·시각은 조용히 버리지 않고 명시적으로 알린다.
  if (parsed.badStamps.length) {
    const head = parsed.badStamps.slice(0, MAX_SHOWN).join(" / ");
    const rest =
      parsed.badStamps.length > MAX_SHOWN ? ` 외 ${parsed.badStamps.length - MAX_SHOWN}건` : "";
    throw new Error(
      `데이터를 적용하지 않았습니다. 존재하지 않는 날짜·시각: ${head}${rest}. ` +
        "2026-02-30처럼 달력에 없는 날짜나 25:00처럼 없는 시각은 쓸 수 없습니다. 실제 날짜와 00:00~23:59 시각을 넣어 주세요."
    );
  }
  if (!rows.length) throw new Error("유효한 봉을 읽지 못했습니다. 형식을 확인해 주세요.");

  // 2) 값 검증(정렬 전 원본 순서로 중복·역순까지 확인) — 문제가 있으면 적용하지 않는다.
  const problems = validateRows(rows);
  if (problems.length) {
    const head = problems.slice(0, MAX_SHOWN).join(" / ");
    const rest = problems.length > MAX_SHOWN ? ` 외 ${problems.length - MAX_SHOWN}건` : "";
    throw new Error(
      `데이터를 적용하지 않았습니다. ${head}${rest}. 값을 고친 뒤 다시 [적용하기]를 눌러 주세요.`
    );
  }

  if (rows.length < 9) {
    throw new Error(`봉이 ${rows.length}개뿐입니다. 최소 9개(3일 × 3봉) 이상 필요합니다.`);
  }
  rows.sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1));

  // 3) 날짜별로 묶고, 가장 흔한 봉 개수와 같은 '완전한 날'만 후보로 둔다.
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const count = new Map<number, number>();
  byDate.forEach((list) => count.set(list.length, (count.get(list.length) ?? 0) + 1));
  let sessionBars = 0;
  let best = -1;
  count.forEach((n, k) => {
    if (k >= 3 && n > best) {
      best = n;
      sessionBars = k;
    }
  });
  if (!sessionBars) {
    throw new Error(
      "같은 날짜 안에 봉이 3개 이상인 '분봉' 데이터가 필요합니다. 날짜만 있는 일봉은 1단계에서 지원하지 않습니다."
    );
  }

  const candidates = [...byDate.keys()].filter((d) => byDate.get(d)!.length === sessionBars).sort();
  if (candidates.length < 3) {
    throw new Error(
      `완전한 거래일이 ${candidates.length}일뿐입니다. 같은 봉 개수로 끝나는 거래일이 최소 3일 필요합니다.`
    );
  }

  // 4) 봉 개수만 같다고 같은 세션이 아니다 — 봉 시각(HH:MM) 배열까지 모든 세션이 같아야 한다.
  const sigOf = (d: string) => byDate.get(d)!.map((r) => r.time).join(",");
  const sigCount = new Map<string, number>();
  for (const d of candidates) sigCount.set(sigOf(d), (sigCount.get(sigOf(d)) ?? 0) + 1);
  let chosenSig = sigOf(candidates[candidates.length - 1]);
  let chosenCount = sigCount.get(chosenSig) ?? 0;
  sigCount.forEach((n, s) => {
    if (n > chosenCount) {
      chosenSig = s;
      chosenCount = n;
    }
  });
  const templateTimes = chosenSig.split(",");
  const misaligned = candidates.filter((d) => sigOf(d) !== chosenSig);
  if (misaligned.length) {
    const detail = misaligned.slice(0, 2).map((d) => {
      const list = byDate.get(d)!;
      const at = templateTimes.findIndex((t, i) => list[i]?.time !== t);
      const idx = at >= 0 ? at : Math.min(templateTimes.length, list.length) - 1;
      return `${d} ${idx + 1}번째 봉이 ${templateTimes[idx] ?? "?"} 대신 ${list[idx]?.time ?? "?"}`;
    });
    const rest = misaligned.length > detail.length ? ` 외 ${misaligned.length - detail.length}일` : "";
    throw new Error(
      `데이터를 적용하지 않았습니다. 세션마다 봉 시각이 다릅니다: ${detail.join(" / ")}${rest}. ` +
        `모든 거래일의 봉 시각(HH:MM)이 같은 순서로 같아야 합니다(기준 ${sessionBars}봉: ${
          templateTimes[0]
        }~${templateTimes[templateTimes.length - 1]}).`
    );
  }
  const dates = candidates;

  const template = byDate.get(dates[dates.length - 1])!;
  const times = templateTimes;

  const sessions: Session[] = dates.map((d) => {
    const list = byDate.get(d)!;
    return { date: d, bars: list.map((r) => [r.o, r.h, r.l, r.c, r.v]) };
  });

  // 봉 간격 추정(분)
  const gaps = new Map<number, number>();
  for (let i = 1; i < template.length; i++) {
    const g = template[i].minutes - template[i - 1].minutes;
    if (g > 0) gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let bestGap = 0;
  gaps.forEach((n, g) => {
    if (!bestGap || n > (gaps.get(bestGap) ?? 0)) bestGap = g;
  });
  const gap = bestGap;

  const warnings: string[] = [];
  if (sessions.length < 20) {
    warnings.push(`완전한 거래일이 ${sessions.length}일뿐이라 표본이 적습니다(권장 20일 이상).`);
  }
  if (parsed.skipped > 0) {
    warnings.push(`날짜·시각을 읽지 못한 ${parsed.skipped}개 행은 제외했습니다.`);
  }
  const droppedDays = byDate.size - dates.length;
  if (droppedDays > 0) {
    warnings.push(
      `봉 개수가 ${sessionBars}개와 다른 ${droppedDays}일은 제외했습니다(반장·누락 봉).`
    );
  }

  const dataset: Dataset = {
    id: "custom",
    symbol: name,
    name,
    market: "업로드",
    currency: "",
    priceUnit: "",
    meta: {
      source: "사용자 업로드 데이터(CSV/JSON 붙여넣기 또는 파일)",
      fetchedAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      interval: gap ? `${gap}분봉` : "봉 간격 미상",
      intervalSeconds: gap ? gap * 60 : undefined,
      barTimestampMeans: "입력한 시각",
      sessionStart: times[0] ?? "-",
      sessionEnd: times[times.length - 1] ?? "-",
      sessionBars,
      sessionsUsed: sessions.length,
      firstDate: sessions[0].date,
      lastDate: sessions[sessions.length - 1].date,
      note: `사용자가 올린 데이터입니다. 값 검증(실제 달력 날짜·시각, 시가·고가·저가·종가 범위, 숫자 형식, 중복·역순 시각, 세션별 봉 시각 일치)을 통과한 봉 ${sessionBars}개 × ${sessions.length}일만 사용했습니다.`,
      sessionsDropped: undefined,
    },
    times,
    sessions,
    custom: true,
  };
  return { dataset, warnings };
}

/** 봉 하나하나의 값 검증. 문제를 한국어 문장으로 모아 돌려준다. */
function validateRows(rows: Row[]): string[] {
  const problems: string[] = [];
  const uses: Map<string, number> = new Map();
  const reversed: string[] = [];
  let reversedCount = 0;
  const sorted = rows
    .filter((r) => r.date)
    .slice()
    .sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1));

  // 원본 순서(정렬 전)에서 역순을 먼저 센다.
  const seenOrder = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    const prev = seenOrder.get(r.date);
    if (prev !== undefined && r.minutes < prev) {
      reversedCount++;
      if (reversed.length < 2) reversed.push(`${r.date} ${r.time}`);
    }
    seenOrder.set(r.date, r.minutes);
  }

  for (const r of sorted) {
    const label = `${r.date} ${r.time}`.trim();
    // 3-1) 숫자로 읽혔더라도 원문에 문자·단위·공백이 섞였으면 조용히 넘기지 않는다.
    if (r.bad.length) {
      for (const b of r.bad.slice(0, 2)) {
        problems.push(
          `숫자 형식이 잘못된 값: ${label} ${FIELD_NAME[b.field] ?? b.field} "${b.raw}" — ` +
            "100·100.5처럼 숫자만 넣어 주세요(문자·단위·공백 불가)"
        );
      }
      continue;
    }
    const prices = [r.o, r.h, r.l, r.c];
    if (prices.some((v) => !isFinite(v))) {
      problems.push(
        `가격이 숫자가 아닌 봉: ${label} — 시가·고가·저가·종가를 모두 숫자로 넣어 주세요`
      );
      continue;
    }
    if (prices.some((v) => v <= 0)) {
      problems.push(
        `0 이하 가격이 있는 봉: ${label} (시가 ${fmt(r.o)} / 고가 ${fmt(r.h)} / 저가 ${fmt(
          r.l
        )} / 종가 ${fmt(r.c)}) — 가격은 0보다 커야 합니다`
      );
      continue;
    }
    if (r.h < r.l) {
      problems.push(`고가가 저가보다 낮은 봉: ${label} (고가 ${fmt(r.h)} < 저가 ${fmt(r.l)})`);
    }
    const eps = Math.max(1e-9, Math.abs(r.h) * 1e-9);
    if (r.o < r.l - eps || r.o > r.h + eps) {
      problems.push(
        `시가가 고가·저가 범위를 벗어난 봉: ${label} (시가 ${fmt(r.o)}, 저가 ${fmt(r.l)}~고가 ${fmt(
          r.h
        )})`
      );
    }
    if (r.c < r.l - eps || r.c > r.h + eps) {
      problems.push(
        `종가가 고가·저가 범위를 벗어난 봉: ${label} (종가 ${fmt(r.c)}, 저가 ${fmt(r.l)}~고가 ${fmt(
          r.h
        )})`
      );
    }
    if (isFinite(r.v) && r.v < 0) {
      problems.push(`거래량이 음수인 봉: ${label} (거래량 ${fmt(r.v)}) — 0 이상이어야 합니다`);
    }
    const key = `${r.date}#${r.minutes}`;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }

  const dups = [...uses.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [key, n] of dups.slice(0, 2)) {
    const [date, min] = key.split("#");
    const m = Number(min);
    problems.push(
      `같은 날짜·시각의 봉이 중복: ${date} ${pad(Math.floor(m / 60))}:${pad(m % 60)} (${n}개) — 한 시각에 봉은 하나만 넣어 주세요`
    );
  }
  if (reversedCount > 0) {
    problems.push(
      `시각이 역순인 봉: ${reversed.join(", ")}${
        reversedCount > reversed.length ? ` 외 ${reversedCount - reversed.length}건` : ""
      } — 봉은 이른 시각부터 아래로 정렬해 주세요`
    );
  }
  return problems;
}

function fmt(n: number): string {
  if (!isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}

function parseJson(raw: string): ParsedRows {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("JSON 형식이 올바르지 않습니다.");
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { bars?: unknown[] })?.bars)
      ? ((data as { bars: unknown[] }).bars as unknown[])
      : Array.isArray((data as { data?: unknown[] })?.data)
        ? ((data as { data: unknown[] }).data as unknown[])
        : null;
  if (!list) throw new Error("JSON은 봉 배열([...])이어야 합니다.");
  const rows: Row[] = [];
  const badStamps: string[] = [];
  let skipped = 0;
  for (const item of list) {
    if (Array.isArray(item)) {
      // [시각, 시가, 고가, 저가, 종가, (거래량)]
      if (item.length < 5) {
        skipped++;
        continue;
      }
      const stamp = splitStamp(String(item[0]));
      if (stamp.bad) {
        badStamps.push(stamp.bad);
        continue;
      }
      if (!stamp.date) {
        skipped++;
        continue;
      }
      const bad: Row["bad"] = [];
      const o = readNum(item[1], "o", bad);
      const h = readNum(item[2], "h", bad);
      const l = readNum(item[3], "l", bad);
      const c = readNum(item[4], "c", bad);
      const v = item.length > 5 ? readNum(item[5], "v", bad) : 0;
      rows.push({
        date: stamp.date,
        time: stamp.time,
        minutes: stamp.minutes,
        o,
        h,
        l,
        c,
        v: isFinite(v) ? v : 0,
        bad,
      });
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const datePart = pick(obj, ["date", "day", "일자", "날짜"]);
      const timePart = pick(obj, ["time", "시간"]);
      const stampRaw =
        datePart && timePart
          ? `${datePart} ${timePart}`
          : (pick(obj, DATE_KEYS) ?? [datePart, timePart].filter(Boolean).join(" "));
      const stamp = splitStamp(String(stampRaw ?? ""));
      if (stamp.bad) {
        badStamps.push(stamp.bad);
        continue;
      }
      if (!stamp.date) {
        skipped++;
        continue;
      }
      const bad: Row["bad"] = [];
      const rawV = pick(obj, VOLUME_KEYS);
      const v = rawV === undefined ? 0 : readNum(rawV, "v", bad);
      const o = readNum(pick(obj, OPEN_KEYS), "o", bad);
      const h = readNum(pick(obj, HIGH_KEYS), "h", bad);
      const l = readNum(pick(obj, LOW_KEYS), "l", bad);
      const c = readNum(pick(obj, CLOSE_KEYS), "c", bad);
      rows.push({
        date: stamp.date,
        time: stamp.time,
        minutes: stamp.minutes,
        o,
        h,
        l,
        c,
        v: isFinite(v) ? v : 0,
        bad,
      });
    } else {
      skipped++;
    }
  }
  if (!rows.length && !badStamps.length) throw new Error("JSON에서 시가/고가/저가/종가를 찾지 못했습니다.");
  return { rows, skipped, badStamps };
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of Object.keys(obj)) {
    const norm = k.trim().toLowerCase().replace(/\s|_|-/g, "");
    if (keys.includes(norm)) return obj[k];
  }
  return undefined;
}

function parseCsv(raw: string): ParsedRows {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) throw new Error("CSV 줄이 너무 적습니다.");
  const delim = [",", "\t", ";", "|"]
    .map((d) => [d, lines[0].split(d).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];

  const first = splitLine(lines[0], delim);
  const firstStamp = splitStamp(first[0] ?? "");
  // 첫 줄 첫 칸이 날짜로 읽히면 헤더가 아니라 데이터다.
  const header = !firstStamp.date && !firstStamp.bad;
  const idx = { date: 0, time: -1, o: 1, h: 2, l: 3, c: 4, v: 5 };
  let start = 0;
  if (header) {
    start = 1;
    const names = first.map((x) => x.trim().toLowerCase().replace(/\s|_|-/g, ""));
    const find = (keys: string[]) => names.findIndex((n) => keys.includes(n));
    const di = find(DATE_KEYS);
    const ti = find(["time", "시간"]);
    const oi = find(OPEN_KEYS);
    const hi = find(HIGH_KEYS);
    const li = find(LOW_KEYS);
    const ci = find(CLOSE_KEYS);
    if (di < 0 || oi < 0 || hi < 0 || li < 0 || ci < 0) {
      throw new Error("헤더에서 날짜·시가·고가·저가·종가 열을 찾지 못했습니다.");
    }
    idx.date = di;
    idx.time = ti === di ? -1 : ti;
    idx.o = oi;
    idx.h = hi;
    idx.l = li;
    idx.c = ci;
    idx.v = find(VOLUME_KEYS);
  }

  const rows: Row[] = [];
  const badStamps: string[] = [];
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    if (!cells.length || cells.every((c) => !c.trim())) continue;
    let stamp = cells[idx.date] ?? "";
    if (idx.time >= 0 && cells[idx.time]) stamp = `${stamp} ${cells[idx.time]}`;
    const parsedStamp = splitStamp(stamp);
    if (parsedStamp.bad) {
      badStamps.push(parsedStamp.bad);
      continue;
    }
    if (!parsedStamp.date) {
      skipped++;
      continue;
    }
    const bad: Row["bad"] = [];
    const o = readNum(cells[idx.o], "o", bad);
    const h = readNum(cells[idx.h], "h", bad);
    const l = readNum(cells[idx.l], "l", bad);
    const c = readNum(cells[idx.c], "c", bad);
    const rawV = idx.v >= 0 ? cells[idx.v] : undefined;
    const v = rawV === undefined || rawV === "" ? 0 : readNum(rawV, "v", bad);
    rows.push({
      date: parsedStamp.date,
      time: parsedStamp.time,
      minutes: parsedStamp.minutes,
      o,
      h,
      l,
      c,
      v: isFinite(v) ? v : 0,
      bad,
    });
  }
  if (!rows.length && !badStamps.length) throw new Error("유효한 봉을 읽지 못했습니다. 형식을 확인해 주세요.");
  return { rows, skipped, badStamps };
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === delim && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * 숫자 하나를 엄격하게 읽는다. 숫자가 아니면 NaN.
 * 문자·단위·공백이 섞인 값("100abc", "1 00", "100원")은 부분 숫자로 바꾸지 않고 NaN을 돌려준다.
 * 천 단위 쉼표("1,000")는 형식으로 인정한다.
 */
function parseNum(x: string): number {
  const s = String(x ?? "").trim().replace(/,/g, "");
  if (!NUM_RE.test(s)) return NaN;
  return Number(s);
}

/** 값 읽기 + 원문이 숫자 형식이 아니면 bad에 기록 */
function readNum(x: unknown, field: string, bad: { field: string; raw: string }[]): number {
  if (typeof x === "number") {
    if (!Number.isFinite(x)) bad.push({ field, raw: String(x) });
    return x;
  }
  const text = String(x ?? "").trim();
  if (!text) return NaN;
  const v = parseNum(text);
  if (Number.isNaN(v)) bad.push({ field, raw: text });
  return v;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 1-based 월의 마지막 날 (윤년 반영) */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface Stamp {
  date: string;
  time: string;
  minutes: number;
  /** 날짜 모양이지만 달력에 없거나 시각이 범위를 벗어난 원문 */
  bad?: string;
}

/** "2026-11-18 09:05", "2026/11/18 09:05:00", "20261118 0905", "2026-11-18T09:05" 등 */
function splitStamp(text: string): Stamp {
  const s = (text || "").trim().replace("T", " ");
  const m = s.match(
    /^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:\s+(\d{1,2}):?(\d{2})(?::?(\d{2}))?)?/
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hasTime = m[4] !== undefined;
    const hh = hasTime ? Number(m[4]) : 0;
    const mm = hasTime ? Number(m[5]) : 0;
    const ss = hasTime && m[6] !== undefined ? Number(m[6]) : 0;
    if (!isRealDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) {
      return { date: "", time: "", minutes: 0, bad: s };
    }
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      time: `${pad(hh)}:${pad(mm)}`,
      minutes: hh * 60 + mm,
    };
  }
  // 11/18/2026 09:05 (미국식)
  const us = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (us) {
    const mo = Number(us[1]);
    const d = Number(us[2]);
    const y = Number(us[3]);
    const hh = us[4] !== undefined ? Number(us[4]) : 0;
    const mm = us[5] !== undefined ? Number(us[5]) : 0;
    const ss = us[6] !== undefined ? Number(us[6]) : 0;
    if (!isRealDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) {
      return { date: "", time: "", minutes: 0, bad: s };
    }
    return {
      date: `${y}-${pad(mo)}-${pad(d)}`,
      time: `${pad(hh)}:${pad(mm)}`,
      minutes: hh * 60 + mm,
    };
  }
  return { date: "", time: "", minutes: 0 };
}

/** 실제 달력에 있는 날짜인지 (2026-02-30, 2025-02-29 같은 값 거부) */
function isRealDate(y: number, mo: number, d: number): boolean {
  if (!Number.isInteger(y) || y < 1900 || y > 2200) return false;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > lastDayOfMonth(y, mo)) return false;
  return true;
}
