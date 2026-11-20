#!/usr/bin/env python3
"""가상(합성) 체험 5분봉 생성기 — v2.3.1

왜 가상 데이터인가
  실제 5분봉(Yahoo·네이버·KRX 공공데이터 등)은 약관상 공개 사이트에 그대로 실어
  재배포(내장)할 수 있는 곳이 확인되지 않았다. 그래서 체험용 예시는 실제 시세를 쓰지 않고
  **무작위로 만든 가상 패턴**으로 채운다. 저작권·약관 쟁점이 없고, 화면·출처란에
  "가상 생성 통계 예시"라고 100% 표시한다.

원칙
  - 표준 라이브러리만 사용(추가 설치 없음), 고정 시드 → 다시 실행해도 같은 파일.
  - 세션마다 봉 수가 정확히 같다(앱 엔진이 '완전한 하루'만 쓰기 때문).
  - 고가 ≥ max(시가, 종가), 저가 ≤ min(시가, 종가), 모든 가격 > 0, 거래량 ≥ 0.
  - 실제 종목명·티커·실제 날짜의 시세와 무관한 이름(SYN-*)만 쓴다.

    python3 scripts/make_synthetic_samples.py
"""
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "samples"
GENERATED_AT = "2026-11-20T10:00:00+09:00"
LAST_SESSION = date(2026, 11, 19)
NOTE = (
    "무작위로 만든 가상의 5분봉입니다. 실제 종목·실제 시세와 무관하며, 저작권·약관 문제가 없도록 "
    "생성했습니다. 통계 시뮬레이션 화면을 미리 체험하는 용도입니다."
)

KR = {"tz": "Asia/Seoul", "start": "09:00", "end": "14:55", "bars": 72}
US = {"tz": "America/New_York", "start": "09:30", "end": "15:55", "bars": 78}

PATTERNS = [
    dict(
        id="SYN-STABLE",
        name="[가상 체험] 대형주 안정형 패턴",
        market="가상 시장 (한국 정규장 시간)",
        currency="KRW",
        session=KR,
        start=62_000,
        sigma=0.0009,
        drift=0.000004,
        jump_p=0.0,
        jump=0.0,
        anchor_pull=0.0006,
        volume=210_000,
        seed=1101,
        desc="하루 흔들림이 작고 완만하게 오르내리는 대형주 느낌의 가상 패턴",
    ),
    dict(
        id="SYN-THEME",
        name="[가상 체험] 고변동 테마주 패턴",
        market="가상 시장 (한국 정규장 시간)",
        currency="KRW",
        session=KR,
        start=8_400,
        sigma=0.0038,
        drift=0.00002,
        jump_p=0.012,
        jump=0.012,
        anchor_pull=0.0004,
        volume=1_450_000,
        seed=2202,
        desc="봉마다 흔들림이 크고 간헐적으로 튀는 테마주 느낌의 가상 패턴",
    ),
    dict(
        id="SYN-UPTREND",
        name="[가상 체험] 완만한 상승 우량주 패턴",
        market="가상 시장 (미국 정규장 시간)",
        currency="USD",
        session=US,
        start=148.0,
        sigma=0.0011,
        drift=0.00006,
        jump_p=0.0,
        jump=0.0,
        anchor_pull=0.0,
        volume=950_000,
        seed=3303,
        desc="하루하루 조금씩 우상향하는 우량주 느낌의 가상 패턴",
    ),
    dict(
        id="SYN-REBOUND",
        name="[가상 체험] 급락 뒤 반등형 패턴",
        market="가상 시장 (미국 정규장 시간)",
        currency="USD",
        session=US,
        start=96.5,
        sigma=0.0026,
        drift=0.00001,
        jump_p=0.004,
        jump=0.006,
        anchor_pull=0.0,
        volume=1_800_000,
        seed=4404,
        shock_session=21,
        shock_pct=-0.07,
        post_drift=0.00009,
        desc="중간에 하루 크게 빠진 뒤 천천히 되돌아오는 모양의 가상 패턴",
    ),
    dict(
        id="SYN-BOX",
        name="[가상 체험] 박스권 횡보형 패턴",
        market="가상 시장 (한국 정규장 시간)",
        currency="KRW",
        session=KR,
        start=34_000,
        sigma=0.0008,
        drift=0.0,
        jump_p=0.0,
        jump=0.0,
        anchor_pull=0.004,
        volume=320_000,
        seed=5505,
        desc="정해진 가격대를 크게 벗어나지 않고 오가는 박스권 가상 패턴",
    ),
]


def business_days(end: date, n: int):
    days = []
    d = end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return list(reversed(days))


def times_of(session):
    h0, m0 = map(int, session["start"].split(":"))
    out = []
    for i in range(session["bars"]):
        m = h0 * 60 + m0 + 5 * i
        out.append(f"{m // 60:02d}:{m % 60:02d}")
    assert out[-1] == session["end"], out[-1]
    return out


def build(p, sessions_n=45):
    rnd = random.Random(p["seed"])
    days = business_days(LAST_SESSION, sessions_n)
    times = times_of(p["session"])
    anchor = float(p["start"])
    price = anchor
    sessions = []
    for s, day in enumerate(days):
        gap = rnd.gauss(0, p["sigma"] * 0.5)
        open_price = price * (1 + gap)
        if p.get("shock_session") == s:
            open_price *= 1 + p["shock_pct"]
        drift = p["drift"] + (p.get("post_drift", 0.0) if s > p.get("shock_session", 10**9) else 0.0)
        bars = []
        cur_open = open_price
        for b in range(len(times)):
            r = drift + rnd.gauss(0, p["sigma"])
            if p["jump_p"] and rnd.random() < p["jump_p"]:
                r += rnd.gauss(0, p["jump"])
            if p["anchor_pull"]:
                r += p["anchor_pull"] * math.log(anchor / cur_open)
            close = cur_open * (1 + r)
            close = max(close, cur_open * 0.985)
            hi = max(cur_open, close) * (1 + abs(rnd.gauss(0, p["sigma"] * 0.65)))
            lo = min(cur_open, close) * (1 - abs(rnd.gauss(0, p["sigma"] * 0.65)))
            base = p["volume"] * (0.55 + 1.9 * math.exp(-b / 9))
            vol = max(1, int(base * (0.55 + rnd.random())))
            if p["currency"] == "KRW":
                o, c, h, l = (round(x) for x in (cur_open, close, hi, lo))
                o, c = max(o, 1), max(c, 1)
                h, l = max(h, o, c), min(l, o, c)
            else:
                o, c, h, l = (round(x, 2) for x in (cur_open, close, hi, lo))
                o, c = max(o, 0.01), max(c, 0.01)
                h, l = max(h, o, c), min(l, o, c)
            bars.append([o, h, l, c, vol])
            cur_open = c
        sessions.append({"date": day.isoformat(), "bars": bars})
        price = cur_open
    return times, sessions


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for p in PATTERNS:
        times, sessions = build(p)
        unit = "원" if p["currency"] == "KRW" else "USD"
        dataset = {
            "id": p["id"],
            "symbol": p["id"],
            "name": p["name"],
            "market": p["market"],
            "currency": p["currency"],
            "priceUnit": unit,
            "exchangeTimezone": p["session"]["tz"],
            "synthetic": True,
            "meta": {
                "source": "가상 생성(합성) 시세 — 실제 시세 아님 · 저작권 문제 없음",
                "fetchedAt": GENERATED_AT,
                "interval": "5분봉",
                "intervalSeconds": 300,
                "intervalRegular": True,
                "barTimestampMeans": "봉 시작 시각 (가상 세션 시각)",
                "sessionStart": times[0],
                "sessionEnd": times[-1],
                "sessionBars": len(times),
                "sessionsUsed": len(sessions),
                "firstDate": sessions[0]["date"],
                "lastDate": sessions[-1]["date"],
                "note": NOTE + " " + p["desc"] + ".",
            },
            "times": times,
            "sessions": sessions,
        }
        path = OUT / f"{p['id']}.json"
        path.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        items.append(
            {
                "id": p["id"],
                "symbol": p["id"],
                "name": p["name"],
                "market": p["market"],
                "currency": p["currency"],
                "priceUnit": unit,
                "sessions": len(sessions),
                "sessionBars": len(times),
                "sessionStart": times[0],
                "sessionEnd": times[-1],
                "firstDate": sessions[0]["date"],
                "lastDate": sessions[-1]["date"],
                "fetchedAt": GENERATED_AT,
                "file": f"{p['id']}.json",
            }
        )
        print(f"{p['id']:12s} {len(sessions)}일 × {len(times)}봉  {path.stat().st_size/1024:6.1f} KB")

    index = {
        "source": "가상 생성(합성) 시세 — 실제 시세 아님 · 저작권 문제 없음",
        "interval": "5분봉",
        "generatedAt": GENERATED_AT,
        "note": "체험용으로 무작위 생성한 통계 예시입니다. 실제 종목·실제 시세와 무관합니다.",
        "items": items,
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"index.json — {len(items)}종목")


if __name__ == "__main__":
    main()
