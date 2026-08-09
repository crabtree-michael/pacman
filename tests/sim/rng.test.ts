import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, nextRng, rngBelow } from '../../src/sim/rng';

/**
 * The PRNG is the only source of randomness the simulation is allowed, so its
 * determinism is what every replay test ultimately rests on (architecture §1).
 */
describe('xorshift32', () => {
  it('produces the same sequence for the same seed', () => {
    const run = (seed: number): number[] => {
      const out: number[] = [];
      let state = seed;
      for (let i = 0; i < 32; i++) {
        state = nextRng(state);
        out.push(state);
      }
      return out;
    };

    expect(run(DEFAULT_SEED)).toEqual(run(DEFAULT_SEED));
  });

  it('diverges for different seeds', () => {
    expect(nextRng(DEFAULT_SEED)).not.toBe(nextRng(DEFAULT_SEED + 1));
  });

  it('never settles on zero, which would freeze the sequence', () => {
    let state = DEFAULT_SEED;
    for (let i = 0; i < 10_000; i++) {
      state = nextRng(state);
      expect(state).not.toBe(0);
    }
  });

  it('bounds derived values without advancing the state', () => {
    let state = DEFAULT_SEED;
    for (let i = 0; i < 1000; i++) {
      state = nextRng(state);
      const value = rngBelow(state, 4);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(4);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
