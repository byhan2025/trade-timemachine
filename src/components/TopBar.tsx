import { APP_VERSION, VERSION_NOTE, VERSION_SHORT } from "../lib/version";

/**
 * 상단 헤더.
 *
 * v2.2.5 까지는 우측에 긴 버전 배지(`v2.2.5 · 0주 부제·계산용 1원 단위 표기·조합표 버튼 접근성`)를
 * `white-space: nowrap` 으로 붙여 두어, 390px·360px 화면에서 배지가 가로 폭을 다 먹고
 * 제목 `한국형 타임머신` 이 `한/국/형/타…` 처럼 한 글자씩 쪼개졌다.
 *
 * v2.3.0 부터는 배지를 짧은 `v2.3` 으로 줄이고 **제목과 같은 줄 안**(`.brand-title-row`)에 둔다.
 * 제목은 `white-space: nowrap` 이라 단어 중간에서 끊기지 않고, 자리가 모자라면 배지가 다음 줄로 내려간다.
 */
export function TopBar() {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          ⏱
        </span>
        <div className="brand-text">
          <div className="brand-title-row">
            <h1>한국형 타임머신</h1>
            <span className="pill" data-testid="version-badge" title={`v${APP_VERSION} — ${VERSION_NOTE}`}>
              v{VERSION_SHORT}
            </span>
          </div>
          <p>내 계획을 1만 번 미리 걸어보는 통계 시뮬레이터</p>
        </div>
      </div>
    </header>
  );
}
