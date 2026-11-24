export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function gauss2(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-0.5 * (dx * dx + dy * dy));
}

export function percentile(values: ArrayLike<number>, p: number, mask?: Uint8Array): number {
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    if (!mask || mask[i]) sample.push(values[i]);
  }
  if (sample.length === 0) return 0;
  sample.sort((a, b) => a - b);
  const idx = Math.min(sample.length - 1, Math.max(0, Math.round((p / 100) * (sample.length - 1))));
  return sample[idx];
}
