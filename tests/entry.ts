/**
 * 단위 테스트용 엔트리 — esbuild가 이 파일을 하나의 ESM 번들로 묶는다.
 * (Vite/TS 빌드에는 포함되지 않는다. tsconfig include 는 src 만 본다.)
 */
export { parseCustom } from "../src/lib/parseCustom";
export { buildPool } from "../src/lib/pool";
export { simulate } from "../src/lib/simulate";
export { historyReplay } from "../src/lib/backtest";
export { buildThermometer } from "../src/lib/thermometer";
export { sizePosition, SHORT_DISCLOSURE, EXTREME_STOP_RATIO } from "../src/lib/sizing";
export { buildStopLevels, compareCombos, pickBestCell } from "../src/lib/combos";
export { simulateSurvival } from "../src/lib/survival";
export { summaryLines, avgRBreakdown } from "../src/lib/summary";
export {
  formatPct,
  formatPctValue,
  formatMultiple,
  formatPrice,
  formatWon,
  formatR,
  moneyLabel,
  axisLabels,
  isFlatSpan,
  decimalsOf,
  roundTo,
  mirrorPrice,
  offsetPrice,
  roundPrice,
} from "../src/lib/format";
export {
  COMBO_MODES,
  bestBadgeText,
  comboModeHint,
  greenGloss,
  riskFormula,
  rGloss,
  expectedValueNote,
  GREEN_LABEL,
  RISK_FORMULA_ABS,
  SURVIVAL_LABELS,
  COMBO_MULTIPLE_NOTE,
  easyGlossary,
} from "../src/lib/terms";
export {
  TRAFFIC_BADGES,
  TRAFFIC_BASIS,
  EXTREME_STOP_REASON,
  EXTREME_BANNER_NOTE,
  EXTREME_AVG_R_NOTE,
  EXTREME_POSITIVE_NOTE,
  avgRTone,
  positiveTone,
  zeroShareReason,
  FLAT_R,
  trafficLevel,
  trafficBadge,
  perHundred,
  approxMoney,
  avgMoneyPerTrade,
  easyMoneyChip,
  easyLine1,
  easyLine2,
  easyConclusion,
  easySummary,
  easyMathDetail,
  easyThermometerLine,
  easyProfitCount,
  easyAvgMultiple,
  easyStopLevelLabel,
  easySizingLine,
  survivalIndexText,
  survivalFlatNote,
} from "../src/lib/easy";
export { ResultCards } from "../src/components/ResultCards";
export { SizingCard, isExtremeStop } from "../src/components/SizingCard";
