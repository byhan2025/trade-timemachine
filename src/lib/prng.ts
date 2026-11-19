/**
 * 고정 시드 의사난수 (mulberry32).
 * 같은 입력 + 같은 시드면 어떤 기기에서도 똑같은 10,000회 재생이 나온다.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [lo, hi] 양끝 포함 정수 (Python random.randint와 같은 의미) */
export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
