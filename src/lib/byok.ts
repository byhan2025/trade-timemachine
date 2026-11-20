import type { Bar, Dataset, Session } from "./types";

/**
 * BYOK(Bring Your Own Key) — 방문자가 자기 무료 API 키로 5분봉을 직접 받아오는 경로 (v2.3.1).
 *
 * 원칙
 * 1. 키는 이 사이트 서버로 절대 보내지 않는다. 브라우저가 시세 제공처(api.twelvedata.com)에
 *    직접 요청하고, 키는 그 요청 URL 에만 붙는다.
 * 2. 기본 보관은 메모리(새로 고침하면 사라짐). 방문자가 체크할 때만 이 브라우저
 *    localStorage 에 남긴다.
 * 3. 응답은 기존 내장 샘플과 같은 Dataset 모양으로 바꾼다(완전한 세션만 사용).
 *
 * 검증한 사실 (2026-11-20, 제공처 공식 문서·실응답)
 * - `GET https://api.twelvedata.com/time_series` 는 `access-control-allow-origin: *` 를 돌려주어
 *   브라우저에서 직접 부를 수 있다(Origin: https://byhan2025.github.io 로 확인).
 * - `interval=5min`, `outputsize` 최대 5000. 5000봉이면 미국 정규장 78봉 × 64일 수준.
 * - 무료 Basic 플랜: 분당 8회·하루 800회, 시장 3곳(미국 주식·외환·암호화폐).
 *   → 무료 키로 한국(KRX) 종목 5분봉은 받을 수 없다. 한국은 HTS CSV 경로를 안내한다.
 * - 오류는 HTTP 상태와 본문 `code` 가 같은 값을 쓴다(401·403·429·404).
 */

export const TD_TIME_SERIES = "https://api.twelvedata.com/time_series";
export const TD_REGISTER_URL = "https://twelvedata.com/register";
export const TD_KEYS_URL = "https://twelvedata.com/account/api-keys";
export const TD_SITE_URL = "https://twelvedata.com";
export const BYOK_STORAGE_KEY = "ttm.byok.twelvedata.key.v1";
/** 무료 플랜에서도 받을 수 있는 최대 봉 수 */
export const BYOK_MAX_BARS = 5000;
/** 계산에 쓸 최소 완전 세션 수 (앱 엔진과 같은 기준) */
export const BYOK_MIN_SESSIONS = 3;

export type ByokErrorKind =
  | "input"
  | "key"
  | "plan"
  | "limit"
  | "symbol"
  | "session"
  | "network"
  | "server";

export class ByokError extends Error {
  kind: ByokErrorKind;
  status: number;
  constructor(kind: ByokErrorKind, message: string, status = 0) {
    super(message);
    this.name = "ByokError";
    this.kind = kind;
    this.status = status;
  }
}

export interface TdValue {
  datetime: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume?: string | number;
}

export interface TdMeta {
  symbol?: string;
  interval?: string;
  currency?: string;
  exchange?: string;
  exchange_timezone?: string;
  type?: string;
}

export interface TdResponse {
  meta?: TdMeta;
  values?: TdValue[];
  status?: string;
  code?: number;
  message?: string;
}

/** 입력 티커 정리 — 앞뒤 공백 제거, 영문은 대문자 (예: ` aapl ` → `AAPL`) */
export function normalizeSymbol(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** 6자리 숫자(또는 .KS/.KQ/.KRX) = 한국 종목 코드로 본다 — 안내 문구 분기용 */
export function looksKoreanTicker(symbol: string): boolean {
  return /^\d{6}(\.(KS|KQ|KRX))?$/.test(normalizeSymbol(symbol));
}

export function buildTimeSeriesUrl(symbol: string, apiKey: string, outputsize = BYOK_MAX_BARS): string {
  const params = new URLSearchParams({
    symbol: normalizeSymbol(symbol),
    interval: "5min",
    outputsize: String(outputsize),
    apikey: String(apiKey ?? "").trim(),
  });
  return `${TD_TIME_SERIES}?${params.toString()}`;
}

/** 제공처 응답에서 키가 그대로 되돌아와도 화면·로그에 남기지 않는다 */
export function redactKey(text: string, apiKey: string): string {
  const key = String(apiKey ?? "").trim();
  if (!key || key.length < 4) return text;
  return text.split(key).join("***");
}

const ERROR_MESSAGES: Record<ByokErrorKind, string> = {
  input: "API 키와 티커를 먼저 입력해 주세요.",
  key: "API 키가 올바르지 않아요. 발급 사이트의 내 API 키 화면에서 키를 다시 복사해 주세요. (오류 401)",
  plan:
    "이 키로는 이 종목의 5분봉을 받을 수 없어요. Twelve Data 무료 플랜은 미국 주식·외환·암호화폐만 열려 있어서 한국 종목은 유료 플랜이 필요합니다. 한국 종목은 아래 4단계(증권사 HTS CSV)로 넣어 주세요. (오류 403)",
  limit:
    "조회 한도를 넘었어요. 무료 플랜은 1분에 8회, 하루 800회까지예요. 1분쯤 뒤에 다시 눌러 주세요. (오류 429)",
  symbol:
    "이 티커의 5분봉을 찾지 못했어요. 미국 종목은 AAPL·TSLA처럼 영문 티커로 넣어 주세요. (오류 404)",
  session: `완전한 하루(세션)가 ${BYOK_MIN_SESSIONS}일 이상 있는 종목만 계산할 수 있어요. 이 종목은 온전한 5분봉 하루가 너무 적어요. 다른 종목을 넣거나 CSV를 올려 주세요.`,
  network:
    "브라우저가 시세 제공처에 연결하지 못했어요. 인터넷 연결과 광고 차단 프로그램을 확인하고, 주소가 https 인지도 봐 주세요.",
  server: "시세 제공처 서버가 잠시 응답하지 않아요. 잠시 뒤 다시 시도해 주세요. (오류 500번대)",
};

export function messageFor(kind: ByokErrorKind): string {
  return ERROR_MESSAGES[kind];
}

/** HTTP 상태 + 본문을 사람이 읽을 수 있는 오류로 바꾼다 */
export function errorFromResponse(status: number, body: unknown): ByokError {
  const code = Number((body as TdResponse | null)?.code ?? 0);
  const effective = code || status;
  if (effective === 401) return new ByokError("key", ERROR_MESSAGES.key, effective);
  if (effective === 403) return new ByokError("plan", ERROR_MESSAGES.plan, effective);
  if (effective === 429) return new ByokError("limit", ERROR_MESSAGES.limit, effective);
  if (effective === 400 || effective === 404) return new ByokError("symbol", ERROR_MESSAGES.symbol, effective);
  if (effective >= 500) return new ByokError("server", ERROR_MESSAGES.server, effective);
  return new ByokError("server", ERROR_MESSAGES.server, effective || status);
}

function toNumber(v: string | number | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function minutesOf(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stampOf(raw: string): { date: string; time: string } | null {
  // "2026-11-19 15:55:00" · "2026-11-19T15:55:00" · "2026-11-19 15:55"
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(raw ?? "").trim());
  if (!m) return null;
  return { date: m[1], time: `${m[2]}:${m[3]}` };
}

/**
 * 세션 봉 시각 격자 — 하루 봉 수의 최빈값과 그날들의 (첫 시각·끝 시각) 최빈 조합으로
 * 5분 간격 격자를 만든다. 반장·지연 개장·진행 중 세션은 여기서 걸러진다.
 */
export function sessionGrid(dayTimes: string[][]): { times: string[]; stepMinutes: number } | null {
  const usable = dayTimes.filter((t) => t.length > 1);
  if (!usable.length) return null;
  const countOf = new Map<number, number>();
  for (const t of usable) countOf.set(t.length, (countOf.get(t.length) ?? 0) + 1);
  const bestLen = [...countOf.entries()].reduce(
    (acc, [len, n]) => (n > acc.n || (n === acc.n && len > acc.len) ? { len, n } : acc),
    { len: 0, n: -1 }
  ).len;
  const sameLen = usable.filter((t) => t.length === bestLen);
  const pairOf = new Map<string, { first: string; last: string; n: number }>();
  for (const t of sameLen) {
    const first = t[0];
    const last = t[t.length - 1];
    const key = `${first}-${last}`;
    const cur = pairOf.get(key);
    if (cur) cur.n += 1;
    else pairOf.set(key, { first, last, n: 1 });
  }
  let bestFirst = "";
  let bestLast = "";
  let bestN = -1;
  for (const p of pairOf.values()) {
    if (p.n > bestN) {
      bestN = p.n;
      bestFirst = p.first;
      bestLast = p.last;
    }
  }
  if (!bestFirst || !bestLast) return null;
  const firstMin = minutesOf(bestFirst);
  const lastMin = minutesOf(bestLast);
  if (!Number.isFinite(firstMin) || !Number.isFinite(lastMin) || lastMin <= firstMin) return null;
  const rawStep = (lastMin - firstMin) / (bestLen - 1);
  const step = Math.round(rawStep);
  if (step <= 0 || Math.abs(rawStep - step) > 1e-6) return null;
  const times: string[] = [];
  for (let i = 0; i < bestLen; i++) {
    const m = firstMin + step * i;
    times.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return { times, stepMinutes: step };
}

export function unitForCurrency(currency: string): string {
  if (currency === "KRW") return "원";
  if (currency === "JPY") return "엔";
  return currency || "";
}

/**
 * Twelve Data 응답 → 앱 Dataset.
 * 완전한 세션(모든 격자 시각이 있는 날)만 남기고, 3일 미만이면 ByokError("session").
 */
export function datasetFromTwelveData(
  body: TdResponse,
  symbol: string,
  now: string = new Date().toISOString()
): Dataset {
  if (body?.status === "error") throw errorFromResponse(Number(body.code ?? 0), body);
  const sym = normalizeSymbol(body?.meta?.symbol || symbol);
  const byDate = new Map<string, Map<string, Bar>>();
  const badRows: string[] = [];
  for (const v of body?.values ?? []) {
    const stamp = stampOf(v?.datetime ?? "");
    if (!stamp) {
      badRows.push(String(v?.datetime ?? ""));
      continue;
    }
    const o = toNumber(v.open);
    const h = toNumber(v.high);
    const l = toNumber(v.low);
    const c = toNumber(v.close);
    const vol = toNumber(v.volume ?? 0);
    if (!(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) {
      badRows.push(`${stamp.date} ${stamp.time}`);
      continue;
    }
    if (!(h >= Math.max(o, c) - 1e-9) || !(l <= Math.min(o, c) + 1e-9) || !(l <= h)) {
      badRows.push(`${stamp.date} ${stamp.time}`);
      continue;
    }
    if (!Number.isFinite(vol) || vol < 0) {
      badRows.push(`${stamp.date} ${stamp.time}`);
      continue;
    }
    if (!byDate.has(stamp.date)) byDate.set(stamp.date, new Map());
    byDate.get(stamp.date)!.set(stamp.time, [o, h, l, c, vol || 0]);
  }

  const dates = [...byDate.keys()].sort();
  if (!dates.length) throw new ByokError("symbol", ERROR_MESSAGES.symbol, 404);

  const grid = sessionGrid(dates.map((d) => [...byDate.get(d)!.keys()].sort()));
  if (!grid) throw new ByokError("session", ERROR_MESSAGES.session);

  const sessions: Session[] = [];
  const dropped: { date: string; bars: number }[] = [];
  for (const date of dates) {
    const map = byDate.get(date)!;
    const bars: Bar[] = [];
    let complete = true;
    for (const t of grid.times) {
      const bar = map.get(t);
      if (!bar) {
        complete = false;
        break;
      }
      bars.push(bar);
    }
    if (!complete) {
      dropped.push({ date, bars: map.size });
      continue;
    }
    sessions.push({ date, bars });
  }

  if (sessions.length < BYOK_MIN_SESSIONS) throw new ByokError("session", ERROR_MESSAGES.session);

  const currency = (body?.meta?.currency || "USD").toUpperCase();
  const intervalMinutes = grid.stepMinutes;

  return {
    id: `byok-${sym}`,
    symbol: sym,
    name: sym,
    market: body?.meta?.exchange || "해외",
    currency,
    priceUnit: unitForCurrency(currency),
    exchangeTimezone: body?.meta?.exchange_timezone,
    live: true,
    times: grid.times,
    sessions,
    meta: {
      source: "Twelve Data (내 API 키로 브라우저에서 직접 조회)",
      sourceUrl: TD_SITE_URL,
      fetchedAt: now,
      interval: intervalMinutes === 5 ? "5분봉" : `${intervalMinutes}분봉`,
      intervalSeconds: intervalMinutes * 60,
      intervalRegular: true,
      barTimestampMeans: "봉 시작 시각 (거래소 현지 시각)",
      sessionStart: grid.times[0],
      sessionEnd: grid.times[grid.times.length - 1],
      sessionBars: grid.times.length,
      sessionsUsed: sessions.length,
      firstDate: sessions[0].date,
      lastDate: sessions[sessions.length - 1].date,
      ...(dropped.length ? { sessionsDropped: dropped.slice(-8) } : {}),
      note:
        "내 API 키로 브라우저가 직접 받은 5분봉을, 봉 개수가 정확히 같은 완전한 하루만 남겨 쓴 것입니다. " +
        "이 사이트는 이 데이터를 저장하거나 재배포하지 않으며, 화면 계산에만 씁니다." +
        (badRows.length ? ` 값이 어긋나 제외한 봉 ${badRows.length}개.` : ""),
    },
  };
}

/* ------------------------------------------------------------------ 보관 */

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStore(store: KeyStore | null | undefined): KeyStore | null {
  if (!store) return null;
  try {
    // 사파리 비공개 모드 등에서 접근 자체가 던지는 경우가 있다
    const probe = "__ttm_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function loadStoredKey(store: KeyStore | null | undefined): string {
  const s = safeStore(store);
  if (!s) return "";
  try {
    return String(s.getItem(BYOK_STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function saveStoredKey(store: KeyStore | null | undefined, key: string): boolean {
  const s = safeStore(store);
  if (!s) return false;
  try {
    s.setItem(BYOK_STORAGE_KEY, String(key ?? "").trim());
    return true;
  } catch {
    return false;
  }
}

export function clearStoredKey(store: KeyStore | null | undefined): void {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.removeItem(BYOK_STORAGE_KEY);
  } catch {
    /* 무시 — 지우지 못해도 화면은 계속 동작한다 */
  }
}
