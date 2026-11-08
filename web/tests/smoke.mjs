// Browser smoke test: load, solve level 1 by keyboard, see the on-chain receipt, try the forged clear.
// Usage: node tests/smoke.mjs [url] [shotDir]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5179/';
const shots = process.argv[3] ?? '/tmp/twinlock-shots';
const browser = await chromium.launch({ headless: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector('#official-list button');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/${label}-1-start.png` });
  check((await page.locator('#level-name').textContent()) === 'Mirror', `${label}: level 1 loaded`);
  if (label === 'desktop') {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('#receipt.ok', { timeout: 20000 }).catch(() => {});
    await page.screenshot({ path: `${shots}/${label}-2-solved.png` });
    check(await page.locator('#receipt.ok').count() === 1, `${label}: solve verified on chain`);
    await page.waitForTimeout(1500);
    check((await page.locator('#leaderboard tr').count()) >= 1 && !(await page.locator('#leaderboard').textContent()).includes('No clears'), `${label}: leaderboard shows a row`);
    await page.locator('.tamper summary').click();
    await page.locator('#btn-forge').click();
    await page.waitForSelector('#receipt.bad', { timeout: 20000 }).catch(() => {});
    await page.screenshot({ path: `${shots}/${label}-3-forged.png` });
    check((await page.locator('#receipt').textContent()).includes('NotSolved'), `${label}: forged clear rejected with NotSolved`);
  } else {
    const box = await page.locator('#board').boundingBox();
    check(box && box.width <= 390 && box.width > 200, `${label}: board fits the phone (${box?.width}px)`);
  }
  check(errors.length === 0, `${label}: no console errors ${errors.join(' | ')}`);
  await page.close();
}
// regressions from the fresh-eyes playtest
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.waitForSelector('#official-list button');
  // P0: watching the best solution must not record a clear for the viewer
  await page.click('#official-list button >> nth=1');
  await page.waitForSelector('#btn-watch:not([hidden])', { timeout: 10000 }).catch(() => {});
  const me = await page.evaluate(() => JSON.parse(localStorage.getItem('twinlock.progress') || '{}'));
  await page.click('#btn-watch');
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('twinlock.progress') || '{}'));
  check(JSON.stringify(me) === JSON.stringify(after) && (await page.locator('#receipt.ok, #receipt.pending').count()) === 0, 'watching the best solution records nothing');
  // P0: a pending receipt must not follow you to another level
  await page.click('#official-list button >> nth=0');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.click('#official-list button >> nth=4');
  await page.waitForTimeout(4000);
  check((await page.locator('#receipt.ok').count()) === 0, 'switching level while a clear is pending keeps the new level clean');
  // P2: undo after solving clears the receipt
  await page.click('#official-list button >> nth=0');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForSelector('#receipt.ok', { timeout: 20000 }).catch(() => {});
  await page.keyboard.press('z');
  check((await page.locator('#receipt.ok').count()) === 0, 'undo after a solve resets the receipt');
  // P1: the editor refuses stacked twins before you play
  await page.click('#btn-editor');
  await page.click('[data-paint="2"]'); await page.click('#ed-grid button >> nth=12');
  await page.click('[data-paint="3"]'); await page.click('#ed-grid button >> nth=17');
  await page.click('[data-paint="A"]'); await page.click('#ed-grid button >> nth=5');
  check((await page.locator('#ed-status').textContent()).includes('separate tiles') && (await page.locator('#ed-grid .ta').count()) === 1 && (await page.locator('#ed-grid .tb').count()) === 1, 'editor: refuses to stack the twins');
  await page.click('[data-paint="0"]'); await page.click('#ed-grid button >> nth=17');
  check(await page.locator('#ed-test').isDisabled(), 'editor: publish disabled while a pad is missing');
  await page.close();
}
// editor: publish a level, then a second player finds and clears it (skipped on devnet so test levels don't reach players)
if (!process.env.NO_PUBLISH) {
  const name = `Smoke ${Date.now() % 100000}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.waitForSelector('#official-list button');
  await page.click('#btn-editor');
  await page.click('[data-paint="2"]');
  await page.click('#ed-grid button >> nth=12');
  await page.click('[data-paint="3"]');
  await page.click('#ed-grid button >> nth=17');
  await page.fill('#ed-name', name);
  check((await page.locator('#ed-status').textContent()).includes('Shortest solution: 2'), 'editor: solver reports 2 moves');
  await page.click('#ed-test');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('#receipt.ok', { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: `${shots}/editor-published.png` });
  check((await page.locator('#receipt').textContent()).includes('Level published'), 'editor: level published on chain');
  const other = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await other.goto(url);
  await other.waitForSelector(`#community-list button:has-text("${name}")`, { timeout: 15000 }).catch(() => {});
  const btn = other.locator(`#community-list button:has-text("${name}")`);
  check((await btn.count()) === 1, 'second player sees the community level');
  if (await btn.count()) {
    await btn.click();
    await other.keyboard.press('ArrowDown');
    await other.keyboard.press('ArrowDown');
    await other.waitForSelector('#receipt.ok', { timeout: 20000 }).catch(() => {});
    check(await other.locator('#receipt.ok').count() === 1, 'second player clears it on chain');
  }
}
await browser.close();
process.exit(fails.length ? 1 : 0);
