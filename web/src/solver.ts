import { applyMove, fell, solved, type Grid } from './rules';

/** Breadth-first search over twin positions: the shortest move list, or null if unsolvable. */
export function solve(g: Grid, maxMoves = 64): number[] | null {
  const key = (a: number, b: number) => a * 64 + b;
  const prev = new Map<number, [number, number]>([[key(g.a, g.b), [-1, -1]]]);
  let frontier = [[g.a, g.b]];
  for (let depth = 0; depth < maxMoves && frontier.length; depth++) {
    const next: number[][] = [];
    for (const [a, b] of frontier) {
      for (let d = 0; d < 4; d++) {
        const m = applyMove(g, a, b, d);
        const k = key(m.a, m.b);
        if (prev.has(k) || fell(g, m.a, m.b)) continue;
        prev.set(k, [key(a, b), d]);
        if (solved(g, m.a, m.b)) {
          const path: number[] = [];
          for (let c = k; prev.get(c)![0] !== -1; c = prev.get(c)![0]) path.unshift(prev.get(c)![1]);
          return path;
        }
        next.push([m.a, m.b]);
      }
    }
    frontier = next;
  }
  return null;
}
