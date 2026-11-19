# stock-bars Edge Function 배포 절차

한국형 타임머신의 실시간 시세 중계 함수입니다. 공개 시세만 중계하며 **비밀키를 쓰지 않습니다**.

## 1. 준비

```bash
supabase login                              # 브라우저 인증(또는 SUPABASE_ACCESS_TOKEN 환경변수)
supabase link --project-ref ntfhdiujapctomzzaifu
```

- 프로젝트: `bojang-guide` (`ntfhdiujapctomzzaifu`, 서울 리전) 안에 함수 하나로 추가됩니다.
- CLI 토큰은 대시보드에서 **임시 토큰**을 발급해 쓰고, 배포 직후 지웁니다(기존 운영 방식과 동일).

## 2. 배포

```bash
supabase functions deploy stock-bars --no-verify-jwt
```

- `--no-verify-jwt` 는 **필수**입니다. GitHub Pages 의 정적 페이지는 키를 싣지 않고 호출하며,
  함수는 공개 시세만 읽어 옵니다. `config.toml` 의 `[functions.stock-bars] verify_jwt = false` 와 같은 뜻입니다.
- 시크릿(`supabase secrets set`)은 필요 없습니다.

## 3. 배포 확인

```bash
curl -s "https://ntfhdiujapctomzzaifu.supabase.co/functions/v1/stock-bars?health=1"
curl -s "https://ntfhdiujapctomzzaifu.supabase.co/functions/v1/stock-bars?q=삼성전자" | head -c 300
curl -s "https://ntfhdiujapctomzzaifu.supabase.co/functions/v1/stock-bars?symbol=005930.KS" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessions'][0]['date'], d['sessions'][-1]['date'], d['meta']['sessionBars'], len(d['sessions']))"
```

- CORS 확인: `curl -s -D - -o /dev/null -H "Origin: https://byhan2025.github.io" \
  "https://ntfhdiujapctomzzaifu.supabase.co/functions/v1/stock-bars?health=1" | grep -i access-control`
  → `access-control-allow-origin: *` 가 보여야 합니다.

## 4. 롤백

```bash
supabase functions delete stock-bars      # 함수 제거 (앱은 "연결 대기" 안내로 자동 전환)
```

## 참고 — 왜 네이버증권은 봉 데이터에 쓰지 않는가 (2026-11-20 실측)

- 네이버 자동완성(`ac.stock.naver.com/ac`)은 한국 종목명·코드 검색에 그대로 사용합니다.
- 네이버 시세 차트 API(`api.stock.naver.com/chart/domestic/item/…`)는 `startDate`/`endDate` 를 줘도
  **가장 최근 한 세션만** 돌려주고(요청 범위 무시), 5분봉 `localDateTime` 이 실제 시각과 어긋납니다
  (2026-11-19 조회 시 10:00~19:55, 117봉). 60거래일 5분봉을 만들 수 없어 봉 데이터는 Yahoo Chart v8 을 씁니다.
- 한국 종목의 **한글 이름**은 `m.stock.naver.com/api/stock/{code}/integration` 으로 보강합니다(실패해도 치명적이지 않음).
