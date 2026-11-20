/**
 * 앱 버전 표기 한 곳 — package.json 의 version 과 같은 값을 쓴다.
 * 배지·푸터·README 가 서로 다른 버전을 가리키지 않게 여기서만 고친다.
 */
export const APP_VERSION = "2.3.1";

/** 모바일 헤더 배지는 제목을 밀지 않도록 짧게 (v2.3) */
export const VERSION_SHORT = APP_VERSION.split(".").slice(0, 2).join(".");

/** 배지에 마우스를 올리면 보이는 이번 버전 요약 */
export const VERSION_NOTE = "본인 API 키 4단계 가이드·가상 체험 데이터·접근성 3건";
