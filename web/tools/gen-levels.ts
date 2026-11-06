// Dev tool: random search for levels whose shortest solution is much longer than the straight-line distance.
// Usage: npx tsx tools/gen-levels.ts <w> <h> <count> [seed]
import { FLOOR, PAD_A, PAD_B, PIT, WALL, validateLevel, type Grid } from '../src/rules';
import { solve } from '../src/solver';

const [w, h, count, seed0] = process.argv.slice(2).map(Number);
let seed = seed0 || 1;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (n: number) => Math.floor(rnd() * n);
const dist = (g: Grid, p: number, q: number) => Math.abs((p % g.w) - (q % g.w)) + Math.abs(Math.floor(p / g.w) - Math.floor(q / g.w));
const ch = (g: Grid, i: number) => (i === g.a ? 'A' : i === g.b ? 'B' : '.#abx'[g.cells[i]]);

const found: { score: number; n: number; rows: string[] }[] = [];
const tries = Number(process.argv[6] ?? 3000);
const [minN, maxN, wallRate, pitRate] = [Number(process.argv[7] ?? 1), Number(process.argv[8] ?? 64), Number(process.argv[9] ?? 0.22), Number(process.argv[10] ?? 0.06)];
for (let t = 0; t < tries; t++) {
  const cells = new Array(64).fill(FLOOR);
  for (let i = 0; i < w * h; i++) {
    const r = rnd();
    cells[i] = r < wallRate ? WALL : r < wallRate + pitRate ? PIT : FLOOR;
  }
  const floors = () => cells.slice(0, w * h).map((c, i) => (c === FLOOR ? i : -1)).filter((i) => i >= 0);
  if (floors().length < 6) continue;
  const free = () => { const f = floors(); return f[pick(f.length)]; };
  const pa = free(); cells[pa] = PAD_A;
  const pb = free(); cells[pb] = PAD_B;
  const g: Grid = { w, h, cells, a: free(), b: 0 };
  g.b = free();
  if (g.a === g.b || !validateLevel(g)) continue;
  const s = solve(g);
  if (!s || s.length < minN || s.length > maxN) continue;
  const lower = Math.max(dist(g, g.a, pa), dist(g, g.b, pb));
  found.push({ score: s.length - lower + s.length / 4, n: s.length, rows: Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => ch(g, y * w + x)).join('')) });
}
found.sort((p, q) => q.score - p.score);
const seen = new Set<string>();
for (const f of found) {
  const k = f.rows.join('/');
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(JSON.stringify({ n: f.n, score: +f.score.toFixed(1), rows: f.rows }));
  if (seen.size >= count) break;
}
