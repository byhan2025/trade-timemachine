/**
 * 단위 테스트용 엔트리 — esbuild가 이 파일을 하나의 ESM 번들로 묶는다.
 * (Vite/TS 빌드에는 포함되지 않는다. tsconfig include 는 src 만 본다.)
 */
export { parseCustom } from "../src/lib/parseCustom";
export { buildPool } from "../src/lib/pool";
export { simulate } from "../src/lib/simulate";
export { historyReplay } from "../src/lib/backtest";
export { buildThermometer } from "../src/lib/thermometer";
export { buildStopLevels, compareCombos } from "../src/lib/combos";
export { simulateSurvival } from "../src/lib/survival";
