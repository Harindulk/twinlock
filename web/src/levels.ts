// Official levels. Rows: . floor, # wall, x pit, a/b pads, A/B twin starts.
// Par is the solver's shortest solution; levels.test.ts checks it. The deploy script publishes
// these from the official key with the solver's solution as the on-chain proof.
export const OFFICIAL: { id: number; title: string; par: number; rows: string[] }[] = [
  { id: 1, title: 'Mirror', par: 2, rows: ['.......', 'a.A.B.b', '.......'] },
  { id: 2, title: 'So close', par: 7, rows: ['..bB.', 'aA...', '.....', '..#..'] },
  { id: 3, title: 'Lean on it', par: 7, rows: ['#.#..', '...B.', '.#aA.', '...b.'] },
  { id: 4, title: 'Mind the gap', par: 9, rows: ['.Aax#', 'x...x', '..Bb.', '....x', '#...x'] },
  { id: 5, title: 'Split', par: 13, rows: ['.b....', '.B#xAa', 'x.#...', '.....#', '###.#.'] },
  { id: 6, title: 'Crossing', par: 14, rows: ['#.B.x#', '...bxa', '..#.xA', '.x....', '..#.x.'] },
  { id: 7, title: 'Long way round', par: 18, rows: ['.Aa..#', '.#....', '..#..B', '...#x#', '.....b', '#.#...'] },
  { id: 8, title: 'Twinlock', par: 23, rows: ['.bx..', '.B..#', 'xA.#.', '.a..#', '.#x..'] },
];
