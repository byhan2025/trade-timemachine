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
}

const DATE_KEYS = ["date", "datetime", "time", "timestamp", "일자", "날짜", "시간", "일시"];
const OPEN_KEYS = ["open", "o", "시가"];
const HIGH_KEYS = ["high", "h", "고가"];
const LOW_KEYS = ["low", "l", "저가"];
const CLOSE_KEYS = ["close", "c", "종가", "현재가"];
const VOLUME_KEYS = ["volume", "vol", "v", "거래량"];

/** 사용자가 붙여넣거나 올린 텍스트(CSV/JSON) -> 데이터셋 */
export function parseCustom(text: string, name = "내 차트"): CustomParseResult {
  const raw = (text || "").trim();
  if (!raw) throw new Error("붙여넣은 데이터가 비어 있습니다.");
  let rows: Row[];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    rows = parseJson(raw);
  } else {
    rows = parseCsv(raw);
  }
  if (rows.length < 9) {
    throw new Error(`봉이 ${rows.length}개뿐입니다. 최소 9개(3일 × 3봉) 이상 필요합니다.`);
  }
  rows.sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1));

  // 날짜별로 묶고, 가장 흔한 봉 개수와 같은 '완전한 날'만 사용
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

  const dates = [...byDate.keys()].filter((d) => byDate.get(d)!.length === sessionBars).sort();
  if (dates.length < 3) {
    throw new Error(
      `완전한 거래일이 ${dates.length}일뿐입니다. 같은 봉 개수로 끝나는 거래일이 최소 3일 필요합니다.`
    );
  }

  const template = byDate.get(dates[dates.length - 1])!;
  const times = template.map((r) => r.time);

  const sessions: Session[] = dates.map((d) => {
    const list = byDate.get(d)!;
    return { date: d, bars: list.map((r) => [r.o, r.h, r.l, r.c, r.v]) };
  });

  // 봉 간격 추정(분)
  let gap = 0;
  const gaps = new Map<number, number>();
  for (let i = 1; i < template.length; i++) {
    const g = template[i].minutes - template[i - 1].minutes;
    if (g > 0) gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let bestGap = 0;
  gaps.forEach((n, g) => {
    if (!bestGap || n > (gaps.get(bestGap) ?? 0)) bestGap = g;
  });
  gap = bestGap;

  const warnings: string[] = [];
  if (sessions.length < 20) {
    warnings.push(`완전한 거래일이 ${sessions.length}일뿐이라 표본이 적습니다(권장 20일 이상).`);
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
      note: `사용자가 올린 데이터입니다. 검증하지 않았으며, 봉 개수가 ${sessionBars}개인 ${sessions.length}일만 사용했습니다.`,
      sessionsDropped: undefined,
    },
    times,
    sessions,
    custom: true,
  };
  return { dataset, warnings };
}

function parseJson(raw: string): Row[] {
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
  for (const item of list) {
    if (Array.isArray(item)) {
      // [시각, 시가, 고가, 저가, 종가, (거래량)]
      if (item.length >= 5) {
        const { date, time, minutes } = splitStamp(String(item[0]));
        rows.push({
          date,
          time,
          minutes,
          o: num(item[1]),
          h: num(item[2]),
          l: num(item[3]),
          c: num(item[4]),
          v: item.length > 5 ? num(item[5]) : 0,
        });
      }
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const datePart = pick(obj, ["date", "day", "일자", "날짜"]);
      const timePart = pick(obj, ["time", "시간"]);
      const stampRaw =
        datePart && timePart
          ? `${datePart} ${timePart}`
          : (pick(obj, DATE_KEYS) ?? [datePart, timePart].filter(Boolean).join(" "));
      const { date, time, minutes } = splitStamp(String(stampRaw ?? ""));
      rows.push({
        date,
        time,
        minutes,
        o: num(pick(obj, OPEN_KEYS)),
        h: num(pick(obj, HIGH_KEYS)),
        l: num(pick(obj, LOW_KEYS)),
        c: num(pick(obj, CLOSE_KEYS)),
        v: num(pick(obj, VOLUME_KEYS) ?? 0),
      });
    }
  }
  if (!rows.length) throw new Error("JSON에서 시가/고가/저가/종가를 찾지 못했습니다.");
  return rows;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of Object.keys(obj)) {
    const norm = k.trim().toLowerCase().replace(/\s|_|-/g, "");
    if (keys.includes(norm)) return obj[k];
  }
  return undefined;
}

function parseCsv(raw: string): Row[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) throw new Error("CSV 줄이 너무 적습니다.");
  const delim = [",", "\t", ";", "|"]
    .map((d) => [d, lines[0].split(d).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];

  const first = splitLine(lines[0], delim);
  const header = first.some((cell) => /[a-zA-Z가-힣]/.test(cell)) && isNaN(parseNum(first[1] ?? ""));
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
  for (let i = start; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    if (!cells.length || cells.every((c) => !c.trim())) continue;
    let stamp = cells[idx.date] ?? "";
    if (idx.time >= 0 && cells[idx.time]) stamp = `${stamp} ${cells[idx.time]}`;
    const { date, time, minutes } = splitStamp(stamp);
    const o = num(cells[idx.o]);
    const h = num(cells[idx.h]);
    const l = num(cells[idx.l]);
    const c = num(cells[idx.c]);
    if (!date || [o, h, l, c].some((x) => !isFinite(x))) continue;
    rows.push({ date, time, minutes, o, h, l, c, v: idx.v >= 0 ? num(cells[idx.v]) : 0 });
  }
  if (!rows.length) throw new Error("유효한 봉을 읽지 못했습니다. 형식을 확인해 주세요.");
  return rows;
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

function parseNum(x: string): number {
  return Number(x.replace(/,/g, "").replace(/[^\d.+-]/g, ""));
}

function num(x: unknown): number {
  if (typeof x === "number") return x;
  return parseNum(String(x ?? ""));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-18 09:05", "2026/11/18 09:05:00", "20261118 0905", "2026-11-18T09:05" 등 */
function splitStamp(text: string): { date: string; time: string; minutes: number } {
  const s = (text || "").trim().replace("T", " ");
  const m = s.match(
    /^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:\s+(\d{1,2}):?(\d{2})(?::?(\d{2}))?)?/
  );
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (m[4] !== undefined) {
      const hh = Number(m[4]);
      const mm = Number(m[5]);
      return { date, time: `${pad(hh)}:${pad(mm)}`, minutes: hh * 60 + mm };
    }
    return { date, time: "00:00", minutes: 0 };
  }
  // 11/18/2026 09:05 (미국식)
  const us = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (us) {
    const date = `${us[3]}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`;
    const hh = us[4] !== undefined ? Number(us[4]) : 0;
    const mm = us[5] !== undefined ? Number(us[5]) : 0;
    return { date, time: `${pad(hh)}:${pad(mm)}`, minutes: hh * 60 + mm };
  }
  return { date: "", time: "", minutes: 0 };
}
