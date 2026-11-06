import { describe, expect, it } from 'vitest';
import { fromRows, replay } from './rules';
import { solve } from './solver';

describe('solve', () => {
  it('finds the shortest solution', () => {
    const g = fromRows(['a.A#B..b']);
    const s = solve(g)!;
    expect(s.length).toBe(3);
    expect(replay(g, s)).toEqual({ ok: true, n: 3 });
  });
  it('uses the wall to line twins up', () => {
    const g = fromRows(['#A..Bb', 'a.....']);
    const s = solve(g)!;
    expect(replay(g, s).ok).toBe(true);
    expect(s.length).toBeLessThanOrEqual(4);
  });
  it('returns null when no solution exists', () => {
    expect(solve(fromRows(['AB', 'ba']))).toBeNull();
  });
  it('never routes through a pit', () => {
    const g = fromRows(['A.B', 'x.b', 'a..']);
    const s = solve(g);
    if (s) expect(replay(g, s).ok).toBe(true);
  });
});
