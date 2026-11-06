// Records the demo video shots as WebM clips at 1440x900 (Playwright), one per beat of the script.
// Usage: npx tsx tests/capture.ts <url> <outDir>
import { chromium, type Page } from 'playwright';
import { OFFICIAL } from '../src/levels';
import { fromRows, FLOOR, WALL, PIT, PAD_A, PAD_B } from '../src/rules';
import { solve } from '../src/solver';
import { mkdirSync, renameSync } from 'node:fs';
const [url = 'http://localhost:5179/', out = '/tmp/twinlock-capture'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const size = { width: 1440, height: 900 };
const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(name: string, fn: (p: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: out, size }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector('#official-list button');
  await slow(900);
  await fn(page);
  await slow(1200);
  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), `${out}/${name}.webm`);
  console.log('saved', name);
}
const KEY = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const play = async (page: Page, moves: number[], gap = 260) => { for (const d of moves) { await page.keyboard.press(KEY[d]); await slow(gap); } };
const sol = (i: number) => solve(fromRows(OFFICIAL[i].rows))!;

await shot('01-forged', async (p) => {
  await p.locator('.tamper summary').click(); await slow(700);
  await p.locator('#btn-forge').click();
  await p.waitForSelector('#receipt.bad', { timeout: 30000 }); await slow(1800);
});
await shot('02-play-1-2', async (p) => {
  await play(p, sol(0)); await p.waitForSelector('#receipt.ok', { timeout: 30000 }); await slow(1500);
  await p.click('#btn-next'); await slow(800);
  await play(p, sol(1), 330); await p.waitForSelector('#receipt.ok', { timeout: 30000 }); await slow(1500);
});
await shot('03-watch-best', async (p) => {
  await p.click('#official-list button >> nth=7'); await slow(1200);
  await p.waitForSelector('#btn-watch:not([hidden])'); await p.click('#btn-watch'); await slow(23 * 200 + 1500);
});
await shot('04-editor', async (p) => {
  await p.click('#btn-editor'); await slow(600);
  const paint = async (kind: string, cells: number[]) => { await p.click(`[data-paint="${kind}"]`); for (const c of cells) { await p.click(`#ed-grid button >> nth=${c}`); await slow(120); } };
  await paint('1', [7, 8, 14, 21, 26]); await paint('4', [19, 28]); await paint('2', [30]); await paint('3', [35]);
  await p.fill('#ed-name', 'Demo hall'); await slow(1200);
  const cells = new Array(64).fill(FLOOR);
  for (const c of [7, 8, 14, 21, 26]) cells[c] = WALL;
  for (const c of [19, 28]) cells[c] = PIT;
  cells[30] = PAD_A; cells[35] = PAD_B;
  const moves = solve({ w: 6, h: 6, cells, a: 0, b: 5 })!;
  await p.click('#ed-test'); await slow(700);
  await play(p, moves, 300);
  await p.waitForSelector('#receipt.ok', { timeout: 30000 }); await slow(2000);
});
await browser.close();
