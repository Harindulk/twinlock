import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { packMoves, type Grid } from './rules';

const env = (import.meta as any).env ?? (typeof process !== 'undefined' ? process.env : {});
export const RPC_URL: string = env.VITE_RPC ?? 'https://api.devnet.solana.com';
export const PROGRAM_ID: string = env.VITE_PROGRAM_ID ?? 'GeciFjoMLb14573Qw9zdjCNEW6JsYwvDWnzxwfwj8oDb';
export const OFFICIAL_CREATOR: string = env.VITE_OFFICIAL_CREATOR ?? 'A3scnSS7d6CV2dELNnsQ2UaX3FyDLVR33Lb7PYpvqCmW';
const LOCAL = /localhost|127\.0\.0\.1/.test(RPC_URL);
export const CLUSTER_LABEL = LOCAL ? 'Solana localnet' : 'Solana devnet';
const CLUSTER_QS = LOCAL ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}` : '?cluster=devnet';

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${CLUSTER_QS}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}${CLUSTER_QS}`;

const rpc = createSolanaRpc(RPC_URL);
const program = address(PROGRAM_ID);
const SYSTEM = address('11111111111111111111111111111111');
const enc = getAddressEncoder();
const dec = getAddressDecoder();
const text = new TextEncoder();

const DISC = {
  publish: [128, 13, 47, 112, 53, 158, 40, 49],
  setName: [78, 194, 111, 229, 198, 169, 162, 106],
  clear: [176, 5, 65, 236, 129, 209, 19, 65],
};
const LEVEL_SIZE = 190; // 8 + Level::INIT_SPACE (182)
const CLEAR_SIZE = 97;
const ERRORS = ['BadLevel', 'NotSolved', 'Fell', 'ExtraMoves', 'TooManyMoves'];

export class ChainError extends Error {
  constructor(message: string, public code?: string, public sig?: string) {
    super(message);
  }
}

// ---------- keys ----------
// The player is a burner key kept in this browser. The sponsor pays fees and rent so players never need SOL.
// shortcut: the sponsor is a devnet-only key bundled into the client (devnet SOL is worthless); anyone could drain it,
// in which case it gets refilled. A real deployment would sign as fee payer behind a small server endpoint.
const store: Storage | Map<string, string> = typeof localStorage !== 'undefined' ? localStorage : new Map();
const getItem = (k: string) => (store instanceof Map ? store.get(k) : store.getItem(k)) ?? null;
const setItem = (k: string, v: string) => (store instanceof Map ? store.set(k, v) : store.setItem(k, v));

let player: KeyPairSigner;
let sponsor: KeyPairSigner | null = null;

export async function init(opts: { playerSecret?: Uint8Array; sponsorSecret?: number[] } = {}) {
  let secret = opts.playerSecret;
  if (!secret) {
    const saved = getItem('twinlock.burner');
    secret = saved ? new Uint8Array(JSON.parse(saved)) : crypto.getRandomValues(new Uint8Array(32));
    setItem('twinlock.burner', JSON.stringify([...secret]));
  }
  player = await createKeyPairSignerFromPrivateKeyBytes(secret);
  const sp = opts.sponsorSecret ?? (env.VITE_SPONSOR_KEY ? JSON.parse(env.VITE_SPONSOR_KEY) : null);
  if (sp) sponsor = await createKeyPairSignerFromBytes(new Uint8Array(sp));
}

export const playerAddress = () => (player ? player.address : '');
export const isOfficial = (creator: string) => creator === OFFICIAL_CREATOR;

// ---------- PDAs ----------
const u32 = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
async function pda(seeds: (string | Uint8Array)[]) {
  const [a] = await getProgramDerivedAddress({ programAddress: program, seeds: seeds.map((s) => (typeof s === 'string' ? text.encode(s) : s)) });
  return a;
}
export const levelAddress = (creator: string, id: number) => pda(['level', enc.encode(address(creator)) as Uint8Array, u32(id)]);
const clearAddress = (level: string, who: string) => pda(['clear', enc.encode(address(level)) as Uint8Array, enc.encode(address(who)) as Uint8Array]);
const playerPda = (who: string) => pda(['player', enc.encode(address(who)) as Uint8Array]);

const officialCache = new Map<number, string>();
/** Synchronous lookup for official level addresses; filled by preloadOfficial(). */
export const officialLevelAddress = (id: number) => officialCache.get(id);
export async function preloadOfficial(ids: number[]) {
  for (const id of ids) officialCache.set(id, await levelAddress(OFFICIAL_CREATOR, id));
}

// ---------- sending ----------
type Meta = { address: Address; role: AccountRole; signer?: KeyPairSigner };
const ro = (a: string): Meta => ({ address: address(a), role: AccountRole.READONLY });
const rw = (a: string): Meta => ({ address: address(a), role: AccountRole.WRITABLE });
const signerMeta = (s: KeyPairSigner, writable = false): Meta => ({
  address: s.address,
  role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
  signer: s,
});

function bytes(...parts: (number[] | Uint8Array | number)[]) {
  const flat: number[] = [];
  for (const p of parts) typeof p === 'number' ? flat.push(p) : flat.push(...p);
  return new Uint8Array(flat);
}

async function send(accounts: Meta[], data: Uint8Array, opts: { skipPreflight?: boolean; extraSigner?: KeyPairSigner } = {}) {
  if (!sponsor) throw new ChainError('No sponsor key configured, so this build cannot send transactions.');
  const { value: blockhash } = await retry429(() => rpc.getLatestBlockhash().send());
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(sponsor!, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction({ programAddress: program, accounts: accounts as any, data }, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(tx);
  try {
    await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', skipPreflight: !!opts.skipPreflight, preflightCommitment: 'confirmed' }).send();
  } catch (e: any) {
    const logs: string[] = e?.context?.logs ?? e?.cause?.context?.logs ?? [];
    throw toChainError(logs, e?.message ?? String(e));
  }
  return confirm(sig);
}

function toChainError(logs: string[], fallback: string, sig?: string) {
  const joined = logs.join('\n');
  const m = joined.match(/Error Code: (\w+)/) ?? joined.match(/custom program error: 0x([0-9a-f]+)/i);
  let code = m?.[1];
  if (code && /^[0-9a-f]+$/i.test(code) && !ERRORS.includes(code)) code = ERRORS[parseInt(code, 16) - 6000] ?? code;
  const programLines = logs.filter((l) => /Program log|failed/.test(l)).slice(-3).join('\n');
  return new ChainError(programLines || fallback, code, sig);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The public devnet RPC answers 429 under load; reads back off and retry instead of failing the clear.
async function retry429<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i >= tries || e?.context?.statusCode !== 429) throw e;
      await sleep(800 * 2 ** i);
    }
  }
}

async function confirm(sig: Signature) {
  for (let i = 0; i < 60; i++) {
    const { value } = await retry429(() => rpc.getSignatureStatuses([sig]).send());
    const st = value[0];
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
      if (st.err) {
        const tx = await retry429(() => rpc.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' }).send());
        throw toChainError((tx?.meta?.logMessages as string[]) ?? [], 'Transaction failed', sig);
      }
      return { sig: sig as string, slot: Number(st.slot) };
    }
    await sleep(1000);
  }
  throw new ChainError('Timed out waiting for confirmation', undefined, sig);
}

// ---------- instructions ----------
export async function submitClear(level: string, moves: number[], opts: { skipPreflight?: boolean } = {}) {
  const clear = await clearAddress(level, player.address);
  return send(
    [signerMeta(sponsor!, true), signerMeta(player), rw(level), rw(clear), ro(SYSTEM)],
    bytes(DISC.clear, packMoves(moves), moves.length),
    opts,
  );
}

export async function publishLevel(g: Grid, name: string, moves: number[], id = Math.floor(Math.random() * 2 ** 32), as: KeyPairSigner = player) {
  const level = await levelAddress(as.address, id);
  const nm = new Uint8Array(24).fill(32);
  nm.set(text.encode(name).slice(0, 24));
  const r = await send(
    [signerMeta(sponsor!, true), signerMeta(as), rw(level), ro(SYSTEM)],
    bytes(DISC.publish, u32(id), g.w, g.h, g.cells, g.a, g.b, nm, packMoves(moves), moves.length),
  );
  return { ...r, address: level as string };
}

export async function setName(name: string) {
  const nm = new Uint8Array(16).fill(32);
  nm.set(text.encode(name).slice(0, 16));
  return send([signerMeta(sponsor!, true), signerMeta(player), rw(await playerPda(player.address)), ro(SYSTEM)], bytes(DISC.setName, nm));
}

// ---------- reading ----------
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const str = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0/g, '').trim();

export interface LevelInfo {
  address: string;
  creator: string;
  id: number;
  grid: Grid;
  name: string;
  par: number;
  best: number;
  bestPlayer: string;
  clears: number;
  solution: Uint8Array;
}

function decodeLevel(addr: string, d: Uint8Array): LevelInfo {
  const dv = new DataView(d.buffer, d.byteOffset);
  let o = 8;
  const creator = dec.decode(d.slice(o, (o += 32)));
  const id = dv.getUint32(o, true); o += 4;
  const w = d[o++], h = d[o++];
  const cells = [...d.slice(o, (o += 64))];
  const a = d[o++], b = d[o++];
  const name = str(d.slice(o, (o += 24)));
  const par = d[o++], best = d[o++];
  const bestPlayer = dec.decode(d.slice(o, (o += 32)));
  const clears = dv.getUint32(o, true); o += 4;
  const solution = d.slice(o, o + 16);
  return { address: addr, creator, id, grid: { w, h, cells, a, b }, name, par, best, bestPlayer, clears, solution };
}

export async function fetchLevel(addr: string): Promise<LevelInfo | null> {
  const { value } = await rpc.getAccountInfo(address(addr), { encoding: 'base64' }).send();
  return value ? decodeLevel(addr, b64(value.data[0])) : null;
}

export async function fetchLevels(): Promise<LevelInfo[]> {
  const res = await rpc.getProgramAccounts(program, { encoding: 'base64', filters: [{ dataSize: BigInt(LEVEL_SIZE) }] }).send();
  return (res as any[]).map((r) => decodeLevel(r.pubkey, b64(r.account.data[0])));
}

export interface ClearRow {
  address: string;
  player: string;
  name: string;
  moves: number;
  slot: number;
}

export async function fetchClears(level: string): Promise<ClearRow[]> {
  const res = (await rpc
    .getProgramAccounts(program, {
      encoding: 'base64',
      filters: [{ dataSize: BigInt(CLEAR_SIZE) }, { memcmp: { offset: 40n, bytes: level as any, encoding: 'base58' } }],
    })
    .send()) as any[];
  const rows: ClearRow[] = res.map((r) => {
    const d = b64(r.account.data[0]);
    const dv = new DataView(d.buffer, d.byteOffset);
    return { address: r.pubkey, player: dec.decode(d.slice(8, 40)), name: '', moves: d[72], slot: Number(dv.getBigUint64(73, true)) };
  });
  rows.sort((p, q) => p.moves - q.moves || p.slot - q.slot);
  const top = rows.slice(0, 10);
  if (top.length) {
    const pdas = await Promise.all(top.map((r) => playerPda(r.player)));
    const { value } = await rpc.getMultipleAccounts(pdas, { encoding: 'base64' }).send();
    value.forEach((acc, i) => acc && (top[i].name = str(b64(acc.data[0]).slice(8, 24))));
  }
  return top;
}
