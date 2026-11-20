/**
 * 움직임 최소화 설정(prefers-reduced-motion) 존중 — v2.3.1.
 *
 * 결과로 이동할 때 부드러운 스크롤 애니메이션은 어지럼증·멀미를 유발할 수 있다.
 * 기기에서 '동작 줄이기'를 켠 방문자에게는 애니메이션 없이 바로 이동한다.
 */
export type ScrollBehaviorMode = "auto" | "smooth";

export function scrollBehavior(reduceMotion: boolean): ScrollBehaviorMode {
  return reduceMotion ? "auto" : "smooth";
}

/** 브라우저에 설정된 '동작 줄이기' 여부 (테스트·SSR 에서는 false) */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
