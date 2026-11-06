import { expect, it } from 'vitest';
import { OFFICIAL } from './levels';
import { fromRows, validateLevel } from './rules';
import { solve } from './solver';

it('has 8 official levels with ids 1-8', () => {
  expect(OFFICIAL.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

for (const l of OFFICIAL) {
  it(`${l.id} ${l.title}: valid and solvable in exactly par ${l.par} moves`, () => {
    const g = fromRows(l.rows);
    expect(validateLevel(g)).toBe(true);
    expect(solve(g)?.length).toBe(l.par);
  });
}

it('gets harder or stays level', () => {
  const pars = OFFICIAL.map((l) => l.par);
  expect([...pars].sort((a, b) => a - b)).toEqual(pars);
});
