// Runs against a local validator with the program loaded: see scripts/e2e.sh.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as chain from './chain';
import { fromRows } from './rules';

const run = process.env.VITE_RPC?.includes('127.0.0.1') ? describe : describe.skip;
const L = 2;

run('chain against a local validator', () => {
  let level = '';
  beforeAll(async () => {
    const sponsor = JSON.parse(readFileSync(process.env.SPONSOR_KEYPAIR!, 'utf8'));
    await chain.init({ playerSecret: crypto.getRandomValues(new Uint8Array(32)), sponsorSecret: sponsor });
    const r = await chain.publishLevel(fromRows(['a.A#B..b']), 'Edge stall', [L, L, L]);
    level = r.address;
  }, 30000);

  it('reads back the published level', async () => {
    const info = await chain.fetchLevel(level);
    expect(info?.name).toBe('Edge stall');
    expect(info?.par).toBe(3);
    expect(info?.creator).toBe(chain.playerAddress());
    expect((await chain.fetchLevels()).some((l) => l.address === level)).toBe(true);
  });

  it('rejects an unsolvable publish in preflight with the program error', async () => {
    await expect(chain.publishLevel(fromRows(['a.A#B..b']), 'Bad', [L])).rejects.toMatchObject({ code: 'NotSolved' });
  });

  it('records a valid clear and shows it on the leaderboard with the player name', async () => {
    await chain.setName('tester');
    const r = await chain.submitClear(level, [L, L, L]);
    expect(r.sig.length).toBeGreaterThan(40);
    const rows = await chain.fetchClears(level);
    expect(rows[0]).toMatchObject({ player: chain.playerAddress(), moves: 3, name: 'tester' });
  }, 30000);

  it('a forged clear lands on chain as a failed tx with NotSolved', async () => {
    const err = await chain.submitClear(level, [L], { skipPreflight: true }).catch((e) => e);
    expect(err).toBeInstanceOf(chain.ChainError);
    expect(err.code).toBe('NotSolved');
    expect(err.sig).toBeTruthy();
  }, 30000);
});
