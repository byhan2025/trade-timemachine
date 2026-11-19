#!/usr/bin/env python3
"""한국형 타임머신 시뮬레이터 - 실제 봉 데이터 수집 스크립트 (표준 라이브러리만 사용).

Yahoo Finance Chart API(v8, 공개 엔드포인트)에서 최근 60거래일 5분봉을 받아
웹앱이 그대로 읽는 public/samples/*.json 으로 저장한다.

    python3 scripts/fetch_samples.py                 # 기본 5종목
    python3 scripts/fetch_samples.py --symbols 005930.KS TSLA
    python3 scripts/fetch_samples.py --out public/samples

원칙
- 합성·보간한 봉은 만들지 않는다. Yahoo가 준 값만 쓴다.
- 세션(거래일)마다 봉 개수가 정확히 같은 "완전 세션"만 남긴다. 반장, 갭,
  진행 중인 당일 세션은 자동으로 빠지고, 몇 개가 빠졌는지 메타데이터에 남긴다.
- 봉 시각은 '봉 시작 시각'이며 거래소 현지 시간대(exchangeTimezoneName)로 기록한다.
- 데이터 단위(5분봉)·통화·가격 단위·수집 시각·출처 URL을 JSON 메타데이터에 명시한다.
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from zoneinfo import ZoneInfo

UA = "Mozilla/5.0 (compatible; trade-timemachine/1.0; +https://github.com/byhan2025)"
HOSTS = ("query2", "query1")
INTERVAL = 300  # 5분봉
RANGE = "60d"
PAUSE = 0.4
BACKOFF = 5.0
MIN_SESSIONS = 20

# 기본 종목: (티커, 표시 이름, 시장 라벨)
DEFAULT_SYMBOLS = [
    ("005930.KS", "삼성전자", "KOSPI"),
    ("000660.KS", "SK하이닉스", "KOSPI"),
    ("005380.KS", "현대차", "KOSPI"),
    ("TSLA", "테슬라", "NASDAQ"),
    ("NVDA", "엔비디아", "NASDAQ"),
]


class FetchError(Exception):
    pass


def chart_url(symbol, host="query2"):
    ticker = urllib.parse.quote(symbol.upper().replace(".", "-")) if False else urllib.parse.quote(symbol.upper())
    return "https://%s.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=5m" % (host, ticker, RANGE)


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def fetch_chart(symbol):
    last = None
    for n, host in enumerate(HOSTS):
        if n:
            time.sleep(PAUSE)
        for attempt in (0, 1):
            try:
                return _get(chart_url(symbol, host))
            except urllib.error.HTTPError as e:
                last = e.code
                if e.code == 429 and attempt == 0:
                    time.sleep(BACKOFF)
                    continue
                if e.code == 404:
                    raise FetchError("%s: Yahoo에 차트가 없습니다 (HTTP 404). 티커를 확인하세요." % symbol)
                break
            except (urllib.error.URLError, OSError) as e:
                raise FetchError("%s: Yahoo에 연결하지 못했습니다: %s" % (symbol, e))
    raise FetchError("%s: Yahoo가 HTTP %s로 응답했습니다. 잠시 후 다시 시도하세요." % (symbol, last))


def parse_chart(text, symbol):
    try:
        data = json.loads(text)
    except ValueError:
        raise FetchError("%s: Yahoo 응답이 JSON이 아닙니다." % symbol)
    chart = (data or {}).get("chart") or {}
    res = chart.get("result")
    if not res:
        err = chart.get("error") or {}
        raise FetchError("%s: 데이터 없음 (%s)" % (symbol, err.get("description") or "unknown"))
    return res[0]


def build_sample(result, symbol, name, market_label):
    meta = result.get("meta") or {}
    tz_name = meta.get("exchangeTimezoneName") or "UTC"
    tz = ZoneInfo(tz_name)
    stamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0] or {}
    cols = [quote.get(k) or [] for k in ("open", "high", "low", "close", "volume")]

    rows = []
    dropped = {"no_price": 0, "off_grid": 0}
    for i, ts in enumerate(stamps):
        o, h, l, c, v = [col[i] if i < len(col) else None for col in cols]
        if ts is None or None in (o, h, l, c):
            dropped["no_price"] += 1
            continue
        ts = int(ts)
        if ts % INTERVAL:
            dropped["off_grid"] += 1
            continue
        local = datetime.datetime.fromtimestamp(ts, tz)
        minutes = local.hour * 60 + local.minute
        rows.append({"date": local.date().isoformat(), "minutes": minutes,
                     "o": o, "h": h, "l": l, "c": c, "v": v or 0})

    if not rows:
        raise FetchError("%s: 유효한 봉이 없습니다." % symbol)

    # 거래일별 봉 시작 시각 목록
    by_date = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(r)

    # 가장 흔한 봉 개수 = 이 시장의 정규 세션 길이 (반장/부분 세션 배제)
    counts = Counter(len(v) for v in by_date.values())
    session_bars = counts.most_common(1)[0][0]
    if session_bars < 5:
        raise FetchError("%s: 정규 세션이 너무 짧습니다 (%d봉)." % (symbol, session_bars))
    # 시작 시각도 최빈값으로 고정
    starts = Counter(min(x["minutes"] for x in v) for v in by_date.values() if len(v) == session_bars)
    session_start = starts.most_common(1)[0][0]

    sessions, short = [], []
    for d in sorted(by_date):
        bars = sorted(by_date[d], key=lambda x: x["minutes"])
        ok = (len(bars) == session_bars
              and min(b["minutes"] for b in bars) == session_start
              and all((b["minutes"] - session_start) % 5 == 0 for b in bars)
              and sorted((b["minutes"] - session_start) // 5 for b in bars) == list(range(session_bars)))
        if not ok:
            short.append({"date": d, "bars": len(bars)})
            continue
        sessions.append({
            "date": d,
            "bars": [[round_float(b["o"]), round_float(b["h"]), round_float(b["l"]), round_float(b["c"]), num(b["v"])]
                     for b in bars],
        })

    if len(sessions) < MIN_SESSIONS:
        raise FetchError("%s: 완전 세션이 %d개뿐입니다 (최소 %d개 필요)." % (symbol, len(sessions), MIN_SESSIONS))

    session_end = session_start + 5 * session_bars
    times = ["%02d:%02d" % divmod(session_start + 5 * i, 60) for i in range(session_bars)]
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))

    price_unit = "원" if (meta.get("currency") == "KRW") else (meta.get("currency") or "")
    sample = {
        "id": symbol.replace(".", "-"),
        "symbol": symbol,
        "name": name,
        "market": market_label,
        "currency": meta.get("currency") or "",
        "priceUnit": price_unit,
        "exchangeTimezone": tz_name,
        "meta": {
            "source": "Yahoo Finance Chart API (v8 공개 엔드포인트)",
            "sourceUrl": chart_url(symbol).split("?")[0] + "?range=%s&interval=5m" % RANGE,
            "fetchedAt": now.isoformat(timespec="seconds"),
            "interval": "5분봉",
            "intervalSeconds": INTERVAL,
            "barTimestampMeans": "봉 시작 시각 (거래소 현지 시각)",
            "sessionStart": "%02d:%02d" % divmod(session_start, 60),
            "sessionEnd": "%02d:%02d" % divmod(session_end, 60),
            "sessionBars": session_bars,
            "sessionsRequested": "최근 60거래일(range=60d)",
            "sessionsUsed": len(sessions),
            "sessionsDropped": short,
            "firstDate": sessions[0]["date"],
            "lastDate": sessions[-1]["date"],
            "droppedBars": dropped,
            "priceUnit": price_unit,
            "note": ("Yahoo가 제공하는 5분봉을 세션별로 검증해 봉 개수가 정확히 같은 완전 세션만 남겼습니다. "
                     "당일 진행 중이거나 반장·갭이 있는 세션은 제외했습니다. " + (
                         "KRX 봉은 Yahoo 제공 기준 %s~%s(5분봉 %d개)이며, 종가 단일가 구간의 별도 봉은 일관되게 "
                         "존재하지 않아 제외했습니다." % (
                             "%02d:%02d" % divmod(session_start, 60),
                             "%02d:%02d" % divmod(session_end, 60), session_bars)
                         if market_label == "KOSPI" else
                         "미국 정규장(ET) %s~%s 5분봉 %d개를 사용했습니다." % (
                             "%02d:%02d" % divmod(session_start, 60),
                             "%02d:%02d" % divmod(session_end, 60), session_bars))),
        },
        "times": times,
        "sessions": sessions,
    }
    return sample


def num(v):
    f = float(v)
    return int(round(f)) if abs(f - round(f)) < 1e-9 else f


def round_float(x):
    """가격은 통화 최소 단위(원/센트)까지만 남긴다."""
    return round(float(x), 2)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Yahoo Finance 실제 5분봉 수집 -> public/samples")
    ap.add_argument("--symbols", nargs="*", default=[s for s, _, _ in DEFAULT_SYMBOLS])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "samples"))
    ap.add_argument("--ticker-only", action="store_true", help="티커만 지정할 때 이름/시장 라벨 자동")
    args = ap.parse_args(argv)

    known = {s: (n, m) for s, n, m in DEFAULT_SYMBOLS}
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    index = []
    for sym in args.symbols:
        name, market = known.get(sym, (sym, "Yahoo"))
        sys.stdout.write("fetching %s ... " % sym)
        sys.stdout.flush()
        result = parse_chart(fetch_chart(sym), sym)
        sample = build_sample(result, sym, name, market)
        path = os.path.join(out, sample["id"] + ".json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(sample, fh, ensure_ascii=False, separators=(",", ":"))
        index.append({
            "id": sample["id"], "symbol": sym, "name": name, "market": market,
            "currency": sample["currency"], "priceUnit": sample["priceUnit"],
            "sessions": len(sample["sessions"]), "sessionBars": sample["meta"]["sessionBars"],
            "sessionStart": sample["meta"]["sessionStart"], "sessionEnd": sample["meta"]["sessionEnd"],
            "firstDate": sample["meta"]["firstDate"], "lastDate": sample["meta"]["lastDate"],
            "fetchedAt": sample["meta"]["fetchedAt"], "file": sample["id"] + ".json",
        })
        print("%d sessions %s~%s, %d bars/session, %.1f KB" % (
            len(sample["sessions"]), sample["meta"]["firstDate"], sample["meta"]["lastDate"],
            sample["meta"]["sessionBars"], os.path.getsize(path) / 1024.0))
        time.sleep(PAUSE)

    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "source": "Yahoo Finance Chart API (v8 공개 엔드포인트)",
            "interval": "5분봉",
            "generatedAt": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec="seconds"),
            "items": index,
        }, fh, ensure_ascii=False, indent=2)
    print("wrote %d samples + index.json -> %s" % (len(index), out))


if __name__ == "__main__":
    try:
        main()
    except FetchError as e:
        sys.exit("error: %s" % e)
