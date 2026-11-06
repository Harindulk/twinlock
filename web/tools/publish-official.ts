// Publishes the official levels from the official creator key, each with the solver's solution as its proof.
// Usage: VITE_RPC=... VITE_PROGRAM_ID=... npx tsx tools/publish-official.ts <creator-keypair.json> <sponsor-keypair.json>
import { readFileSync } from 'node:fs';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import * as chain from '../src/chain';
import { OFFICIAL } from '../src/levels';
import { fromRows } from '../src/rules';
import { solve } from '../src/solver';

const [creatorPath, sponsorPath] = process.argv.slice(2);
const creator = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(creatorPath, 'utf8'))));
await chain.init({ sponsorSecret: JSON.parse(readFileSync(sponsorPath, 'utf8')) });
for (const l of OFFICIAL) {
  const addr = await chain.levelAddress(creator.address, l.id);
  if (await chain.fetchLevel(addr)) { console.log(`${l.id} ${l.title}: already on chain ${addr}`); continue; }
  const g = fromRows(l.rows);
  const r = await chain.publishLevel(g, l.title, solve(g)!, l.id, creator);
  console.log(`${l.id} ${l.title}: ${r.address} tx ${r.sig}`);
}
