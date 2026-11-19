# 한국형 타임머신 시뮬레이터 (2단계)

계획한 진입가·손절가·목표가를 **과거 실제 봉 데이터의 수익률 분포로 10,000번 다시 걸어보는** 독립 웹앱입니다.
2단계에서는 **종목명·코드·티커로 실시간 5분봉을 불러오는 검색 UI**와 **GitHub Pages 공개 배포**,
그 뒤를 받치는 **Supabase Edge Function `stock-bars` 중계 서버**를 추가했습니다.
투자 권유·매매 신호가 아니며, 미래 수익을 보장하지 않습니다. 개인 연구·참고용 **비상업** 통계 도구입니다.

- 라이브: <https://byhan2025.github.io/trade-timemachine/>
- 오리지널 로직: `Jakeschincariol/day-trader-skill`의 `trader-timemachine/timemachine.py`, `trader-exit/exit.py`, `trader-budget/size.py`, `trader-risk/check.py`
- 스택: Vite + React + TypeScript (엔진은 순수 TS, 10,000회 약 35~60ms) + Supabase Edge Function (Deno)

## 실행

```bash
cd apps/trade-timemachine
npm install
npm run dev          # 개발 서버 (localhost:4180, base "/")
npm run build        # tsc -b && vite build -> dist/ (base "/")
npm run build:pages  # GitHub Pages 서브패스 빌드 -> dist/ (base "/trade-timemachine/")
npm run preview      # dist 미리보기 (127.0.0.1:4180)
npm run deploy:pages # build:pages + dist/ 를 gh-pages 브랜치로 푸시
npm run test:api     # Supabase 함수 단위·실서비스 테스트 (deno test)
```

## 실시간 종목 검색 (2단계)

화면 상단 **[실시간 종목 검색]** 에 `삼성전자`·`카카오`·`에코프로`·`005930`·`TSLA`·`QQQ` 를 넣고
**조회**(또는 Enter)하면, 후보를 고르는 즉시 최근 60거래일 **5분봉**을 받아 그 자리에서 재생합니다.

- 중계 엔드포인트: `VITE_STOCK_API_URL` (기본값 `https://ntfhdiujapctomzzaifu.supabase.co/functions/v1/stock-bars`)
- 검색: 네이버증권 자동완성(`ac.stock.naver.com`) + Yahoo Finance 검색(`v1/finance/search`)
- 봉: Yahoo Finance Chart v8 (`range=60d&interval=5m`), 실패 시 `range=7d&interval=1m` 을 5분봉으로 합산
- 서버가 준비되지 않았거나 네트워크가 막히면 **가짜 데이터를 만들지 않고**
  `실시간 시세 서버 연결 대기 중 — 내장 5종목 및 CSV/JSON 붙여넣기는 즉시 사용 가능` 상태를 보여줍니다.
  내장 5종목·CSV/JSON 입력은 서버와 무관하게 그대로 동작합니다.

## 데이터

`public/samples/` 의 5종목 JSON은 **Yahoo Finance Chart API(v8 공개 엔드포인트)의 실제 최근 60거래일 5분봉**을
`scripts/fetch_samples.py` 로 받아 세션별로 검증해 저장한 것입니다. 합성·보간한 봉은 없습니다.
실시간 조회도 같은 검증 규칙(완전 세션만 사용)을 거칩니다.

```bash
python3 scripts/fetch_samples.py                 # 기본 5종목 재수집
python3 scripts/fetch_samples.py --symbols 005930.KS TSLA
```

- 파이썬 표준 라이브러리만 사용 (urllib, zoneinfo, json)
- 거래일별 봉 개수가 정확히 같은 "완전 세션"만 사용 (반장·갭·진행 중 세션 제외, 제외 목록을 메타에 기록)
- 각 파일의 `meta`에 출처 URL, 수집 시각(+09:00), 봉 단위(5분봉), 봉 시각 의미(봉 시작), 세션 구간, 사용/제외 세션, 통화·가격 단위를 기록

## Supabase Edge Function `stock-bars`

`supabase/functions/stock-bars/`

| 파일 | 내용 |
| --- | --- |
| `index.ts` | 라우팅·CORS(`Access-Control-Allow-Origin: *`)·타임아웃·캐시·오류 응답 |
| `lib.ts` | 파싱/집계/세션 검증/검색 정규화 (Deno API 없음 → 그대로 단위 테스트) |
| `lib_test.ts` | 실제 네이버·Yahoo 응답 캡처(`fixtures/`)로 16개 테스트 |
| `live_test.ts` | 로컬 서버를 띄워 실서비스 통합 테스트 (CORS·검색·봉·오류·캐시) |

```bash
deno test --allow-read supabase/functions/stock-bars/            # 단위 16개
deno test --allow-net --allow-read supabase/functions/stock-bars/live_test.ts  # 실서비스 1개 세트
PORT=8790 deno run --allow-net --allow-env supabase/functions/stock-bars/index.ts  # 로컬 중계
```

### API

| 요청 | 응답 |
| --- | --- |
| `GET ?q=삼성전자` / `?q=TSLA` / `?q=005930` | `{ok,kind:"search",results:[{code,name,market,symbol,currency,priceUnit,exchange,type,source}],sources}` |
| `GET ?symbol=005930.KS` | `{ok,kind:"bars",symbol,name,market,currency,priceUnit,exchangeTimezone,meta,times,sessions:[{date,bars:[[o,h,l,c,v],…]}]}` |
| `GET ?code=005930&market=KR` | 위와 같음 (시장을 모르면 `.KS`→`.KQ` 순으로 시도) |
| `GET ?health=1` | 버전·시각 |
| 오류 | `{ok:false,kind:"error",error:{code,message}}` + HTTP 400/404/422/429/502/504 |

배포:

```bash
supabase link --project-ref ntfhdiujapctomzzaifu
supabase functions deploy stock-bars --no-verify-jwt   # 공개 중계라 JWT 검증을 끈다 (비밀키 없음)
```

`supabase/functions/stock-bars/DEPLOY.md` 에 그대로 따라 할 수 있는 절차를 적어 두었습니다.

## 엔진 (참고 구현과의 대응)

| 참고 구현 | 이 앱 | 내용 |
| --- | --- | --- |
| `build_pool` | `src/lib/pool.ts` | 슬롯별 (시가·고가·저가·종가 ÷ 직전 봉 종가) 비율 풀 |
| `simulate` | `src/lib/simulate.ts` | 진입 봉 이후를 10,000회 재생, 슬롯 jitter ±2, 손절 먼저 검사, 목표/손절/미도달 집계, 2,000경로 밴드(같은 시드), 5/25/50/75/95% 분위 |
| `history_replay` | `src/lib/backtest.ts` | 오프닝 레인지 돌파 규칙을 과거 모든 완전 세션에 적용 |
| `size.py` | `src/lib/sizing.ts` | `floor(min(계좌 × 1회 손실률 ÷ 1주 위험폭, 계좌 ÷ 진입가))`, 정수 주 |
| `plan.json` 검증 | `src/App.tsx` | 매수 `손절<진입<목표`, 매도 `목표<진입<손절` 등 입력 규칙 검사 |

- **고정 시드(기본 19)**: 같은 데이터·같은 입력이면 어느 기기에서든 같은 결과가 나옵니다. `mulberry32` 사용.
- **파리티 검증**: 같은 데이터·같은 입력에서 파이썬 원본과 확률 차이 0.1~1.3%p(난수열 차이), 백테스트 결과는 건수까지 완전 일치.
- **10,000회 성능**: 35~57ms(웹 실측).

## 사용자 데이터 입력

CSV/텍스트 붙여넣기 또는 파일(.csv/.txt/.json) 업로드.
- 권장 형식: `시각,시가,고가,저가,종가,거래량` (`2026-11-18 09:05,71500,71600,71300,71450,12345`)
- JSON: `[{date, time, open, high, low, close, volume}, …]` 또는 `[[시각, 시가, 고가, 저가, 종가], …]`
- 같은 날짜에 봉이 3개 이상인 분봉만 지원. 날짜만 있는 일봉은 재생 불가(안내 문구 표시).
- 봉 개수가 최빈값과 다른 날(반장·누락)은 자동 제외하고 화면에 알림.

## 화면

- 입력: 실시간 종목 검색(후보 목록) · 내장 5종목 · 내 데이터, **가정할 포지션**(매수/매도),
  **예시 입력값(가상)** 진입·손절·목표가, 손익비 프리셋(1R/1.5R/2R), 진입 시각, 계좌 금액, 1회 허용 손실률
- 결과: **데이터 기준일·수집 시각·출처** 1줄 병기 + 목표/손절/미도달 3칸 확률 +
  `목표 도달 + 종가 유리 마감 합계`(목표 도달과 구분해 괄호 설명)
- 경로 분포 SVG: 20개 샘플 궤적, 5~95%·25~75% 밴드, 중앙값, 목표/진입/손절선
- 적정 수량 & 리스크, 과거 실전 세션 참고, 데이터 출처 카드(개인 연구·참고용 비상업 명시)

## 배포

- `npm run deploy:pages` → `dist/` 를 `gh-pages` 브랜치로 푸시 (외부 패키지 없이 git worktree 사용)
- Pages: `https://byhan2025.github.io/trade-timemachine/` (서브패스 `/trade-timemachine/`)
- `base` 는 `vite.config.ts` 에서 `VITE_BASE_PATH`(기본 `/`)로 결정됩니다.

## 검증 리포트

- `reports/trade-timemachine/v1/` — 1단계(엔진·파리티·Playwright)
- `reports/trade-timemachine/v2/` — 2단계(실시간 검색·실서비스 함수 테스트·모바일·라이브 URL)
