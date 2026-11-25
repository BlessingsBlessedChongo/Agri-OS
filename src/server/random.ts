/** The simulators' source of randomness; tests swap in a seeded generator so chaos is reproducible. */
let current: () => number = Math.random

export function random(): number {
  return current()
}

export function setRandom(fn: () => number): void {
  current = fn
}

export function resetRandom(): void {
  current = Math.random
}

/** Small seeded generator (mulberry32) for tests and repeatable seed data. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
