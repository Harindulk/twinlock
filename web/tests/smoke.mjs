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
await browser.close();
process.exit(fails.length ? 1 : 0);
