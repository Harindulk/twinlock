// Twinlock rules: a line-for-line port of programs/twinlock/src/rules.rs.
// Both are tested against fixtures/levels.json, so the game and the chain agree.

export const FLOOR = 0, WALL = 1, PAD_A = 2, PAD_B = 3, PIT = 4;
export const MAX_MOVES = 64;
export const UP = 0, DOWN = 1, LEFT = 2, RIGHT = 3;

export interface Grid {
  w: number;
  h: number;
  cells: number[]; // always 64 long, row-major, w*h used
  a: number;
  b: number;
}

export type ReplayResult =
  | { ok: true; n: number }
  | { ok: false; reason: 'not_solved' | 'extra_moves' | 'too_many_moves' }
  | { ok: false; reason: 'fell'; step: number };

const CHAR: Record<string, number> = { '#': WALL, a: PAD_A, b: PAD_B, x: PIT };

/** rows: `.` floor, `#` wall, `a`/`b` pads, `x` pit, `A`/`B` twin starts. */
export function fromRows(rows: string[]): Grid {
  const w = rows[0].length;
  const g: Grid = { w, h: rows.length, cells: new Array(64).fill(FLOOR), a: 0, b: 0 };
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      if (ch === 'A') g.a = i;
      if (ch === 'B') g.b = i;
      if (i < 64) g.cells[i] = CHAR[ch] ?? FLOOR;
    }),
  );
  return g;
}

export function validateLevel(g: Grid): boolean {
  if (g.w < 1 || g.w > 8 || g.h < 1 || g.h > 8) return false;
  const n = g.w * g.h;
  if (n < 2 || g.a >= n || g.b >= n || g.a === g.b) return false;
  if (g.cells[g.a] !== FLOOR || g.cells[g.b] !== FLOOR) return false;
  if (g.cells.slice(n).some((c) => c !== FLOOR) || g.cells.some((c) => c > PIT)) return false;
  return g.cells.filter((c) => c === PAD_A).length === 1 && g.cells.filter((c) => c === PAD_B).length === 1;
}

function step(g: Grid, pos: number, dir: number): number {
  let x = pos % g.w, y = Math.floor(pos / g.w);
  if (dir === UP) y--;
  else if (dir === DOWN) y++;
  else if (dir === LEFT) x--;
  else x++;
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return pos;
  const next = y * g.w + x;
  return g.cells[next] === WALL ? pos : next;
}

export const mirror = (dir: number) => (dir === LEFT ? RIGHT : dir === RIGHT ? LEFT : dir);

/** One move for both twins; the game uses this for animation, replay for verdicts. */
export function applyMove(g: Grid, a: number, b: number, dir: number): { a: number; b: number; blocked: boolean } {
  const ta = step(g, a, dir), tb = step(g, b, mirror(dir));
  if (ta === tb || (ta === b && tb === a)) return { a, b, blocked: true };
  return { a: ta, b: tb, blocked: false };
}

export const fell = (g: Grid, a: number, b: number) => g.cells[a] === PIT || g.cells[b] === PIT;
export const solved = (g: Grid, a: number, b: number) => g.cells[a] === PAD_A && g.cells[b] === PAD_B;

export function replay(g: Grid, moves: number[]): ReplayResult {
  if (moves.length > MAX_MOVES) return { ok: false, reason: 'too_many_moves' };
  let { a, b } = g;
  for (let i = 0; i < moves.length; i++) {
    ({ a, b } = applyMove(g, a, b, moves[i]));
    if (fell(g, a, b)) return { ok: false, reason: 'fell', step: i + 1 };
    if (solved(g, a, b)) return i + 1 === moves.length ? { ok: true, n: moves.length } : { ok: false, reason: 'extra_moves' };
  }
  return { ok: false, reason: 'not_solved' };
}

export function packMoves(moves: number[]): Uint8Array {
  const out = new Uint8Array(16);
  moves.slice(0, MAX_MOVES).forEach((m, i) => (out[i >> 2] |= (m & 3) << ((i & 3) * 2)));
  return out;
}

export function unpackMoves(packed: Uint8Array, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (packed[i >> 2] >> ((i & 3) * 2)) & 3);
}
