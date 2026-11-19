import type { Session } from "./types";

/**
 * 부트스트랩 풀 (참고 구현 trader-timemachine/timemachine.py 의 build_pool 이식).
 *
 * pool[i] = 과거 모든 세션의 i번째 봉을 '직전 봉 종가'로 나눈 비율
 *           (시가/직전종가, 고가/직전종가, 저가/직전종가, 종가/직전종가)
 *
 * 이렇게 하면 가격 수준과 무관하게 '봉의 모양(수익률 분포)'만 뽑아
 * 현재 가격에 곱해 미래 경로를 만들 수 있다. 슬롯 0은 직전 봉이 없어 비어 있다.
 */
export interface Pool {
  /** 세션당 봉 수 */
  slots: number;
  /** 풀에 들어간 세션 수 (슬롯마다 같은 개수) */
  sessions: number;
  o: Float64Array[];
  h: Float64Array[];
  l: Float64Array[];
  c: Float64Array[];
  /** 세션별 봉 수가 달라 실제로 쓰지 못한 세션 수 */
  skipped: number;
}

export function buildPool(sessions: Session[], slots: number): Pool {
  const usable = sessions.filter((s) => s.bars.length === slots && slots > 1);
  const n = usable.length;
  const o: Float64Array[] = new Array(slots);
  const h: Float64Array[] = new Array(slots);
  const l: Float64Array[] = new Array(slots);
  const c: Float64Array[] = new Array(slots);
  for (let i = 0; i < slots; i++) {
    o[i] = new Float64Array(n);
    h[i] = new Float64Array(n);
    l[i] = new Float64Array(n);
    c[i] = new Float64Array(n);
  }
  for (let s = 0; s < n; s++) {
    const bars = usable[s].bars;
    for (let i = 1; i < slots; i++) {
      const prevClose = bars[i - 1][3];
      const b = bars[i];
      if (!(prevClose > 0)) continue;
      o[i][s] = b[0] / prevClose;
      h[i][s] = b[1] / prevClose;
      l[i][s] = b[2] / prevClose;
      c[i][s] = b[3] / prevClose;
    }
  }
  return { slots, sessions: n, o, h, l, c, skipped: sessions.length - n };
}
