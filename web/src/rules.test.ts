import { describe, expect, it } from 'vitest';
import fixtures from '../../fixtures/levels.json';
import { fromRows, packMoves, replay, unpackMoves, validateLevel, type ReplayResult } from './rules';

const DIRS: Record<string, number> = { U: 0, D: 1, L: 2, R: 3 };

describe('fixtures (shared with the Rust program)', () => {
  for (const c of fixtures.cases as any[]) {
    it(c.name, () => {
      const g = fromRows(c.rows);
      if (c.start_override) [g.a, g.b] = c.start_override;
      if (c.expect === 'bad_level') {
        expect(validateLevel(g)).toBe(false);
        return;
      }
      expect(validateLevel(g)).toBe(true);
      const want: ReplayResult =
        typeof c.expect === 'string'
          ? { ok: false, reason: c.expect }
          : 'solved' in c.expect
            ? { ok: true, n: c.expect.solved }
            : { ok: false, reason: 'fell', step: c.expect.fell };
      expect(replay(g, [...c.moves].map((m: string) => DIRS[m]))).toEqual(want);
    });
  }
});

describe('packing matches the program layout', () => {
  it('packs 2 bits per move, low bits first, 16 bytes', () => {
    const p = packMoves([3, 2, 1, 0, 3]);
    expect(p.length).toBe(16);
    expect(p[0]).toBe(0b00_01_10_11);
    expect(p[1]).toBe(0b11);
  });
  it('round-trips', () => {
    const m = [0, 1, 2, 3, 3, 2, 1];
    expect(unpackMoves(packMoves(m), m.length)).toEqual(m);
  });
});
