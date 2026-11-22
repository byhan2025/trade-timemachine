# trade-timemachine — 작업 규칙

한국형 타임머신: 1만 회 모의 재생 + 5분봉 가상 체험. 무료 공익 도구이고 회원가입·유료 결제가 없다. "투자 권유 아님" 표기는 모든 화면에서 유지한다.

## 착수 전

- 30분 넘게 걸릴 변경이면 `.agents/skills/grill-spec/SKILL.md` 규칙으로 요구를 한 라운드 확정하고, 스펙은 `specs/trade-timemachine/<슬러그>/spec.md` 에 둔다.
- 티켓 분해와 병렬 분담은 `.agents/skills/spec-tickets/SKILL.md`.

## 검증

```bash
scripts/dev-gate.sh --app trade-timemachine --fast     # 단위 테스트 + 타입
scripts/dev-gate.sh --app trade-timemachine --full --allow-build
```

- 저장소 CI: `.github/workflows/dev-gate.yml` 이 push·PR 마다 `npm ci` → `npm test` → `tsc --noEmit` → `npm run build:pages` 를 돈다(2026-11-22 적용). 실패하면 `gh run list -R byhan2025/trade-timemachine` 로 확인한다.

- 화면이 바뀌면 실제 브라우저에서 보고 캡처 경로를 보고에 남긴다. 데스크톱 폭과 390px 폭 둘 다.
- 버그는 고치기 전에 `.agents/skills/diagnose-bug/SKILL.md` — 이 버그에서 빨개지는 명령 하나를 먼저 만든다.

## 테스트

- seam 은 순수 계산 모듈과 `App` 서버 렌더다. 새 테스트는 `tests/entry.ts` 에 등록한다.
- 기대값은 손으로 계산한 리터럴이나 스펙 문장에서 온다. 코드와 같은 식으로 다시 계산하면 동어반복이다.
- 규칙: `.agents/skills/tdd-seam/SKILL.md`.

## 경계

- `npm run deploy:pages` 와 `git push` 는 김대표님 승인 뒤에만 실행한다. push 는 CI 를 깨우므로 초록을 확인하기 전에는 "완료"라고 보고하지 않는다.
- BYOK 시세 키는 브라우저 저장소에만 두고, 로그·저장소·보고에는 마스킹해서 남긴다.
- 개인 CSV 는 브라우저 메모리에서만 다룬다. 파일로 저장하거나 업로드하지 않는다.
- 시세 출처·약관 표기는 `README.md` 의 현재 문구가 정본이다. 임의로 바꾸지 않는다.
